import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../src/ui.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const initial = { sessionId: 'review-one', gameId: 'fixture', revision: 1, selectedPly: 0,
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', playerColor: 'white',
  sideToMove: 'white', moveHistory: [], variation: [], playedMoves: ['e4', 'e5'], analysis: { readiness: 'pending' } };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }

function harness({ delayedContext = false, delayedSync = false, delayedLaunch = false, failedContextCalls = 0 } = {}) {
  const nodes = new Map();
  function node() {
    return { textContent: '', value: '', hidden: false, disabled: false, listeners: {}, children: [], dataset: {},
      append(...children) { this.children.push(...children); }, setAttribute() {},
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
  let canonical = { ...initial }, appInstance;
  class App {
    constructor() { appInstance = this; }
    addEventListener() {}
    getHostContext() { return { displayMode: 'fullscreen', availableDisplayModes: ['fullscreen'], theme: 'light' }; }
    async connect() { if (delayedLaunch) await launchWait.promise; this.ontoolresult({ structuredContent: canonical }); }
    async callServerTool(call) {
      toolCalls.push(call);
      if (call.name === 'sync_review_view') {
        if (delayedSync && toolCalls.filter(c => c.name === 'sync_review_view').length === 1) return syncWait.promise;
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
    return { set(next) { boardConfigurations.push(next); }, destroy() {} };
  }
  runInNewContext(source, { App, OpenAIExtensions, Chessground, document, window: { addEventListener() {} },
    crypto: { randomUUID: () => 'mount-one' },
    Date: { now: () => now },
    applyDocumentTheme() {}, applyHostStyleVariables() {},
    setTimeout(fn) { timerCallbacks.push(fn); return timerCallbacks.length; }, clearTimeout() {}, console });
  return { nodes, contextCalls, toolCalls, timerCallbacks, boardConfigurations, contextWait, syncWait, launchWait, setNow(value) { now = value; },
    get canonical() { return canonical; }, get app() { return appInstance; } };
}

test('manual navigation commits explicitly then publishes the returned canonical revision', async () => {
  const h = harness(); await settle();
  assert.equal(h.boardConfigurations[0].fen, initial.fen);
  assert.equal(h.boardConfigurations[0].viewOnly, true);
  assert.equal(h.boardConfigurations[0].coordinatesOnSquares, false);
  assert.match(h.nodes.get('accessible-position').textContent, /White king e1/);
  assert.equal(h.contextCalls[0].structuredContent.revision, 1);
  h.nodes.get('next').click(); await settle();
  const mutation = h.toolCalls.find(c => c.name === 'go_to_move');
  assert.equal(mutation.arguments.sessionId, 'review-one');
  assert.equal(mutation.arguments.expectedRevision, 1);
  assert.equal(mutation.arguments.ply, 1);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
  assert.match(h.nodes.get('status').textContent, /context accepted/);
  await h.timerCallbacks.at(-1)(); await settle();
  const ack = h.toolCalls.at(-1).arguments;
  assert.equal(ack.displayedRevision, 2);
  assert.equal(ack.contextRevision, 2);
  assert.equal(ack.contextUpdateId, 'accepted-2');
});

test('component receives canonical FEN and orientation without local-authority move handlers', async () => {
  const h = harness(); await settle();
  const config = h.boardConfigurations[0];
  assert.equal(config.orientation, 'white');
  assert.equal(config.turnColor, 'white');
  assert.equal(config.movable.free, false);
  assert.equal(config.draggable.enabled, false);
  assert.equal(config.premovable.enabled, false);
  assert.equal(config.movable.events, undefined);
  assert.equal(config.events, undefined);
  assert.equal(h.toolCalls.filter(c => c.name !== 'sync_review_view').length, 0);
});

test('delayed context acknowledgement cannot acknowledge a newer rendered position', async () => {
  const h = harness({ delayedContext: true }); await settle();
  h.nodes.get('next').click(); await settle();
  assert.equal(h.contextCalls.length, 1);
  h.contextWait.resolve({ updateId: 'accepted-old' }); await settle();
  assert.deepEqual(h.contextCalls.map(c => c.structuredContent.revision), [1, 2]);
  const sync = h.toolCalls.find(c => c.name === 'sync_review_view');
  assert.equal(sync.arguments.contextRevision, 2);
  assert.equal(sync.arguments.contextUpdateId, 'accepted-2');
});

test('late synchronization response cannot replace a newer manual position', async () => {
  const h = harness({ delayedSync: true }); await settle();
  h.nodes.get('next').click(); await settle();
  h.syncWait.resolve({ structuredContent: { state: initial, changed: true } }); await settle();
  assert.match(h.nodes.get('status').textContent, /Revision 2/);
  assert.equal(h.contextCalls.at(-1).structuredContent.revision, 2);
});

test('a different session response is rejected without publishing its context', async () => {
  const h = harness({ delayedSync: true }); await settle();
  h.syncWait.resolve({ structuredContent: { state: { ...initial, sessionId: 'review-two', revision: 2 }, changed: true } }); await settle();
  assert.match(h.nodes.get('error').textContent, /different review session/);
  assert.equal(h.contextCalls.length, 1);
  assert.equal(h.contextCalls[0].structuredContent.sessionId, 'review-one');
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
  assert.match(h.nodes.get('status').textContent, /Revision 2 · context accepted/);
  assert.equal(h.nodes.get('error').hidden, true);
  await h.timerCallbacks.at(-1)(); await settle();
  const ack = h.toolCalls.at(-1).arguments;
  assert.equal(ack.contextRevision, 2);
  assert.equal(ack.contextUpdateId, 'accepted-2');
});
