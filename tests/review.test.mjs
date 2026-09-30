import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Reviews, replay, ensureFixture, FIXTURE_ID } from '../src/review.mjs';

function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'chess-review-'));
  const store = new Store({ dataDir }); ensureFixture(store);
  t.after(() => { try { store.close(); } catch {} rmSync(dataDir, { recursive: true, force: true }); });
  return { dataDir, store, reviews: new Reviews(store) };
}
const storedGame = (id, pgn) => ({ id, pgn, playerColor: 'white', sourceLabel: 'Legal replay fixture', white: { username: 'White' }, black: { username: 'Black' }, timeClass: 'fixture' });
test('replay performs castling, en passant, promotion, mate, and repetition legally', () => {
  const castle = replay(storedGame('castle', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *'), 7).chess;
  assert.deepEqual(castle.get('g1'), { type: 'k', color: 'w' });
  assert.deepEqual(castle.get('f1'), { type: 'r', color: 'w' }); assert.equal(castle.get('h1'), undefined);
  const ep = replay(storedGame('ep', '1. e4 a6 2. e5 d5 3. exd6 *'), 5).chess;
  assert.deepEqual(ep.get('d6'), { type: 'p', color: 'w' }); assert.equal(ep.get('d5'), undefined);
  const promotion = replay(storedGame('promotion', '[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/7K/8 w - - 0 1"]\n\n1. a8=Q *'), 1).chess;
  assert.deepEqual(promotion.get('a8'), { type: 'q', color: 'w' });
  const mate = replay(storedGame('mate', '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0'), 7).chess;
  assert.equal(mate.isCheckmate(), true);
  const repetition = replay(storedGame('repeat', '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2'), 8).chess;
  assert.equal(repetition.isThreefoldRepetition(), true);
});
test('rejects invalid ply and illegal variation without changing durable revision', t => {
  const { store, reviews } = setup(t), state = reviews.open();
  const guard = { sessionId: state.sessionId, expectedRevision: 1 };
  assert.throws(() => reviews.go({ ...guard, ply: 100 }), /Invalid ply/);
  assert.throws(() => reviews.variation({ ...guard, moves: ['e4', 'e5', 'Ke3'] }));
  assert.equal(reviews.context(state.sessionId).revision, 1);
  assert.deepEqual(reviews.context(state.sessionId).variation, []);
  assert.equal(store.getGame(FIXTURE_ID).pgn.includes('Qxf7#'), true);
});
test('semantic navigation accepts UCI/SAN and preserves the played line', t => {
  const { store, reviews } = setup(t), state = reviews.open();
  let next = reviews.variation({ sessionId: state.sessionId, expectedRevision: 1, moves: ['e2e4', 'e7e5', 'Nf3'] });
  assert.deepEqual(next.variation, ['e4', 'e5', 'Nf3']); assert.equal(next.selectedPly, 0); assert.equal(next.sideToMove, 'black');
  next = reviews.return({ sessionId: state.sessionId, expectedRevision: next.revision });
  assert.deepEqual(next.variation, []); assert.equal(next.selectedPly, 0);
  next = reviews.go({ sessionId: state.sessionId, expectedRevision: next.revision, ply: 7 });
  assert.equal(next.totalPlies, 7); assert.equal(next.legalMoves.length, 0); assert.equal(next.sideToMove, 'black');
  assert.equal(store.getGame(FIXTURE_ID).pgn.includes('Qxf7#'), true);
});
test('two SQLite connections reject stale writes and keep separate review sessions', t => {
  const { store, dataDir, reviews } = setup(t);
  const secondStore = new Store({ dataDir }); t.after(() => secondStore.close());
  const other = new Reviews(secondStore), first = reviews.open(), second = other.open();
  const updated = other.go({ sessionId: first.sessionId, expectedRevision: first.revision, ply: 2 });
  assert.equal(reviews.context(first.sessionId).fen, updated.fen);
  assert.throws(() => reviews.go({ sessionId: first.sessionId, expectedRevision: first.revision, ply: 4 }), /Stale revision/);
  assert.equal(reviews.context(first.sessionId).selectedPly, 2);
  assert.equal(reviews.context(second.sessionId).selectedPly, 0);
  assert.equal(store.list('sessions').length, 2);
});
test('mount acknowledgement separates backend, display, and host context; late acknowledgements remain stale', t => {
  const { reviews } = setup(t), first = reviews.open();
  let sync = reviews.sync({ sessionId: first.sessionId, mountId: 'mount-a', knownRevision: 0 });
  assert.equal(sync.changed, true); assert.equal(sync.displayAcknowledgement, false); assert.equal(sync.hostContextAcknowledgement, false);
  sync = reviews.sync({ sessionId: first.sessionId, mountId: 'mount-a', knownRevision: 1, displayedRevision: 1 });
  assert.equal(sync.displayAcknowledgement, true); assert.equal(sync.hostContextAcknowledgement, false);
  sync = reviews.sync({ sessionId: first.sessionId, mountId: 'mount-a', knownRevision: 1, contextRevision: 1, contextUpdateId: 'accepted-context-a' });
  assert.equal(sync.hostContextAcknowledgement, true); assert.equal(sync.modelConsumptionVerified, false);
  reviews.go({ sessionId: first.sessionId, expectedRevision: 1, ply: 2 });
  sync = reviews.sync({ sessionId: first.sessionId, mountId: 'mount-a', knownRevision: 1, displayedRevision: 1, contextRevision: 1, contextUpdateId: 'late-context' });
  assert.equal(sync.state.revision, 2); assert.equal(sync.displayAcknowledgement, false); assert.equal(sync.hostContextAcknowledgement, false);
});
test('remount and second instance never inherit another mount acknowledgement', t => {
  const { reviews } = setup(t), first = reviews.open(), second = reviews.open();
  reviews.sync({ sessionId: first.sessionId, mountId: 'mount-a', knownRevision: 1, displayedRevision: 1, contextRevision: 1, contextUpdateId: 'accepted' });
  const remount = reviews.sync({ sessionId: first.sessionId, mountId: 'mount-b', knownRevision: 0 });
  assert.equal(remount.displayAcknowledgement, false); assert.equal(remount.hostContextAcknowledgement, false); assert.equal(remount.changed, true);
  const isolated = reviews.sync({ sessionId: second.sessionId, mountId: 'mount-a', knownRevision: 0 });
  assert.equal(isolated.displayAcknowledgement, false); assert.equal(isolated.hostContextAcknowledgement, false);
});
test('committed selected ply and variation survive restart; closed or absent sessions fail', t => {
  const { dataDir, store, reviews } = setup(t), first = reviews.open();
  const selected = reviews.go({ sessionId: first.sessionId, expectedRevision: 1, ply: 2 });
  const variation = reviews.variation({ sessionId: first.sessionId, expectedRevision: selected.revision, moves: ['Nf3', 'Nc6'] });
  store.close();
  const reopened = new Store({ dataDir }); t.after(() => reopened.close());
  const afterRestart = new Reviews(reopened);
  assert.equal(afterRestart.open({ sessionId: first.sessionId }).fen, variation.fen);
  assert.equal(afterRestart.context(first.sessionId).revision, 3);
  reopened.update('sessions', first.sessionId, state => ({ ...state, closed: true }));
  assert.throws(() => afterRestart.context(first.sessionId), /expired or disconnected/);
  assert.throws(() => afterRestart.context('no-session'), /expired or disconnected/);
});
