import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../src/store.mjs';
import { Engine, ENGINE_PROFILE } from '../src/engine.mjs';
import { SCORING_VERSION } from '../src/scoring.mjs';
import { Learning } from '../src/learning.mjs';

const engine = new Engine();
const profile = { version: SCORING_VERSION, engineId: ENGINE_PROFILE.id };
const exact = (cp = 0, extras = {}) => ({ ready: true, exact: true, canonicalEligible: true, cp, profileId: ENGINE_PROFILE.id, profile: 'refinement', ...extras });
const game = (id = 'game', extras = {}) => ({ id, pgn: '1. e4 e5 *', importedFor: 'player', playerColor: 'white', white: { username: 'player' }, black: { username: 'opponent' }, sourceLabel: 'Chess.com public archive', timeClass: 'rapid', timeControl: '600', endTime: 100, ...extras });
function analysis(before = exact(20, { bestMove: 'e2e4', pv: ['e2e4', 'e7e5'] }), extras = {}) {
  return { analysisKey: 'game-scoring-v1', completedAt: 1, readiness: 'ready', profile, accuracy: { w: 85, b: 90 }, moves: [{ ply: 1, color: 'w', san: 'e4', uci: 'e2e4', before, after: exact(-100), classification: { ready: true, label: 'Mistake', loss: 12 } }], ...extras };
}
function setup(t, analysisRecord = analysis(), candidateEngine = engine) {
  const dataDir = mkdtempSync(join(tmpdir(), 'chess-learning-'));
  const store = new Store({ dataDir });
  store.set('games', 'game', game()); store.set('analyses', 'game', analysisRecord);
  store.set('sessions', 'session', { sessionId: 'session', gameId: 'game', selectedPly: 1, variation: [], revision: 1 });
  const learning = new Learning(store, candidateEngine);
  t.after(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { store, learning, dataDir };
}
const args = started => ({ sessionId: 'session', expectedRevision: started.sessionRevision, retryId: started.retry.retryId, attemptRevision: started.retry.attemptRevision });
test('actual pinned engine accepts a similarly sound alternative and leaves original canonical score unchanged', async t => {
  const before = await engine.analyze({ profile: 'refinement' });
  const { store, learning } = setup(t, analysis(before));
  const original = JSON.stringify(store.get('analyses', 'game'));
  const started = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 1 });
  assert.equal(started.retry.checkedAnswer, undefined); assert.equal(started.retry.originalClassification, undefined);
  assert.equal(store.get('sessions', 'session').selectedPly, 0);
  const attempted = await learning.attempt({ ...args(started), move: before.bestMove === 'd2d4' ? 'e4' : 'd4' });
  assert.equal(attempted.retry.firstAttempt.accepted, true);
  assert.equal(attempted.retry.firstAttempt.assisted, false);
  assert.equal(attempted.retry.firstAttempt.evidence.profile, 'refinement');
  assert.equal(attempted.retry.checkedAnswer.move, before.bestMove);
  assert.equal(JSON.stringify(store.get('analyses', 'game')), original);
});
test('illegal, stale, and foreign-session attempts cannot commit records', async t => {
  const { store, learning } = setup(t);
  const started = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 1 });
  await assert.rejects(learning.attempt({ ...args(started), move: 'Ke3' }), /Invalid move/);
  assert.equal(store.get('retries', started.retry.retryId).attempts.length, 0);
  await assert.rejects(learning.attempt({ ...args(started), expectedRevision: 1, move: 'e4' }), /Stale session/);
  store.set('sessions', 'other', { sessionId: 'other', gameId: 'game', revision: 2 });
  assert.throws(() => learning.get({ sessionId: 'other', retryId: started.retry.retryId }), /does not belong/);
  assert.throws(() => learning.hint({ ...args(started), attemptRevision: 0 }), /Stale retry/);
});
test('first hint is a checked cue; second hint reveals and records assistance', async t => {
  const { learning } = setup(t, analysis(), { analyze: async () => exact(25) });
  const start = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 1 });
  const hint = learning.hint(args(start));
  assert.match(hint.retry.hint, /pawn on e2/); assert.equal(hint.retry.checkedAnswer, undefined);
  const reveal = learning.hint(args(hint));
  assert.equal(reveal.retry.checkedAnswer.move, 'e2e4'); assert.equal(reveal.retry.hintsUsed, 2);
  const attempted = await learning.attempt({ ...args(reveal), move: 'e4' });
  assert.equal(attempted.retry.firstAttempt.assisted, true); assert.equal(attempted.retry.firstAttempt.hintsUsed, 2);
});
test('a concurrent position change or reanalysis discards delayed engine result', async t => {
  let resolve;
  const slow = { analyze: () => new Promise(done => { resolve = done; }) };
  const { store, learning } = setup(t, analysis(), slow);
  const start = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 1 });
  const pending = learning.attempt({ ...args(start), move: 'e4' });
  store.update('sessions', 'session', state => ({ ...state, selectedPly: 2, revision: state.revision + 1 }));
  resolve(exact(30)); await assert.rejects(pending, /Stale session/);
  assert.equal(store.get('retries', start.retry.retryId).attempts.length, 1);
  assert.equal(store.get('retries', start.retry.retryId).attempts[0].status, 'interrupted');
  const resumed = { ...args(start), expectedRevision: 4, attemptRevision: store.get('retries', start.retry.retryId).attemptRevision };
  store.set('analyses', 'game', analysis(undefined, { completedAt: 2 }));
  await assert.rejects(learning.attempt({ ...resumed, move: 'e4' }), /analysis changed/);
});
test('verified mate is preserved, saturation cannot accept losing it, and zero cp cannot certify a draw', async t => {
  const before = exact(undefined, { mate: 1, bestMove: 'h5f7', pv: ['h5f7'] });
  const { store, learning } = setup(t, analysis(before, { moves: [{ ply: 7, color: 'w', before, after: exact(-100), classification: { ready: true, loss: 50 } }] }), { analyze: async () => exact(1000) });
  store.set('games', 'game', game('game', { pgn: '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qe2 *' }));
  const start = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 7 });
  assert.equal(start.retry.requiredOutcome, 'mate');
  const failed = await learning.attempt({ ...args(start), move: 'Qe2' });
  assert.equal(failed.retry.firstAttempt.accepted, false); assert.equal(failed.retry.firstAttempt.preservesOutcome, false);
  store.set('analyses', 'game', analysis());
  assert.throws(() => learning.start({ sessionId: 'session', expectedRevision: failed.sessionRevision, ply: 1, requiredOutcome: 'draw' }), /zero evaluation/);
});
test('actual engine accepts immediate checked mate with explicit terminal winner', async t => {
  const history = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6'];
  const before = await engine.analyze({ moves: history, profile: 'refinement' });
  const { store, learning } = setup(t, analysis(before, { moves: [{ ply: 7, color: 'w', before, after: exact(-100), classification: { ready: true, loss: 50 } }] }));
  store.set('games', 'game', game('game', { pgn: '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qe2 *' }));
  const start = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 7 });
  const result = await learning.attempt({ ...args(start), move: 'Qxf7#' });
  assert.equal(result.retry.firstAttempt.accepted, true); assert.equal(result.retry.firstAttempt.evidence.winner, 'w');
});
test('retry history survives another SQLite connection; first and later attempts remain separate', async t => {
  const { store, dataDir, learning } = setup(t, analysis(), { analyze: async () => exact(25) });
  const start = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 1, answerPreviouslyShown: true });
  const first = await learning.attempt({ ...args(start), move: 'e4' });
  const secondStore = new Store({ dataDir }); t.after(() => secondStore.close());
  const secondLearning = new Learning(secondStore, { analyze: async () => exact(25) });
  const second = await secondLearning.attempt({ ...args(first), move: 'd4' });
  assert.equal(second.retry.attempts.length, 2); assert.equal(second.retry.firstAttempt.uci, 'e2e4');
  assert.equal(second.retry.firstAttempt.assisted, true); assert.equal(second.retry.attempts[1].assisted, true);
  assert.equal(store.get('retries', start.retry.retryId).attempts.length, 2);
});
test('saved mistakes and progress use only owned canonical games and separate incomparable controls', t => {
  const { store, learning } = setup(t);
  store.set('settings', 'username', 'player');
  for (const [id, timeClass, timeControl] of [['fast', 'blitz', '180'], ['slow', 'rapid', '900']]) {
    store.set('games', id, game(id, { timeClass, timeControl })); store.set('analyses', id, analysis());
  }
  for (const [id, extras] of [['fixture', { fixture: true }], ['public', { sourceLabel: 'Public verification: player (not Brian)' }], ['other', { importedFor: 'other' }]]) {
    store.set('games', id, game(id, extras)); store.set('analyses', id, analysis());
  }
  store.set('games', 'outdated', game('outdated')); store.set('analyses', 'outdated', analysis(undefined, { profile: { ...profile, version: 'older-score' } }));
  const progress = learning.progress();
  assert.equal(progress.groups.length, 3); assert.ok(progress.groups.every(group => group.sampleCount === 1 && group.evidenceStatus === 'insufficient_history'));
  assert.equal(progress.improvementClaim, null); assert.equal(learning.savedMistakes().length, 3);
  assert.ok(progress.groups.every(group => group.mistakeCount === 1 && group.moveOpportunities === 1));
  store.delete('settings', 'username'); assert.deepEqual(learning.progress().groups, []); assert.deepEqual(learning.savedMistakes(), []);
});
test('material motifs name only checkable finite concessions and do not invent strategy', t => {
  const { store, learning } = setup(t);
  store.set('settings', 'username', 'player');
  const before = exact(0), after = exact(-900, { pv: ['d8d2', 'e1f1'] });
  store.set('games', 'game', game('game', { pgn: '[SetUp "1"]\n[FEN "3qk3/8/8/8/8/8/3Q4/4K3 w - - 0 1"]\n\n1. Kf1 *' }));
  store.set('analyses', 'game', analysis(before, { moves: [{ ply: 1, color: 'w', before, after: { ...after, pv: ['d8d2', 'f1g1'] }, classification: { ready: true, loss: 30, label: 'Blunder' } }] }));
  const saved = learning.savedMistakes()[0];
  assert.equal(saved.motifs[0].kind, 'material_concession'); assert.equal(saved.motifs[0].materialPoints, 9);
  assert.deepEqual(saved.motifs[0].line, ['d8d2', 'f1g1']);
});
test('mutations require explicit session revisions and draw retries require verified outcomes', async t => {
  const before = exact(0, { bestMove: 'e2e4', pv: ['e2e4'], verifiedOutcome: 'draw' });
  let attempt = exact(0);
  const { learning } = setup(t, analysis(before), { analyze: async () => attempt });
  assert.throws(() => learning.start({ sessionId: 'session', ply: 1 }), /explicit positive session revision/);
  const started = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 1, requiredOutcome: 'draw' });
  const failed = await learning.attempt({ ...args(started), move: 'e4' });
  assert.equal(failed.retry.firstAttempt.accepted, false); assert.equal(failed.retry.firstAttempt.preservesOutcome, false);
  attempt = exact(0, { terminal: 'repetition' });
  const verified = await learning.attempt({ ...args(failed), move: 'd4' });
  assert.equal(verified.retry.attempts[1].accepted, true);
});
test('engine failure preserves the first submitted move with unknown acceptance', async t => {
  const { learning, store } = setup(t, analysis(), { analyze: async () => { throw Error('Analysis interrupted'); } });
  const started = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 1 });
  const interrupted = await learning.attempt({ ...args(started), move: 'e4' });
  assert.equal(interrupted.retry.firstAttempt.status, 'interrupted'); assert.equal(interrupted.retry.firstAttempt.accepted, null);
  assert.equal(interrupted.retry.firstAttempt.ready, false); assert.equal(interrupted.retry.firstAttempt.uci, 'e2e4');
  assert.equal(interrupted.retry.firstAttempt.assisted, false); assert.equal(store.get('analyses', 'game').accuracy.w, 85);
});
test('a crashed process leaves a durable first attempt that is recovered as interrupted after restart', async t => {
  const { store, dataDir } = setup(t);
  const source = `import {Store} from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)}; import {Learning} from ${JSON.stringify(new URL('../src/learning.mjs', import.meta.url).href)}; const s=new Store({dataDir:process.env.TEST_LEARNING_DIR}); const l=new Learning(s,{analyze:()=>new Promise(()=>{})}); const r=l.start({sessionId:'session',expectedRevision:1,ply:1}); void l.attempt({sessionId:'session',expectedRevision:r.sessionRevision,retryId:r.retry.retryId,attemptRevision:r.retry.attemptRevision,move:'e4'});`;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TEST_LEARNING_DIR: dataDir }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(stderr)));
  });
  const pending = store.list('retries')[0]; assert.equal(pending.attempts[0].status, 'pending');
  const reopened = new Store({ dataDir }); t.after(() => reopened.close());
  const restored = new Learning(reopened, engine);
  const recovered = restored.get({ sessionId: 'session', retryId: pending.retryId });
  assert.equal(recovered.firstAttempt.status, 'interrupted'); assert.equal(recovered.firstAttempt.accepted, null);
  assert.equal(recovered.firstAttempt.uci, 'e2e4'); assert.equal(recovered.firstAttempt.assisted, false);
  assert.equal(reopened.get('sessions', 'session').revision, 4);
});
test('retry passes complete played history to the real engine for a repetition draw', async t => {
  const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'];
  const before = await engine.analyze({ moves, profile: 'refinement' });
  const { store, learning } = setup(t, analysis(before, { moves: [{ ply: 8, color: 'b', before, after: exact(0), classification: { ready: true, loss: 10 } }] }));
  store.set('games', 'game', game('game', { playerColor: 'black', white: { username: 'opponent' }, black: { username: 'player' }, pgn: '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2' }));
  const started = learning.start({ sessionId: 'session', expectedRevision: 1, ply: 8 });
  const result = await learning.attempt({ ...args(started), move: 'Ng8' });
  assert.equal(result.retry.firstAttempt.evidence.terminal, 'repetition');
  assert.equal(result.retry.firstAttempt.evidence.moves.length, 8);
  assert.equal(result.retry.firstAttempt.status, 'complete');
  assert.equal(result.retry.firstAttempt.ready, true);
});
