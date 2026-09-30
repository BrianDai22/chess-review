import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

// Run after npm run build. This verifies the compiled package through actual
// stdio processes and the pinned engine, never Brian's learning database.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'chess-review', 'server', 'index.mjs');
const enginePath = process.env.CHESS_REVIEW_STOCKFISH || join(homedir(), 'Library', 'Application Support', 'Chess Review', 'engine', 'stockfish', 'stockfish-macos-universal');
await access(serverPath);
await access(enginePath);
const dataDir = await mkdtemp(join(tmpdir(), 'chess-review-stdio-'));
const clients = new Set();
const checkpoints = [];
const startedAt = performance.now();

function record(name, detail) {
  checkpoints.push({ name, detail });
  process.stdout.write(`PASS ${name}${detail ? `: ${detail}` : ''}\n`);
}

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [serverPath], cwd: root, stderr: 'pipe',
    env: { ...getDefaultEnvironment(), CHESS_REVIEW_DATA_DIR: dataDir, CHESS_REVIEW_STOCKFISH: enginePath },
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-6000); });
  const client = new Client({ name: 'chess-review-stdio-verifier', version: '0.1.0' }, { capabilities: {} });
  clients.add(client);
  try { await client.connect(transport); }
  catch (error) { throw new Error(`Compiled server did not connect: ${error.message}\n${stderr}`); }
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 45000 });
  if (result.isError) throw new Error(`${name}: ${result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n')}`);
  assert.ok(result.structuredContent, `${name} must return structured canonical data`);
  return result.structuredContent;
}

async function blocked(client, name, args, pattern) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 45000 });
  assert.equal(result.isError, true, `${name} should reject this request`);
  const message = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
  assert.match(message, pattern);
}

function guard(state) { return { sessionId: state.sessionId, expectedRevision: state.revision }; }
function retryGuard(state) { return { ...guard(state), retryId: state.retry.retryId, attemptRevision: state.retry.attemptRevision }; }
function readRecord(namespace, key) {
  const db = new DatabaseSync(join(dataDir, 'chess-review.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM objects WHERE namespace=? AND key=?').get(namespace, key);
    assert.ok(row, `${namespace}:${key} must exist in the canonical database`);
    return JSON.parse(row.value);
  } finally { db.close(); }
}
const waitBriefly = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

try {
  let client = await connect();
  const serverInfo = client.getServerVersion();
  const pawnIcon = serverInfo?.icons?.find(icon => icon.mimeType === 'image/svg+xml' && icon.src.startsWith('data:image/svg+xml;base64,'));
  assert.ok(pawnIcon, 'Compiled server must advertise the inline SVG pawn icon used by the Codex sidebar');
  const pawnSvg = Buffer.from(pawnIcon.src.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
  assert.match(pawnSvg, /<svg\b/);
  assert.match(pawnSvg, /<path\b/);
  const tools = await client.listTools();
  for (const name of ['open_review', 'list_games', 'analyze_game', 'start_retry', 'submit_retry', 'get_position_evidence', 'check_candidate']) assert.ok(tools.tools.some(tool => tool.name === name), `Missing compiled tool ${name}`);
  const syncTool = tools.tools.find(tool => tool.name === 'sync_review_view');
  assert.deepEqual(syncTool._meta.ui.visibility, ['app']);
  const catalog = await call(client, 'list_games');
  assert.equal(catalog.username, null);
  assert.ok(catalog.games.some(game => game.fixture && /fixture/i.test(game.sourceLabel)));
  await blocked(client, 'refresh_games', {}, /username first/i);
  record('tool discovery and empty username', 'No guessed username or network import');

  const resource = await client.readResource({ uri: 'ui://chess-review/review' });
  const html = resource.contents.find(item => item.mimeType === 'text/html;profile=mcp-app');
  assert.ok(html?.text);
  assert.equal((html.text.match(/data:image\/svg\+xml;base64/g) || []).length, 12);
  for (const role of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']) {
    assert.ok(html.text.includes(`piece.${role}.white`)); assert.ok(html.text.includes(`piece.${role}.black`));
  }
  assert.doesNotMatch(html.text, /<(?:script|link|img)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(html.text, /url\(\s*["']?(?:https?:)?\/\//i);
  assert.deepEqual(html._meta['openai/ui'].availableDisplayModes, ['fullscreen']);
  record('bundled MCP App resource', '12 inline SVG pieces; no external asset requests');

  let first = await call(client, 'open_review');
  let second = await call(client, 'open_review');
  assert.notEqual(first.sessionId, second.sessionId);
  const gameId = first.gameId;
  const originalPgn = readRecord('games', gameId).pgn;
  const deadline = Date.now() + 120000;
  while (first.analysis.readiness !== 'ready') {
    assert.equal(first.analysis.playerAccuracy, undefined, 'Partial analysis must not publish a final accuracy');
    assert.equal(first.analysis.accuracy, undefined, 'Neither player gets a final partial score');
    if (['failed', 'interrupted'].includes(first.analysis.readiness)) throw new Error(`Canonical analysis ${first.analysis.readiness}: ${first.analysis.error}`);
    assert.ok(Date.now() < deadline, 'Automatic analysis did not finish within 120 seconds');
    await waitBriefly(250);
    first = await call(client, 'get_review_context', { sessionId: first.sessionId });
  }
  assert.ok(Number.isFinite(first.analysis.accuracy.w));
  assert.ok(Number.isFinite(first.analysis.accuracy.b));
  const oldRevision = first.revision;
  first = await call(client, 'go_to_move', { ...guard(first), ply: 1 });
  await blocked(client, 'go_to_move', { sessionId: first.sessionId, expectedRevision: oldRevision, ply: 2 }, /stale revision/i);
  second = await call(client, 'get_review_context', { sessionId: second.sessionId });
  assert.equal(second.selectedPly, 0);
  first = await call(client, 'show_variation', { ...guard(first), moves: ['e5', 'Nf3'] });
  assert.deepEqual(first.variation, ['e5', 'Nf3']);
  assert.equal(first.selectedPly, 1);
  const sync = await call(client, 'sync_review_view', { sessionId: first.sessionId, mountId: 'stdio-verifier', knownRevision: oldRevision });
  assert.equal(sync.changed, true);
  assert.equal(sync.state.revision, first.revision);
  assert.equal(sync.displayAcknowledgement, false);
  assert.equal(sync.hostContextAcknowledgement, false);
  assert.equal(sync.modelConsumptionVerified, false);
  first = await call(client, 'return_to_game', guard(first));
  record('session isolation and stale guards', 'Variation preserved played line; no fabricated UI/context acknowledgement');

  first = await call(client, 'analyze_game', guard(first));
  assert.equal(first.analysis.readiness, 'ready', 'Completed automatic analysis is reused');
  assert.ok(Number.isFinite(first.analysis.playerAccuracy));
  assert.equal(first.analysis.completedPositions, first.analysis.totalPositions);
  const originalAccuracy = first.analysis.playerAccuracy;
  const frozenAnalysis = JSON.stringify(readRecord('analyses', gameId));
  second = await call(client, 'get_review_context', { sessionId: second.sessionId });
  assert.equal(second.selectedPly, 0);
  record('automatic pinned-engine game analysis', `${first.analysis.totalPositions} positions; white ${first.analysis.accuracy.w.toFixed(3)}, black ${first.analysis.accuracy.b.toFixed(3)}`);

  first = await call(client, 'start_retry', { ...guard(first), ply: 7 });
  assert.equal(first.selectedPly, 6);
  assert.equal(first.retry.answerExposed, false);
  assert.equal(first.retry.checkedAnswer, undefined);
  assert.equal(first.analysis.playerAccuracy, undefined);
  assert.equal(first.analysis.currentPosition, undefined);
  assert.equal(first.analysis.selectedMove, undefined);
  assert.equal(first.analysis.keyMoments, undefined);
  assert.equal(first.playedMoves.length, 6);
  assert.equal(first.learning, undefined);
  await blocked(client, 'get_position_evidence', guard(first), /retry attempt|checking answers/i);
  await blocked(client, 'check_candidate', { ...guard(first), move: 'Qxf7#' }, /retry attempt|checking answers/i);
  await blocked(client, 'show_variation', { ...guard(first), moves: ['Qxf7#'] }, /retry attempt|showing an answer/i);
  first = await call(client, 'retry_hint', retryGuard(first));
  assert.equal(first.retry.hintsUsed, 1);
  assert.equal(first.retry.answerExposed, false);
  assert.ok(first.retry.hint);
  assert.equal(first.retry.checkedAnswer, undefined);
  first = await call(client, 'submit_retry', { ...retryGuard(first), move: 'Qxf7#' });
  const attempt = first.retry.attempts.at(-1);
  assert.equal(attempt.ready, true);
  assert.equal(attempt.accepted, true);
  assert.equal(attempt.preservesOutcome, true);
  assert.equal(attempt.assisted, true);
  assert.equal(first.retry.firstAttempt.san, 'Qxf7#');
  assert.equal(first.retry.answerExposed, true);
  assert.equal(first.retry.checkedAnswer.move, 'h5f7');
  assert.equal(first.analysis.playerAccuracy, originalAccuracy);
  assert.equal(JSON.stringify(readRecord('analyses', gameId)), frozenAnalysis);
  assert.equal(readRecord('games', gameId).pgn, originalPgn);
  first = await call(client, 'end_retry', guard(first));
  assert.equal(first.retry, undefined);
  record('hidden retry and checked mate attempt', 'Recorded hint/first attempt; original PGN and entire score record unchanged');

  first = await call(client, 'go_to_move', { ...guard(first), ply: 5 });
  const evidence = await call(client, 'get_position_evidence', guard(first));
  assert.equal(evidence.canonicalScoreChanged, false);
  assert.equal(evidence.evidence.ready, true);
  assert.ok(evidence.checkedContinuation.length > 0);
  assert.equal(evidence.sideToMove, 'b');
  const candidate = await call(client, 'check_candidate', { ...guard(first), move: 'Nf6' });
  assert.equal(candidate.canonicalScoreChanged, false);
  assert.equal(candidate.evidence.ready, true);
  assert.equal(candidate.checkedOpponentResponse[0]?.san, 'Qxf7#');
  assert.equal(JSON.stringify(readRecord('analyses', gameId)), frozenAnalysis);
  record('checked educational continuations', 'Strong response and played mistake checked; canonical score remains frozen');

  const saved = { sessionId: first.sessionId, revision: first.revision, fen: first.fen, selectedPly: first.selectedPly };
  const secondId = second.sessionId;
  await client.close(); clients.delete(client);
  client = await connect();
  const restored = await call(client, 'open_review', { sessionId: saved.sessionId });
  assert.equal(restored.revision, saved.revision);
  assert.equal(restored.fen, saved.fen);
  assert.equal(restored.selectedPly, saved.selectedPly);
  assert.equal(restored.analysis.playerAccuracy, originalAccuracy);
  assert.equal((await call(client, 'open_review', { sessionId: secondId })).selectedPly, 0);
  assert.equal((await call(client, 'list_games')).username, null);
  assert.equal(readRecord('games', gameId).pgn, originalPgn);
  record('restart and explicit session restoration', 'Two persisted sessions, original game and frozen analysis restored');

  process.stdout.write(`${checkpoints.length} compiled stdio checks passed in ${((performance.now() - startedAt) / 1000).toFixed(1)}s. Native rendering/model consumption are verified separately.\n`);
} finally {
  await Promise.allSettled([...clients].map(client => client.close()));
  await rm(dataDir, { recursive: true, force: true });
}
