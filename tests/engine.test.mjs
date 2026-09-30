import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, replayPosition, ENGINE_PROFILE } from '../src/engine.mjs';
const engine = new Engine();
test('pinned actual Stockfish produces repeatable legal white-oriented evidence', async () => {
  const a = await engine.analyze({ moves: ['e2e4','e7e5','d1h5','b8c6','f1c4','g8f6'] });
  const b = await engine.analyze({ moves: ['e2e4','e7e5','d1h5','b8c6','f1c4','g8f6'] });
  assert.equal(a.bestMove, 'h5f7'); assert.equal(a.mate, 1); assert.equal(a.exact, true); assert.equal(a.ready, true);
  assert.deepEqual(a.pv, b.pv); assert.equal(a.nodes, b.nodes); assert.equal(a.profileId, ENGINE_PROFILE.id);
  const black = await engine.analyze({ initialFen: '6k1/8/8/8/8/8/5q2/7K b - - 0 1' });
  assert.ok(black.mate < 0, 'Black winning must be a negative white mate score');
});
test('played history preserves repetition; terminal mate and draw use explicit outcomes', async () => {
  const moves = ['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8'];
  const repeated = await engine.analyze({ moves });
  assert.equal(repeated.terminal, 'repetition'); assert.equal(repeated.cp, 0);
  const mate = await engine.analyze({ moves: ['f2f3','e7e5','g2g4','d8h4'] });
  assert.equal(mate.terminal, 'checkmate'); assert.equal(mate.winner, 'b'); assert.equal(mate.mate, 0);
  const draw = await engine.analyze({ initialFen: '8/8/8/8/8/4k3/8/4K3 w - - 0 1' });
  assert.equal(draw.terminal, 'draw'); assert.equal(draw.cp, 0);
});
test('root filtering checks legal moves; abort never yields finalized evidence', async () => {
  await assert.rejects(engine.analyze({ searchMoves: ['e2e5'] }), /Illegal root/);
  const filtered = await engine.analyze({ searchMoves: ['d2d4'] });
  assert.equal(filtered.bestMove, 'd2d4');
  const exploration = await engine.analyze({ nodes: 20_000 });
  assert.equal(exploration.canonicalEligible, false); assert.match(exploration.profileId, /exploratory-n20000$/);
  const c = new AbortController();
  const pending = engine.analyze({ nodes: 1_000_000_000, signal: c.signal });
  setTimeout(() => c.abort(), 30);
  await assert.rejects(pending, /interrupted/);
  assert.throws(() => replayPosition(undefined, ['e2e5']), /Invalid move/);
});
