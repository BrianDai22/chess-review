import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Chess } from 'chess.js';

const source = (await readFile(new URL('../src/ui.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const initial = { sessionId: 'review-one', gameId: 'fixture', revision: 1, selectedPly: 0,
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', playerColor: 'white',
  sideToMove: 'white', moveHistory: [], variation: [], playedMoves: ['e4', 'e5'], analysis: { readiness: 'pending' },
  legalMoves: [{ from: 'e2', to: 'e4', san: 'e4' }, { from: 'e2', to: 'e3', san: 'e3' }, { from: 'g1', to: 'f3', san: 'Nf3' }] };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }

function harness({ delayedContext = false, delayedSync = false, delayedSyncCall = 1, delayedLaunch = false, failedContextCalls = 0, initialState = initial, launchState, toolResponses = {}, catalogResult } = {}) {
  const nodes = new Map();
  function node() {
    return { textContent: '', value: '', hidden: false, disabled: false, open: false, focusCount: 0, listeners: {}, children: [], dataset: {}, attributes: {},
      append(...children) { this.children.push(...children); }, setAttribute(name, value) { this.attributes[name] = value; },
      focus() { this.focusCount++; },
      replaceChildren(...children) { this.children = children; },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      click() { if (!this.disabled) this.listeners.click?.(); } };
  }
  const document = { body: node(), hidden: false, listeners: {},
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    createElement: node, createDocumentFragment: node,
    addEventListener(name, fn) { this.listeners[name] = fn; } };
  const contextCalls = [], toolCalls = [], timerCallbacks = [], boardConfigurations = [];
  const contextWait = deferred(), syncWait = deferred(), launchWait = deferred();
  let now = 0;
  let canonical = { ...initialState }, appInstance, boardInstance;
  class App {
    constructor() { appInstance = this; }
    addEventListener() {}
    getHostContext() { return { displayMode: 'fullscreen', availableDisplayModes: ['fullscreen'], theme: 'light' }; }
    async connect() { if (delayedLaunch) await launchWait.promise; this.ontoolresult({ structuredContent: launchState || canonical }); }
    async callServerTool(call) {
      toolCalls.push(call);
      if (toolResponses[call.name]) {
        const response = await toolResponses[call.name](call, canonical);
        if (response.sessionId && response.playedMoves) canonical = response;
        return { structuredContent: response };
      }
      if (call.name === 'list_games' || call.name === 'refresh_games') return { structuredContent: catalogResult || { username: null, games: [{ id: canonical.gameId, fixture: true, sourceLabel: 'Verification fixture' }] } };
      if (call.name === 'get_position_evidence') return { structuredContent: { sessionId: canonical.sessionId, revision: canonical.revision, fen: canonical.fen, evidence: { ready: false, exact: false } } };
      if (call.name === 'get_review_context') return { structuredContent: canonical };
      if (call.name === 'sync_review_view') {
        if (delayedSync && toolCalls.filter(c => c.name === 'sync_review_view').length === delayedSyncCall) return syncWait.promise;
        return { structuredContent: { state: canonical, changed: call.arguments.knownRevision !== canonical.revision } };
      }
      assert.equal(call.arguments.sessionId, canonical.sessionId);
      assert.equal(call.arguments.expectedRevision, canonical.revision);
      canonical = { ...canonical, revision: canonical.revision + 1, selectedPly: call.arguments.ply ?? canonical.selectedPly };
      return { structuredContent: canonical };
    }
  }
  class OpenAIExtensions {
    constructor() { this.modelContext = { update: async data => {
      contextCalls.push(data);
      if (contextCalls.length <= failedContextCalls) throw new Error('Temporary native bridge failure');
      if (delayedContext && contextCalls.length === 1) return contextWait.promise;
      return { updateId: `accepted-${data.structuredContent.revision}` };
    } }; }
  }
  function Chessground(element, config) {
    assert.equal(element, nodes.get('board'));
    boardConfigurations.push(config);
    boardInstance = { config, dragOrigin: undefined, cancellations: 0,
      set(next) { this.config = next; boardConfigurations.push(next); },
      cancelMove() { this.cancellations++; this.dragOrigin = undefined; },
      beginDrag(from) { this.dragOrigin = from; },
      drop(to) { const from = this.dragOrigin; this.dragOrigin = undefined; if (from) this.config.movable.events.after(from, to); },
      destroy() {} };
    return boardInstance;
  }
  runInNewContext(source, { App, OpenAIExtensions, Chessground, Chess, document, window: { addEventListener() {} },
    crypto: { randomUUID: () => 'mount-one' },
    Date: { now: () => now },
    applyDocumentTheme() {}, applyHostStyleVariables() {},
    setTimeout(fn) { timerCallbacks.push(fn); return timerCallbacks.length; }, clearTimeout() {}, console });
  return { nodes, document, getNode: id => document.getElementById(id), contextCalls, toolCalls, timerCallbacks, boardConfigurations, contextWait, syncWait, launchWait, setNow(value) { now = value; },
    get canonical() { return canonical; }, get app() { return appInstance; }, get board() { return boardInstance; } };
}

test('manual navigation commits explicitly then publishes the returned canonical revision', async () => {
  const h = harness(); await settle();
  assert.equal(h.boardConfigurations[0].fen, initial.fen);
  assert.equal(h.boardConfigurations[0].viewOnly, false);
  assert.equal(h.boardConfigurations[0].movable.dests.size, 0);
  assert.equal(h.boardConfigurations[0].coordinatesOnSquares, false);
  assert.match(h.nodes.get('accessible-position').textContent, /White king e1/);
  assert.equal(h.contextCalls[0].structuredContent.revision, 1);
  h.nodes.get('next').click(); await settle();
  const mutation = h.toolCalls.find(c => c.name === 'go_to_move');
  assert.equal(mutation.arguments.sessionId, 'review-one');
  assert.equal(mutation.arguments.expectedRevision, 1);
  assert.equal(mutation.arguments.ply, 1);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
  assert.match(h.nodes.get('status').textContent, /connected to chat/);
  await h.timerCallbacks.at(-1)(); await settle();
  const ack = h.toolCalls.at(-1).arguments;
  assert.equal(ack.displayedRevision, 2);
  assert.equal(ack.contextRevision, 2);
  assert.equal(ack.contextUpdateId, 'accepted-2');
});

test('component enables only canonical legal destinations after authoritative synchronization', async () => {
  const h = harness(); await settle();
  const config = h.boardConfigurations[0];
  assert.equal(config.orientation, 'white');
  assert.equal(config.turnColor, 'white');
  assert.equal(config.movable.free, false);
  assert.equal(config.draggable.enabled, false);
  assert.equal(config.premovable.enabled, false);
  assert.equal(typeof config.movable.events.after, 'function');
  assert.equal(config.events, undefined);
  const synced = h.boardConfigurations.at(-1);
  assert.equal(synced.draggable.enabled, true);
  assert.equal(synced.movable.color, 'white');
  assert.deepEqual(Array.from(synced.movable.dests.get('e2')), ['e4', 'e3']);
  assert.equal(h.toolCalls.filter(c => !['sync_review_view', 'list_games'].includes(c.name)).length, 0);
});

test('delayed context acknowledgement cannot acknowledge a newer rendered position', async () => {
  const h = harness({ delayedContext: true }); await settle();
  h.nodes.get('next').click(); await settle();
  assert.equal(h.contextCalls.length, 1);
  h.contextWait.resolve({ updateId: 'accepted-old' }); await settle();
  assert.deepEqual(h.contextCalls.map(c => c.structuredContent.revision), [1, 2]);
  await h.timerCallbacks.at(-1)(); await settle();
  const sync = h.toolCalls.at(-1);
  assert.equal(sync.arguments.contextRevision, 2);
  assert.equal(sync.arguments.contextUpdateId, 'accepted-2');
});

test('late synchronization response cannot replace a newer manual position', async () => {
  const h = harness({ delayedSync: true, delayedSyncCall: 2 }); await settle();
  const poll = h.timerCallbacks.at(-1)(); await settle();
  h.nodes.get('next').click(); await settle();
  h.syncWait.resolve({ structuredContent: { state: initial, changed: true } }); await poll; await settle();
  assert.match(h.nodes.get('status').textContent, /connected to chat/);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
});

test('a different session response is rejected without publishing its context', async () => {
  const h = harness({ delayedSync: true }); await settle();
  h.syncWait.resolve({ structuredContent: { state: { ...initial, sessionId: 'review-two', revision: 2 }, changed: true } }); await settle();
  assert.match(h.nodes.get('error').textContent, /different review session/);
  assert.equal(h.contextCalls.length, 0);
});

test('navigation stays disabled and handlers are safe before launch state arrives', async () => {
  const h = harness({ delayedLaunch: true }); await settle();
  for (const id of ['previous', 'next', 'return', 'show-variation']) assert.equal(h.nodes.get(id).disabled, true);
  assert.doesNotThrow(() => h.nodes.get('previous').listeners.click());
  assert.doesNotThrow(() => h.nodes.get('next').listeners.click());
  h.nodes.get('return').click(); await settle();
  assert.equal(h.toolCalls.length, 0);
  assert.equal(h.contextCalls.length, 0);
  h.launchWait.resolve(); await settle();
  assert.equal(h.nodes.get('next').disabled, false);
  assert.equal(h.contextCalls.length, 1);
});

test('remount publishes only the authoritative revision after reading a cached older launch', async () => {
  const latest = { ...initial, revision: 9, selectedPly: 2, fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', moveHistory: ['e4', 'e5'] };
  const h = harness({ initialState: latest, launchState: initial }); await settle();
  assert.deepEqual(h.contextCalls.map(c => c.structuredContent.revision), [9]);
  assert.equal(h.contextCalls[0].structuredContent.fen, latest.fen);
  assert.equal(h.boardConfigurations.at(-1).fen, latest.fen);
  assert.equal(h.toolCalls[0].name, 'sync_review_view');
});

test('unchanged first sync still publishes the canonically confirmed launch revision', async () => {
  const h = harness(); await settle();
  assert.equal(h.toolCalls[0].name, 'sync_review_view');
  assert.equal(h.contextCalls.length, 1);
  assert.equal(h.contextCalls[0].structuredContent.revision, initial.revision);
});

test('failed canonical startup read does not publish or mutate cached launch state', async () => {
  const h = harness({ launchState: initial, initialState: { ...initial, revision: 9 }, toolResponses: {
    sync_review_view: () => { throw new Error('Canonical backend disconnected'); },
  } }); await settle();
  assert.equal(h.contextCalls.length, 0);
  assert.equal(h.nodes.get('next').disabled, true);
  assert.doesNotThrow(() => h.nodes.get('next').listeners.click());
  await settle();
  assert.equal(h.toolCalls.some(call => call.name === 'go_to_move'), false);
  await h.timerCallbacks.at(-1)(); await settle();
  assert.equal(h.contextCalls.length, 0);
  assert.match(h.nodes.get('error').textContent, /backend disconnected/);
});

test('unchanged sync retries failed context with bounded backoff and the latest selection', async () => {
  const h = harness({ failedContextCalls: 2 }); await settle();
  assert.equal(h.contextCalls.length, 1);
  h.setNow(1499); await h.timerCallbacks.at(-1)(); await settle();
  assert.equal(h.contextCalls.length, 1);
  h.setNow(1500); await h.timerCallbacks.at(-1)(); await settle();
  assert.equal(h.contextCalls.length, 2);
  h.nodes.get('next').click(); await settle();
  assert.equal(h.contextCalls.length, 2);
  h.setNow(4499); await h.timerCallbacks.at(-1)(); await settle();
  assert.equal(h.contextCalls.length, 2);
  h.setNow(4500); await h.timerCallbacks.at(-1)(); await settle();
  assert.deepEqual(h.contextCalls.map(c => c.structuredContent.revision), [1, 1, 2]);
  assert.match(h.nodes.get('status').textContent, /connected to chat/);
  assert.equal(h.nodes.get('error').hidden, true);
  await h.timerCallbacks.at(-1)(); await settle();
  const ack = h.toolCalls.at(-1).arguments;
  assert.equal(ack.contextRevision, 2);
  assert.equal(ack.contextUpdateId, 'accepted-2');
});

const ready = { ...initial, selectedPly: 1, game: { timeClass: 'rapid', timeControl: '600' },
  analysis: { readiness: 'ready', playerAccuracy: 93.456, currentPosition: { ready: true, exact: true, cp: 35, fen: initial.fen },
    selectedMove: { ply: 1, san: 'e4', color: 'w', classification: { ready: true, label: 'Good' } },
    keyMoments: [{ ply: 1, san: 'e4', label: 'Good' }] } };
const hiddenRetry = { retryId: 'retry-one', attemptRevision: 1, ply: 1, answerExposed: false,
  hintsUsed: 0, hintLevel: 0, attempts: [], firstAttempt: null };

test('scores and labels are shown only when canonical analysis is ready', async () => {
  const pending = harness({ initialState: { ...ready, analysis: { ...ready.analysis, readiness: 'analyzing' } } }); await settle();
  assert.equal(pending.nodes.get('assessment').hidden, true);
  assert.equal(pending.nodes.get('accuracy').textContent, '');
  assert.equal(pending.nodes.get('classification').textContent, '');
  assert.equal(pending.nodes.get('key-moments-panel').hidden, true);
  assert.equal(pending.nodes.get('start-retry').disabled, true);
  const complete = harness({ initialState: ready }); await settle();
  assert.equal(complete.nodes.get('assessment').hidden, false);
  assert.equal(complete.nodes.get('accuracy').textContent, '93.5');
  assert.equal(complete.nodes.get('classification').textContent, 'e4 · Good');
  assert.equal(complete.nodes.get('evaluation').textContent, 'White +0.35');
  assert.equal(complete.nodes.get('start-retry').disabled, false);
});

test('hidden retry and first hint hide answer evidence and future navigation', async () => {
  const h = harness({ initialState: { ...ready, retry: { ...hiddenRetry, hintLevel: 1, hintsUsed: 1, hint: 'Look for a move by the knight on g1.' },
    learning: { savedMistakes: [{ gameId: 'other', ply: 3, classification: { label: 'Blunder' } }] } } }); await settle();
  assert.equal(h.nodes.get('assessment').hidden, true);
  assert.equal(h.nodes.get('accuracy').textContent, '');
  assert.equal(h.nodes.get('evaluation').textContent, '');
  assert.equal(h.nodes.get('classification').textContent, '');
  assert.equal(h.nodes.get('key-moments').children.length, 0);
  assert.equal(h.nodes.get('saved-mistakes').children.length, 0);
  for (const id of ['previous', 'next', 'return', 'game', 'analyze']) assert.equal(h.nodes.get(id).disabled, true);
  assert.equal(h.nodes.get('variation-form').hidden, true);
  assert.equal(h.nodes.get('retry-answer').hidden, true);
  assert.equal(h.nodes.get('retry-answer').textContent, '');
  assert.equal(h.nodes.get('retry-hint').textContent, 'Reveal checked move');
  assert.match(h.nodes.get('retry-feedback').textContent, /knight on g1/);
});

test('retry sends session and attempt revisions and displays a checked accepted alternative', async () => {
  const attempt = { san: 'Nf3', uci: 'g1f3', ready: true, accepted: true, assisted: false };
  const h = harness({ initialState: { ...ready, retry: hiddenRetry }, toolResponses: {
    submit_retry: (call, canonical) => {
      assert.equal(call.arguments.sessionId, 'review-one'); assert.equal(call.arguments.expectedRevision, 1);
      assert.equal(call.arguments.retryId, 'retry-one'); assert.equal(call.arguments.attemptRevision, 1);
      assert.equal(call.arguments.move, 'Nf3');
      return { ...canonical, revision: 2, retry: { ...hiddenRetry, attemptRevision: 3, answerExposed: true,
        attempts: [attempt], firstAttempt: attempt, checkedAnswer: { move: 'e2e4', line: ['e2e4', 'e7e5'] } } };
    },
  } }); await settle();
  h.getNode('retry-move').value = 'Nf3';
  h.nodes.get('retry-form').listeners.submit({ preventDefault() {} }); await settle();
  assert.match(h.nodes.get('retry-feedback').textContent, /accepted as a sound move/);
  assert.match(h.nodes.get('retry-history').textContent, /First attempt: unassisted/);
  assert.match(h.nodes.get('retry-answer').textContent, /e2e4/);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
});

test('pending and interrupted retry analysis are not displayed as rejected moves', async () => {
  for (const status of ['pending', 'interrupted']) {
    const attempt = { san: 'Nf3', ready: false, accepted: null, status, assisted: false };
    const h = harness({ initialState: { ...ready, retry: { ...hiddenRetry, answerExposed: true, attempts: [attempt], firstAttempt: attempt } } }); await settle();
    assert.doesNotMatch(h.nodes.get('retry-feedback').textContent, /not within|accepted as/);
    assert.match(h.nodes.get('retry-feedback').textContent, status === 'pending' ? /checking the move/ : /analysis interrupted/);
    assert.equal(h.nodes.get('submit-retry').disabled, status === 'pending');
    assert.equal(h.boardConfigurations.at(-1).draggable.enabled, status !== 'pending');
  }
});

test('failed username refresh keeps saved games available and reports the import failure', async () => {
  const games = [{ id: initial.gameId, fixture: true, sourceLabel: 'Verification fixture' }, { id: 'saved-game', white: { username: 'Public fixture' }, black: { username: 'Opponent' }, playerColor: 'white', timeClass: 'rapid', timeControl: '600', endTime: 0 }];
  const h = harness({ catalogResult: { username: null, games }, toolResponses: {
    refresh_games: call => { assert.equal(call.arguments.username, 'Public fixture'); return { username: 'Public fixture', games, import: { status: 'error', error: { message: 'Temporary public API error' } } }; },
  } }); await settle();
  assert.equal(h.nodes.get('username').value, '');
  h.nodes.get('username').value = 'Public fixture';
  h.nodes.get('import-form').listeners.submit({ preventDefault() {} }); await settle();
  assert.equal(h.nodes.get('game').children.length, 2);
  assert.equal(h.nodes.get('game').disabled, false);
  assert.match(h.nodes.get('error').textContent, /Temporary public API error/);
});

test('game switching uses the canonical session guard and publishes the selected game', async () => {
  const h = harness({ catalogResult: { username: null, games: [{ id: initial.gameId, fixture: true }, { id: 'other-game', fixture: true }] }, toolResponses: {
    select_game: (call, canonical) => { assert.equal(call.arguments.sessionId, 'review-one'); assert.equal(call.arguments.expectedRevision, 1); assert.equal(call.arguments.gameId, 'other-game'); return { ...canonical, gameId: 'other-game', revision: 2 }; },
  } }); await settle();
  h.nodes.get('game').value = 'other-game'; h.nodes.get('game').listeners.change(); await settle();
  assert.equal(h.contextCalls.at(-1).structuredContent.gameId, 'other-game');
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
  assert.equal(h.nodes.get('game-picker').hidden, true);
  assert.equal(h.nodes.get('game-picker-title').focusCount, 1);
});

test('game picker keeps playable sample visible and opens import only for an empty catalog', async () => {
  const unset = harness(); await settle();
  assert.equal(unset.nodes.get('game-picker').hidden, true);
  assert.equal(unset.nodes.get('game-picker-title').attributes['aria-expanded'], 'false');
  assert.equal(unset.nodes.get('username').value, '');
  const remembered = harness({ catalogResult: { username: 'SuppliedPublicAccount', games: [{ id: initial.gameId, fixture: true }] } }); await settle();
  assert.equal(remembered.nodes.get('game-picker').hidden, true);
  assert.equal(remembered.nodes.get('game-picker-title').attributes['aria-expanded'], 'false');
  assert.equal(remembered.nodes.get('username').value, 'SuppliedPublicAccount');
  const empty = harness({ catalogResult: { username: null, games: [] } }); await settle();
  assert.equal(empty.nodes.get('game-picker').hidden, false);
});

test('player bars follow canonical board orientation, actual ratings and side to move', async () => {
  for (const playerColor of ['white', 'black']) {
    const h = harness({ initialState: { ...ready, playerColor, sideToMove: 'black',
      game: { ...ready.game, white: { username: 'WhiteAccount', rating: 1450 }, black: { username: 'BlackAccount' } } } }); await settle();
    const whitePlayer = playerColor === 'white';
    assert.equal(h.nodes.get('player-name').textContent, whitePlayer ? 'WhiteAccount' : 'BlackAccount');
    assert.equal(h.nodes.get('opponent-name').textContent, whitePlayer ? 'BlackAccount' : 'WhiteAccount');
    assert.equal(h.nodes.get('player-piece').dataset.color, playerColor);
    assert.equal(h.nodes.get('player-rating').hidden, !whitePlayer);
    assert.equal(h.nodes.get('player-rating').textContent, whitePlayer ? '1450' : '');
    assert.equal(h.nodes.get('player-turn').hidden, whitePlayer);
    assert.equal(h.nodes.get('opponent-turn').hidden, !whitePlayer);
  }
});

test('analysis progress uses actual completed position counts and no estimated percentage', async () => {
  const h = harness({ initialState: { ...initial, analysis: { readiness: 'analyzing', completedPositions: 3, totalPositions: 12 } } }); await settle();
  assert.equal(h.nodes.get('analysis-status').textContent, 'Analyzing game · 3 of 12 positions');
  assert.equal(h.nodes.get('analysis-meter').hidden, false);
  assert.equal(h.nodes.get('analysis-meter').value, 3);
  assert.equal(h.nodes.get('analysis-meter').max, 12);
  assert.equal(h.nodes.get('analyze').hidden, true);
  const unknown = harness({ initialState: { ...initial, analysis: { readiness: 'analyzing' } } }); await settle();
  assert.equal(unknown.nodes.get('analysis-meter').hidden, true);
  assert.equal(unknown.nodes.get('analysis-status').textContent, 'Analyzing game…');
});

test('key moments navigate through canonical guards and identify the selected move', async () => {
  const h = harness({ initialState: ready }); await settle();
  const moment = h.nodes.get('key-moments').children[0];
  assert.equal(moment.attributes['aria-current'], 'true');
  assert.equal(moment.dataset.grade, 'Good');
  moment.click(); await settle();
  const call = h.toolCalls.find(call => call.name === 'go_to_move');
  assert.equal(call.arguments.ply, 1);
  assert.equal(call.arguments.sessionId, ready.sessionId);
  assert.equal(call.arguments.expectedRevision, ready.revision);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
});

test('fixture attribution is visible while normal source and connection details stay out of the visual workspace', async () => {
  const fixture = harness({ initialState: { ...initial, sourceLabel: 'Verification fixture (not Brian’s game)' } }); await settle();
  assert.equal(fixture.nodes.get('game-source').hidden, false);
  assert.equal(fixture.nodes.get('game-source').textContent, 'Verification fixture (not Brian’s game)');
  assert.equal(fixture.nodes.get('game-title').textContent, 'Sample game');
  const imported = harness({ initialState: { ...ready, sourceLabel: 'Chess.com public archive' }, catalogResult: { username: 'SuppliedPublicAccount', games: [{ id: ready.gameId }] } }); await settle();
  assert.equal(imported.nodes.get('game-source').hidden, true);
  assert.equal(imported.nodes.get('summary').textContent, 'Chess.com public archive');
  assert.match(source, /id="summary" class="sr-only"/);
  assert.match(source, /id="status" class="sr-only"/);
  assert.equal(imported.nodes.get('analyze').hidden, true);
  assert.equal(imported.nodes.get('return').hidden, true);
});

test('retrying a move already displayed on the board records prior answer exposure', async () => {
  const h = harness({ initialState: ready, toolResponses: {
    start_retry: (call, canonical) => {
      assert.equal(call.arguments.sessionId, ready.sessionId);
      assert.equal(call.arguments.expectedRevision, ready.revision);
      assert.equal(call.arguments.ply, 1);
      assert.equal(call.arguments.answerPreviouslyShown, true);
      return { ...canonical, revision: 2, retry: { ...hiddenRetry, answerPreviouslyShown: true } };
    },
  } }); await settle();
  h.nodes.get('start-retry').click(); await settle();
  assert.equal(h.nodes.get('retry-panel').hidden, false);
  assert.equal(h.nodes.get('assessment').hidden, true);
  assert.equal(h.nodes.get('position').focusCount, 1);
  assert.match(h.nodes.get('retry-history').textContent, /answer was viewed before this retry/);
});

test('ending a retry restores keyboard focus to the current move', async () => {
  const h = harness({ initialState: { ...ready, retry: hiddenRetry }, toolResponses: {
    end_retry: (call, canonical) => ({ ...canonical, revision: 2, retry: undefined }),
  } }); await settle();
  h.nodes.get('end-retry').click(); await settle();
  assert.equal(h.nodes.get('retry-panel').hidden, true);
  assert.equal(h.nodes.get('position').focusCount, 1);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
});

const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
function drop(h, from, to) { h.boardConfigurations.at(-1).movable.events.after(from, to); }

test('board move restores canonical FEN while waiting and displays only the committed variation', async () => {
  const response = deferred();
  const h = harness({ toolResponses: {
    show_variation: async (call, canonical) => {
      assert.equal(call.arguments.sessionId, initial.sessionId);
      assert.equal(call.arguments.expectedRevision, 1);
      assert.deepEqual(Array.from(call.arguments.moves), ['e2e4']);
      assert.equal(h.boardConfigurations.at(-1).fen, initial.fen);
      assert.equal(h.boardConfigurations.at(-1).draggable.enabled, false);
      await response.promise;
      return { ...canonical, revision: 2, fen: afterE4, sideToMove: 'black', variation: ['e4'], legalMoves: [{ from: 'e7', to: 'e5' }] };
    },
  } }); await settle();
  const staleDrop = h.boardConfigurations.at(-1).movable.events.after;
  drop(h, 'e2', 'e4'); await settle();
  assert.equal(h.boardConfigurations.at(-1).fen, initial.fen);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 1);
  staleDrop('g1', 'f3'); await settle();
  assert.equal(h.toolCalls.filter(call => call.name === 'show_variation').length, 1);
  response.resolve(); await settle();
  assert.equal(h.boardConfigurations.at(-1).fen, afterE4);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
  assert.deepEqual(Array.from(h.canonical.playedMoves), ['e4', 'e5']);
});

test('illegal drops and unsynchronized board callbacks cannot submit a move', async () => {
  const h = harness(); await settle();
  drop(h, 'e2', 'e5'); await settle();
  assert.equal(h.toolCalls.filter(call => call.name === 'show_variation').length, 0);
  assert.equal(h.boardConfigurations.at(-1).fen, initial.fen);
  assert.match(h.nodes.get('error').textContent, /not legal/);
  const waiting = harness({ delayedSync: true }); await settle();
  drop(waiting, 'e2', 'e4'); await settle();
  assert.equal(waiting.boardConfigurations.at(-1).draggable.enabled, false);
  assert.equal(waiting.toolCalls.filter(call => call.name === 'show_variation').length, 0);
});

test('board move appends to the active variation without changing the played line', async () => {
  const h = harness({ initialState: { ...initial, fen: afterE4, sideToMove: 'black', variation: ['e4'], legalMoves: [{ from: 'e7', to: 'e5' }] }, toolResponses: {
    show_variation: (call, canonical) => {
      assert.deepEqual(Array.from(call.arguments.moves), ['e4', 'e7e5']);
      return { ...canonical, revision: 2, variation: ['e4', 'e5'] };
    },
  } }); await settle();
  drop(h, 'e7', 'e5'); await settle();
  assert.deepEqual(Array.from(h.canonical.playedMoves), ['e4', 'e5']);
  assert.equal(h.canonical.selectedPly, 0);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
});

test('hidden retry board move submits explicit session and attempt guards', async () => {
  const h = harness({ initialState: { ...ready, retry: hiddenRetry }, toolResponses: {
    submit_retry: (call, canonical) => {
      assert.equal(call.arguments.sessionId, ready.sessionId);
      assert.equal(call.arguments.expectedRevision, 1);
      assert.equal(call.arguments.retryId, hiddenRetry.retryId);
      assert.equal(call.arguments.attemptRevision, 1);
      assert.equal(call.arguments.move, 'g1f3');
      return { ...canonical, revision: 2, retry: { ...hiddenRetry, attemptRevision: 3, answerExposed: true, attempts: [{ san: 'Nf3', ready: true, accepted: true }] } };
    },
  } }); await settle();
  drop(h, 'g1', 'f3'); await settle();
  assert.equal(h.toolCalls.filter(call => call.name === 'show_variation').length, 0);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
  assert.match(h.nodes.get('retry-feedback').textContent, /accepted as a sound move/);
});

const promotionPosition = { ...initial, fen: '7k/P7/8/8/8/8/8/7K w - - 0 1',
  legalMoves: ['q', 'r', 'b', 'n'].map(promotion => ({ from: 'a7', to: 'a8', promotion })) };

test('promotion requires an explicit accessible legal piece choice before submission', async () => {
  const h = harness({ initialState: promotionPosition, toolResponses: {
    show_variation: (call, canonical) => {
      assert.deepEqual(Array.from(call.arguments.moves), ['a7a8n']);
      return { ...canonical, revision: 2, variation: ['a8=N'], fen: 'N6k/8/8/8/8/8/8/7K b - - 0 1' };
    },
  } }); await settle();
  drop(h, 'a7', 'a8'); await settle();
  assert.equal(h.nodes.get('promotion-panel').hidden, false);
  assert.deepEqual(h.nodes.get('promotion-choices').children.map(button => button.textContent), ['Queen', 'Rook', 'Bishop', 'Knight']);
  assert.equal(h.nodes.get('promotion-choices').children[3].attributes['aria-label'], 'Promote to knight');
  assert.equal(h.boardConfigurations.at(-1).fen, promotionPosition.fen);
  assert.equal(h.boardConfigurations.at(-1).draggable.enabled, false);
  assert.equal(h.toolCalls.filter(call => call.name === 'show_variation').length, 0);
  h.nodes.get('promotion-choices').children[3].click(); await settle();
  assert.equal(h.nodes.get('promotion-panel').hidden, true);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
  assert.equal(h.boardConfigurations.at(-1).fen, 'N6k/8/8/8/8/8/8/7K b - - 0 1');
});

test('cancelled promotion restores the position and stale choices cannot commit', async () => {
  const h = harness({ initialState: promotionPosition }); await settle();
  drop(h, 'a7', 'a8'); await settle();
  const oldChoice = h.nodes.get('promotion-choices').children[0];
  h.nodes.get('cancel-promotion').click(); await settle();
  oldChoice.click(); await settle();
  assert.equal(h.nodes.get('promotion-panel').hidden, true);
  assert.equal(h.nodes.get('position').focusCount, 1);
  assert.equal(h.boardConfigurations.at(-1).fen, promotionPosition.fen);
  assert.equal(h.boardConfigurations.at(-1).draggable.enabled, true);
  assert.equal(h.toolCalls.filter(call => call.name === 'show_variation').length, 0);
});

test('failed board move leaves the canonical position and PGN line unchanged', async () => {
  const h = harness({ toolResponses: { show_variation: () => { throw new Error('Move rejected by server'); } } }); await settle();
  drop(h, 'e2', 'e4'); await settle();
  assert.equal(h.boardConfigurations.at(-1).fen, initial.fen);
  assert.deepEqual(Array.from(h.canonical.playedMoves), ['e4', 'e5']);
  assert.equal(h.canonical.revision, 1);
  assert.match(h.nodes.get('error').textContent, /Move rejected/);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 1);
});

test('a newer canonical revision cancels pending promotion and rejects the old choice', async () => {
  let reads = 0;
  const h = harness({ initialState: promotionPosition, toolResponses: {
    sync_review_view: () => ({ state: ++reads === 1 ? promotionPosition : { ...promotionPosition, revision: 2, selectedPly: 1 }, changed: true }),
  } }); await settle();
  drop(h, 'a7', 'a8'); await settle();
  const oldChoice = h.nodes.get('promotion-choices').children[0];
  await h.timerCallbacks.at(-1)(); await settle();
  assert.equal(h.nodes.get('promotion-panel').hidden, true);
  oldChoice.click(); await settle();
  assert.equal(h.toolCalls.filter(call => call.name === 'show_variation').length, 0);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
});

test('resuming a retry keeps the unset-account picker collapsed and its button toggles accessibly', async () => {
  const h = harness({ initialState: { ...ready, retry: hiddenRetry } }); await settle();
  assert.equal(h.nodes.get('username').value, '');
  assert.equal(h.nodes.get('game-picker').hidden, true);
  assert.equal(h.nodes.get('game-picker-title').attributes['aria-expanded'], 'false');
  h.nodes.get('game-picker-title').click();
  assert.equal(h.nodes.get('game-picker').hidden, false);
  assert.equal(h.nodes.get('game-picker-title').attributes['aria-expanded'], 'true');
  h.nodes.get('game-picker-title').click();
  assert.equal(h.nodes.get('game-picker').hidden, true);
  assert.equal(h.nodes.get('game-picker-title').attributes['aria-expanded'], 'false');
});

const guided = { ...ready, analysis: { ...ready.analysis, accuracy: { w: 93.456, b: 87.65 },
  currentPosition: { ready: true, exact: true, fen: initial.fen, cp: 35, bestMove: 'g1f3', pv: ['g1f3', 'e7e5'] } } };

test('checked legal engine guide draws a best move arrow and both players show canonical accuracy', async () => {
  const h = harness({ initialState: guided }); await settle();
  assert.equal(h.nodes.get('accuracy').textContent, '93.5');
  assert.equal(h.nodes.get('opponent-accuracy').textContent, 'Accuracy 87.7');
  assert.equal(h.nodes.get('engine-play').disabled, false);
  assert.equal(h.nodes.get('engine-status').textContent, 'Best: Nf3');
  assert.equal(h.boardConfigurations.at(-1).drawable.autoShapes[0].orig, 'g1');
  assert.equal(h.boardConfigurations.at(-1).drawable.autoShapes[0].dest, 'f3');
  assert.equal(h.nodes.get('engine-line').children[0].textContent, 'Nf3');
  h.nodes.get('engine-toggle').click();
  assert.equal(h.nodes.get('engine-play').hidden, true);
  assert.equal(h.nodes.get('engine-line').children.length, 0);
  assert.equal(h.boardConfigurations.at(-1).drawable.autoShapes.length, 0);
  const black = harness({ initialState: { ...guided, playerColor: 'black' } }); await settle();
  assert.equal(black.nodes.get('accuracy').textContent, '87.7');
  assert.equal(black.nodes.get('opponent-accuracy').textContent, 'Accuracy 93.5');
});

test('illegal or wrong-FEN engine evidence never draws an arrow or enables play', async () => {
  for (const evidence of [{ ...guided.analysis.currentPosition, fen: afterE4 }, { ...guided.analysis.currentPosition, bestMove: 'e2e5', pv: ['e2e5'] }, { ...guided.analysis.currentPosition, exact: false }]) {
    const h = harness({ initialState: { ...guided, analysis: { ...guided.analysis, currentPosition: evidence } } }); await settle();
    assert.equal(h.boardConfigurations.at(-1).drawable.autoShapes.length, 0);
    assert.equal(h.nodes.get('engine-play').disabled, true);
  }
});

test('hidden retry suppresses scores, engine arrows, continuation and evidence requests', async () => {
  const h = harness({ initialState: { ...guided, retry: hiddenRetry } }); await settle();
  assert.equal(h.nodes.get('opponent-accuracy').hidden, true);
  assert.equal(h.nodes.get('accuracy').textContent, '');
  assert.equal(h.nodes.get('engine-guide').hidden, true);
  assert.equal(h.nodes.get('engine-line').children.length, 0);
  assert.equal(h.boardConfigurations.at(-1).drawable.autoShapes.length, 0);
  assert.equal(h.toolCalls.filter(call => call.name === 'get_position_evidence').length, 0);
  assert.equal(h.nodes.get('board-instruction').textContent, 'Move a piece to try again');
});

test('variation guide fetches explicit checked evidence and plays the next move through canonical guards', async () => {
  const chess = new Chess(afterE4); chess.move('e5');
  const h = harness({ initialState: { ...guided, fen: afterE4, sideToMove: 'black', variation: ['e4'], legalMoves: [{ from: 'e7', to: 'e5' }], analysis: { ...guided.analysis, currentPosition: null } }, toolResponses: {
    get_position_evidence: (call, canonical) => { assert.equal(call.arguments.sessionId, initial.sessionId); assert.equal(call.arguments.expectedRevision, canonical.revision); return { sessionId: canonical.sessionId, revision: canonical.revision, fen: canonical.fen, evidence: { ready: true, exact: true, cp: 15, bestMove: canonical.revision === 1 ? 'e7e5' : 'g1f3', pv: canonical.revision === 1 ? ['e7e5', 'g1f3'] : ['g1f3'] } }; },
    show_variation: (call, canonical) => { assert.deepEqual(Array.from(call.arguments.moves), ['e4', 'e7e5']); return { ...canonical, revision: 2, fen: chess.fen(), sideToMove: 'white', variation: ['e4', 'e5'], legalMoves: [{ from: 'g1', to: 'f3' }] }; },
  } }); await settle();
  assert.equal(h.nodes.get('engine-status').textContent, 'Best: e5');
  assert.equal(h.nodes.get('classification').textContent, '');
  assert.equal(h.nodes.get('engine-play').textContent, 'Play next');
  h.nodes.get('engine-play').click(); await settle();
  assert.equal(h.boardConfigurations.at(-1).fen, chess.fen());
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
  assert.equal(h.nodes.get('engine-status').textContent, 'Best: Nf3');
});

test('late variation evidence cannot expose an answer after entering a hidden retry', async () => {
  const evidence = deferred();
  const h = harness({ initialState: { ...guided, variation: ['e4'], analysis: { ...guided.analysis, currentPosition: null } }, toolResponses: {
    get_position_evidence: () => evidence.promise,
    start_retry: (call, canonical) => ({ ...canonical, revision: 2, variation: [], retry: hiddenRetry }),
  } }); await settle();
  h.nodes.get('start-retry').click(); await settle();
  evidence.resolve({ sessionId: initial.sessionId, revision: 1, fen: initial.fen, evidence: guided.analysis.currentPosition }); await settle();
  assert.equal(h.nodes.get('engine-guide').hidden, true);
  assert.equal(h.boardConfigurations.at(-1).drawable.autoShapes.length, 0);
  assert.equal(h.nodes.get('engine-line').children.length, 0);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
});

test('analysis-in-progress variation does not launch competing engine searches', async () => {
  const h = harness({ initialState: { ...initial, variation: ['e4'], analysis: { readiness: 'analyzing', phase: 'moves', currentMove: 8, totalMoves: 20, completedPositions: 21, totalPositions: 21 } } }); await settle();
  assert.equal(h.toolCalls.filter(call => call.name === 'get_position_evidence').length, 0);
  assert.equal(h.nodes.get('analysis-status').textContent, 'Checking move 4 of 10 · Black');
  assert.equal(h.nodes.get('analysis-meter').value, 8);
  assert.equal(h.nodes.get('analysis-meter').max, 20);
  assert.equal(h.nodes.get('engine-status').textContent, '');
  assert.equal(h.boardConfigurations.at(-1).draggable.enabled, true);
});

test('keyboard moves append to the current branch and Previous backs out only one explored move', async () => {
  const h = harness({ initialState: { ...initial, fen: afterE4, variation: ['e4'], sideToMove: 'black', legalMoves: [{ from: 'e7', to: 'e5' }] }, toolResponses: {
    show_variation: (call, canonical) => ({ ...canonical, revision: canonical.revision + 1, variation: Array.from(call.arguments.moves) }),
  } }); await settle();
  h.getNode('variation').value = 'e5';
  h.nodes.get('variation-form').listeners.submit({ preventDefault() {} }); await settle();
  assert.deepEqual(Array.from(h.toolCalls.find(call => call.name === 'show_variation').arguments.moves), ['e4', 'e5']);
  h.nodes.get('previous').click(); await settle();
  assert.deepEqual(Array.from(h.canonical.variation), ['e4']);
  assert.equal(h.toolCalls.filter(call => call.name === 'go_to_move').length, 0);
  assert.equal(h.nodes.get('variation-trail').children.length, 1);
});

test('progress-only stale click reads fresh context despite an in-flight poll and retries once', async () => {
  let attempts = 0;
  const h = harness({ delayedSync: true, delayedSyncCall: 2, toolResponses: {
    go_to_move: (call, canonical) => { attempts++; if (attempts === 1) throw new Error('Stale revision: expected 1, current 2'); assert.equal(call.arguments.expectedRevision, 2); return { ...canonical, revision: 3, selectedPly: call.arguments.ply }; },
    get_review_context: () => ({ ...initial, revision: 2, analysis: { readiness: 'analyzing', completedPositions: 1, totalPositions: 3 } }),
  } }); await settle();
  const polling = h.timerCallbacks.at(-1)(); await settle();
  h.nodes.get('next').click(); await settle();
  assert.equal(attempts, 2);
  assert.equal(h.toolCalls.filter(call => call.name === 'get_review_context').length, 1);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 3);
  h.syncWait.resolve({ structuredContent: { state: initial, changed: true } }); await polling; await settle();
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 3);
});

test('stale click never replays its intent on a changed position and retry submissions never auto-repeat', async () => {
  let attempts = 0;
  const changed = harness({ toolResponses: {
    go_to_move: () => { attempts++; throw new Error('Stale revision: expected 1, current 2'); },
    get_review_context: () => ({ ...initial, revision: 2, fen: afterE4, selectedPly: 1 }),
  } }); await settle(); changed.nodes.get('next').click(); await settle();
  assert.equal(attempts, 1);
  assert.match(changed.nodes.get('error').textContent, /position changed/);
  let submissions = 0;
  const retry = harness({ initialState: { ...ready, retry: hiddenRetry }, toolResponses: { submit_retry: () => { submissions++; throw new Error('Stale revision: current 2'); } } }); await settle();
  drop(retry, 'g1', 'f3'); await settle();
  assert.equal(submissions, 1);
  assert.equal(retry.toolCalls.filter(call => call.name === 'get_review_context').length, 0);
});

test('semantic game change cancels an existing drag before the library can invoke its new callback', async () => {
  const h = harness({ catalogResult: { username: null, games: [{ id: initial.gameId, fixture: true }, { id: 'other-game', fixture: true }] }, toolResponses: {
    select_game: (call, canonical) => ({ ...canonical, gameId: 'other-game', revision: 2 }),
  } }); await settle();
  h.board.beginDrag('g1');
  h.nodes.get('game').value = 'other-game'; h.nodes.get('game').listeners.change(); await settle();
  assert.equal(h.board.dragOrigin, undefined);
  h.board.drop('f3'); await settle();
  assert.equal(h.toolCalls.filter(call => call.name === 'show_variation').length, 0);
});

test('one overlay is open at a time and Escape restores focus and board interaction', async () => {
  const h = harness(); await settle();
  h.nodes.get('learning-panel').open = true; h.nodes.get('learning-panel').listeners.toggle();
  assert.equal(h.nodes.get('workspace-content').inert, true);
  h.nodes.get('game-picker-title').click();
  assert.equal(h.nodes.get('learning-panel').open, false);
  assert.equal(h.nodes.get('game-picker').hidden, false);
  h.nodes.get('variation-panel').open = true; h.nodes.get('variation-panel').listeners.toggle();
  assert.equal(h.nodes.get('game-picker').hidden, true);
  h.document.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(h.nodes.get('keyboard-toggle').focusCount, 1);
  assert.equal(h.nodes.get('workspace-content').inert, false);
});

test('explicit import from sample selects newest real game while background refresh preserves selection', async () => {
  const games = [{ id: initial.gameId, fixture: true }, { id: 'older-real', endTime: 500 }, { id: 'newest-real', endTime: 1000 }];
  const explicit = harness({ initialState: { ...initial, sourceLabel: 'Verification fixture (not Brian’s game)' }, toolResponses: {
    refresh_games: () => ({ username: 'SuppliedAccount', games, import: { status: 'ready' } }),
    select_game: (call, canonical) => { assert.equal(call.arguments.gameId, 'newest-real'); assert.equal(call.arguments.expectedRevision, 1); return { ...canonical, gameId: call.arguments.gameId, revision: 2, sourceLabel: 'Chess.com public archive' }; },
  } }); await settle();
  explicit.nodes.get('username').value = 'SuppliedAccount';
  explicit.nodes.get('import-form').listeners.submit({ preventDefault() {} }); await settle();
  assert.equal(explicit.canonical.gameId, 'newest-real');
  assert.equal(explicit.nodes.get('game-picker').hidden, true);
  const background = harness({ catalogResult: { username: 'SuppliedAccount', games: [{ id: initial.gameId, fixture: true }] }, toolResponses: {
    refresh_games: () => ({ username: 'SuppliedAccount', games, import: { status: 'ready' } }),
  } }); await settle();
  assert.equal(background.canonical.gameId, initial.gameId);
  assert.equal(background.toolCalls.filter(call => call.name === 'select_game').length, 0);
});

test('successful keyboard move closes the overlay and restores board focus while an error remains correctable', async () => {
  for (const succeeds of [true, false]) {
    const h = harness({ toolResponses: {
      show_variation: (call, canonical) => { if (!succeeds) throw new Error('Illegal move input'); return { ...canonical, revision: 2, fen: afterE4, variation: ['e4'] }; },
    } }); await settle();
    h.nodes.get('variation-panel').open = true; h.nodes.get('variation-panel').listeners.toggle();
    h.getNode('variation').value = 'e4';
    h.nodes.get('variation-form').listeners.submit({ preventDefault() {} }); await settle();
    assert.equal(h.nodes.get('variation-panel').open, !succeeds);
    assert.equal(h.nodes.get('workspace-content').inert, !succeeds);
    if (succeeds) { assert.equal(h.nodes.get('position').focusCount, 1); assert.equal(h.boardConfigurations.at(-1).fen, afterE4); }
    else { assert.equal(h.nodes.get('drawer-error').hidden, false); assert.match(h.nodes.get('drawer-error').textContent, /Illegal move input/); }
  }
});

test('displayed player guide records exposure through one cached canonical evidence read', async () => {
  const shown = harness({ initialState: guided }); await settle();
  const reads = shown.toolCalls.filter(call => call.name === 'get_position_evidence');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].arguments.sessionId, guided.sessionId);
  assert.equal(reads[0].arguments.expectedRevision, guided.revision);
  await shown.timerCallbacks.at(-1)(); await settle();
  assert.equal(shown.toolCalls.filter(call => call.name === 'get_position_evidence').length, 1);
  const opponent = harness({ initialState: { ...guided, playerColor: 'black' } }); await settle();
  assert.equal(opponent.toolCalls.filter(call => call.name === 'get_position_evidence').length, 0);
  const off = harness({ initialState: guided, delayedSync: true }); await settle();
  off.nodes.get('engine-toggle').click();
  off.syncWait.resolve({ structuredContent: { state: guided, changed: true } }); await settle();
  assert.equal(off.toolCalls.filter(call => call.name === 'get_position_evidence').length, 0);
  assert.equal(off.boardConfigurations.at(-1).drawable.autoShapes.length, 0);
  const hidden = harness({ initialState: { ...guided, retry: hiddenRetry } }); await settle();
  assert.equal(hidden.toolCalls.filter(call => call.name === 'get_position_evidence').length, 0);
});
