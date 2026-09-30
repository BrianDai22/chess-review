import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { Reviews, ensureFixture } from './review.mjs';

const store = new Store(); ensureFixture(store);
const reviews = new Reviews(store);
const server = new McpServer({ name: 'chess-review', version: '0.1.0' });
new OpenAIExtensions(server);
const uri = 'ui://chess-review/review';
registerAppResource(server, 'review-board', uri, {}, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE,
  text: readFileSync(fileURLToPath(new URL('../ui.html', import.meta.url)), 'utf8'),
  _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } }, 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['fullscreen'] } }
}] }));
function result(data) { return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }; }
function tool(name, description, inputSchema, fn, appOnly = false, opener = false) {
  registerAppTool(server, name, { title: opener ? 'Review Board' : name.replaceAll('_', ' '), description, inputSchema,
    annotations: { readOnlyHint: name === 'get_review_context' || name === 'sync_review_view', destructiveHint: false, openWorldHint: false },
    _meta: { ui: { ...(opener ? { resourceUri: uri } : {}), visibility: appOnly ? ['app'] : ['model', 'app'] },
      ...(opener ? { 'openai/ui': { entrypoints: [{ type: 'thread' }, { type: 'global' }], preferredModelDisplayMode: 'fullscreen' } } : {}) }
  }, async args => { try { return result(await fn(args)); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } });
}
const session = { sessionId: z.string() }, guard = { ...session, expectedRevision: z.number().int().positive() };
tool('open_review', 'Open the native review board. Defaults to a clearly labeled verification fixture; pass imported gameId or durable sessionId.', { gameId: z.string().optional(), sessionId: z.string().optional() }, args => reviews.open(args), false, true);
tool('get_review_context', 'Read live canonical selected-position context for this explicit session before explaining or changing a position.', session, args => reviews.context(args.sessionId));
tool('go_to_move', 'Select a played-line ply; preserve original PGN and reject stale revisions. Backend commit does not prove UI display.', { ...guard, ply: z.number().int().nonnegative() }, args => reviews.go(args));
tool('show_variation', 'Show a legal alternative SAN or UCI sequence from the selected played-line position on the same session board; never changes the played game.', { ...guard, moves: z.array(z.string()).max(24) }, args => reviews.variation(args));
tool('return_to_game', 'Restore the selected played-line position after a variation.', guard, args => reviews.return(args));
tool('sync_review_view', 'App-only canonical view synchronization and separate display/context acknowledgements.', { ...session, mountId: z.string(), knownRevision: z.number().int(), displayedRevision: z.number().int().optional(), contextRevision: z.number().int().optional(), contextUpdateId: z.string().optional() }, args => reviews.sync(args), true);
await server.connect(new StdioServerTransport());
