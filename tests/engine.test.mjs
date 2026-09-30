import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, replayPosition, ENGINE_PROFILE, selectCompletedEvidence } from '../src/engine.mjs';
const engine = new Engine();
test('completed exact full-root iteration retains its own best move when unfinished iteration changes root', () => {
  const lastExact = { exact: true, cp: 30, depth: 15, nodes: 90_000, pv: ['e2e4','e7e5'] };
  const last = { exact: false, bound: 'lowerbound', cp: 50, depth: 16, nodes: 100_010, pv: ['e2e4'] };
  const selected = selectCompletedEvidence({ last, lastExact, bestMove: 'e2e4' });
  assert.equal(selected.ready, true); assert.equal(selected.cp, 30); assert.equal(selected.depth, 15); assert.equal(selected.nodes, 90_000);
  assert.equal(selected.searchedNodes, 100_010); assert.equal(selected.finalPartialIteration.bound, 'lowerbound');
  const switched=selectCompletedEvidence({last,lastExact,bestMove:'d2d4'});
  assert.equal(switched.ready,true);assert.equal(switched.bestMove,'e2e4');assert.equal(switched.finalBestMove,'d2d4');
  assert.equal(selectCompletedEvidence({ last, lastExact: null, bestMove: 'e2e4' }).ready, false);
});
test('anonymous legal position recovers a completed full-root assessment at the same frozen400k budget', async()=>{
  const initialFen='r1bq1rk1/ppp1ppbp/2n2np1/3p4/5P2/1P1PPN1P/PBP3P1/RN1QKB1R b KQ - 0 7';
  const r=await engine.analyze({initialFen,profile:'refinement'});
  assert.equal(r.ready,true);assert.equal(r.exact,true);assert.equal(r.budget,400_000);
  assert.equal(r.bestMove,r.pv[0]);assert.notEqual(r.bestMove,r.finalBestMove);
  assert.equal(r.finalPartialIteration.exact,false);assert.equal(r.finalPartialIteration.bound,'upperbound');
  assert.ok(r.depth<r.finalPartialIteration.depth);assert.ok(r.nodes<r.searchedNodes);
});
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
