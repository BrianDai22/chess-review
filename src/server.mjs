import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Store } from './store.mjs';
import { Reviews, ensureFixture } from './review.mjs';
import { ChessComImporter } from './importer.mjs';
import { Engine } from './engine.mjs';
import { Analysis } from './analysis.mjs';
import { Learning } from './learning.mjs';
import { Education } from './education.mjs';
import { join } from 'node:path';

const store = new Store(); ensureFixture(store);
const engine = new Engine({ binary: process.env.CHESS_REVIEW_STOCKFISH || join(store.dataDir, 'engine', 'stockfish', 'stockfish-macos-universal') });
const analysis = new Analysis({store,engine});
const learning = new Learning(store,engine);
const reviews = new Reviews(store,{learning,analysis});
const importer = new ChessComImporter(store);
const education = new Education({store,engine,reviews});
// The global sidebar entry uses MCP server icons, separately from the plugin listing logo.
const pawnIcon = { src: 'data:image/svg+xml;base64,' + readFileSync(new URL('../assets/pawn.svg', import.meta.url)).toString('base64'), mimeType: 'image/svg+xml', sizes: ['64x64'] };
// A plugin update may remove this version's cache while its MCP process is
// still serving requests. Keep that process's immutable bundled UI in memory.
const reviewHtml = readFileSync(new URL('../ui.html', import.meta.url), 'utf8');
const server = new McpServer({ name: 'chess-review', version: '0.1.0', icons: [pawnIcon] });
new OpenAIExtensions(server);
const legacyUri = 'ui://chess-review/review';
// Hosts cache UI documents separately from plugin versions and connections.
const uri = `ui://chess-review/review-${createHash('sha256').update(reviewHtml).digest('hex').slice(0, 16)}.html`;
for (const resourceUri of [uri, legacyUri]) {
  registerAppResource(server, resourceUri === uri ? 'review-board' : 'review-board-legacy', resourceUri, {}, async () => ({ contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE,
    text: reviewHtml,
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } }, 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['fullscreen'] } }
  }] }));
}
function result(data) { return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }; }
function tool(name, description, inputSchema, fn, appOnly = false, opener = false) {
  registerAppTool(server, name, { title: opener ? 'Review Board' : name.replaceAll('_', ' '), description, inputSchema,
    annotations: { readOnlyHint: name === 'get_review_context' || name === 'sync_review_view', destructiveHint: false, openWorldHint: false },
    _meta: { ui: { ...(opener ? { resourceUri: uri } : {}), visibility: appOnly ? ['app'] : ['model', 'app'] },
      ...(opener ? { 'openai/ui': { entrypoints: [{ type: 'thread' }, { type: 'global' }], preferredModelDisplayMode: 'fullscreen' } } : {}) }
  }, async args => { try { return result(await fn(args)); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } });
}
const session = { sessionId: z.string() }, guard = { ...session, expectedRevision: z.number().int().positive() };
function current(args) { const state=reviews.context(args.sessionId); if(state.revision!==args.expectedRevision) throw new Error('Stale revision. Read current context.'); return state; }
function catalog() { const username=store.get('settings','username'); return {username,games:store.listGames().filter(g=>g.fixture || g.importedFor===username).map(g=>({id:g.id,white:g.white,black:g.black,playerColor:g.playerColor,timeClass:g.timeClass,timeControl:g.timeControl,endTime:g.endTime,sourceLabel:g.sourceLabel,fixture:Boolean(g.fixture)})),lastRefresh:username ? store.get('settings',`import:${username}`) : null}; }
tool('list_games','List remembered username and locally imported game choices; verification fixtures are labeled.',{},catalog);
tool('refresh_games','Import recent completed standard games for an explicit or remembered Chess.com username. Preserves history on errors; never supplies a guessed username.',{username:z.string().optional()},async args=>{const username=args.username || store.get('settings','username'); if(!username)throw new Error('Enter your Chess.com username first.'); return {import:await importer.refresh({username}),...catalog()};});
tool('select_game','Select another imported game in this explicit review session; preserves every original PGN.',{...guard,gameId:z.string()},args=>reviews.select(args));
tool('analyze_game','Start or resume canonical local analysis under the frozen profile. Pending progress is not a final score.',guard,args=>{const state=current(args);analysis.start(state.gameId);return reviews.context(args.sessionId);});
tool('open_review', 'Open the native review board. Defaults to a clearly labeled verification fixture; pass imported gameId or durable sessionId.', { gameId: z.string().optional(), sessionId: z.string().optional() }, args => reviews.open(args), false, true);
tool('get_review_context', 'Read live canonical selected-position context for this explicit session before explaining or changing a position.', session, args => reviews.context(args.sessionId));
tool('go_to_move', 'Select a played-line ply; preserve original PGN and reject stale revisions. Backend commit does not prove UI display.', { ...guard, ply: z.number().int().nonnegative() }, args => reviews.go(args));
tool('show_variation', 'Show a legal alternative SAN or UCI sequence from the selected played-line position on the same session board; never changes the played game.', { ...guard, moves: z.array(z.string()).max(24) }, args => store.transaction(()=>{ const before=current(args),state=reviews.variation(args); if(args.moves.length && before.sideToMove===before.playerColor) store.set('answer-exposures',`${state.gameId}:${state.selectedPly+1}`,{gameId:state.gameId,ply:state.selectedPly+1,at:store.now(),source:'requested demonstration'});return state; }));
tool('show_best_move', 'Compare a played move with its checked engine-best replacement: select the original position before this explicit played ply and show the legal replacement. Requires ready canonical analysis, rejects hidden retries, and preserves the original game and scores.', { ...guard, ply:z.number().int().positive() }, args => reviews.bestMove(args));
tool('return_to_game', 'Restore the selected played-line position after a variation.', guard, args => reviews.return(args));
tool('get_position_evidence','Read checked position facts and a legal engine continuation for this explicit position; does not change canonical scores.',guard,args=>education.position(args));
tool('check_candidate','Check a legal SAN or UCI candidate and the opponent response from the selected position. Evidence is separate from immutable original-game scoring.',{...guard,move:z.string()},args=>education.candidate(args));
tool('publish_coaching_note','Publish a brief native-AI explanation as plain text on this exact current board after reading checked semantic position evidence. Labeled AI interpretation, not engine-validated fact. Requires completed analysis and rejects hidden retries or stale revisions; does not change game, revision, or scores.',{...guard,text:z.string().trim().min(1).max(800)},args=>reviews.publishCoachingNote(args));
tool('start_retry','Hide the checked answer and select an analyzed player decision for retry. Record prior answer exposure truthfully.',{...guard,ply:z.number().int().positive(),answerPreviouslyShown:z.boolean().optional()},args=>{const state=current(args);const prior=store.get('answer-exposures',`${state.gameId}:${args.ply}`);learning.start({...args,answerPreviouslyShown:Boolean(args.answerPreviouslyShown || prior)});return reviews.context(args.sessionId);});
const retryGuard={...guard,retryId:z.string(),attemptRevision:z.number().int().positive()};
tool('submit_retry','Submit a legal retry attempt and evaluate sound alternatives under the canonical budget; preserve first attempt, help and original game score.',{...retryGuard,move:z.string()},async args=>{await learning.attempt(args);return reviews.context(args.sessionId);});
tool('retry_hint','Give a recorded first cue; a second hint reveals the checked answer and records assistance.',retryGuard,args=>{learning.hint(args);return reviews.context(args.sessionId);});
tool('end_retry','Leave retry and return to ordinary review without changing the played game or its score.',guard,args=>reviews.endRetry(args));
tool('sync_review_view', 'App-only canonical view synchronization and separate display/context acknowledgements.', { ...session, mountId: z.string(), knownRevision: z.number().int(), displayedRevision: z.number().int().optional(), contextRevision: z.number().int().optional(), contextUpdateId: z.string().optional() }, args => reviews.sync(args), true);
await server.connect(new StdioServerTransport());
