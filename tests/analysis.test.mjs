import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { Reviews } from '../src/review.mjs';
import { Analysis } from '../src/analysis.mjs';
import { Engine, ENGINE_PROFILE, replayPosition } from '../src/engine.mjs';
import { gameAccuracy } from '../src/scoring.mjs';
const PGN = '[Result "1/2-1/2"]\n\n1. e4 e5 1/2-1/2';
const pgnHash = createHash('sha256').update(PGN).digest('hex');
function setup(t, pgn = PGN, now) {
  const dir = mkdtempSync(join(tmpdir(), 'chess-analysis-test-'));
  const store = new Store({ dataDir: dir, ...(now ? { now } : {}) });
  store.set('games', 'game', { id: 'game', pgn, playerColor: 'white', sourceLabel: 'Analysis test fixture' });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, dir };
}
class ControlledEngine {
  constructor({ failAt = Infinity, hold } = {}) { this.calls = []; this.failAt = failAt; this.hold = hold; }
  async analyze({ initialFen, moves, profile, searchMoves = [] }) {
    this.calls.push({ initialFen, moves, profile, searchMoves });
    if (this.calls.length === 1 && this.hold) await this.hold;
    if (this.calls.length === this.failAt) throw new Error('Engine interrupted for regression fixture');
    const chess = replayPosition(initialFen, moves), legal = chess.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
    const bestMove = searchMoves[0] || legal[0] || null;
    return { initialFen, moves, profile, profileId: ENGINE_PROFILE.id, canonicalEligible: true,
      ready: true, exact: true, cp: 0, bestMove, pv: bestMove ? [bestMove] : [], depth: 12,
      nodes: profile === 'ordinary' ? ENGINE_PROFILE.ordinaryNodes : ENGINE_PROFILE.refinementNodes };
  }
}
test('start persists pending synchronously; actual short completed game has one canonical refinement result and restart reuse', async t => {
  const pgn = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
  const { store } = setup(t, pgn); store.update('games','game',g => ({ ...g, playerColor:'black' }));
  const engine = new Engine(), analysis = new Analysis({ store, engine });
  const first = analysis.start('game');
  assert.equal(first.readiness, 'pending'); assert.equal(first.accuracy, null);
  const result = await analysis.run('game');
  assert.equal(result.readiness, 'ready', result.error); assert.equal(result.positions.length, 5);
  assert.ok(result.positions.every(p => p.profile === 'refinement' && p.ready && p.exact));
  assert.ok(result.ordinaryPositions.every(p => p.profile === 'ordinary'));
  assert.deepEqual(result.accuracy, gameAccuracy(result.positions.slice(1)));
  assert.equal(result.playerAccuracy, result.accuracy.b); assert.equal(result.moves[3].classification.label, 'Best');
  const immutable = JSON.stringify(store.get('analyses','game'));
  const noCalls = { analyze() { throw new Error('Completed same-profile work must not rerun'); } };
  assert.equal((await new Analysis({ store, engine: noCalls }).run('game')).readiness, 'ready');
  assert.equal(JSON.stringify(store.get('analyses','game')), immutable);
});
test('interruption retains exact cached work, fabricates no score, and recovery reuses that work', async t => {
  const { store } = setup(t);
  const failedEngine = new ControlledEngine({ failAt: 3 });
  const first = await new Analysis({ store, engine: failedEngine }).run('game');
  assert.equal(first.readiness, 'failed'); assert.equal(first.completedPositions, 1);
  assert.equal(first.accuracy, undefined); assert.equal(first.moves, undefined); assert.equal(first.recoverable, true);
  const resumedEngine = new ControlledEngine();
  const ready = await new Analysis({ store, engine: resumedEngine }).run('game');
  assert.equal(ready.readiness, 'ready');
  const cached=store.get('analysis-work',ready.analysisKey).cache;
  // Failure left exact work from the other concurrent worker. Its previously
  // completed request must not be searched again on resume.
  assert.ok(Object.values(cached).some(e=>e.moves.length===1&&e.profile==='ordinary'));
  assert.equal(resumedEngine.calls.some(call=>call.moves.length===1&&call.profile==='ordinary'&&!call.searchMoves.length),false);
});
test('independent Store/Analysis instances serialize one game and do not duplicate engine work', async t => {
  const { store, dir } = setup(t); const secondStore = new Store({ dataDir: dir }); t.after(() => secondStore.close());
  let release; const hold = new Promise(resolve => { release = resolve; });
  const firstEngine = new ControlledEngine({ hold }), secondEngine = new ControlledEngine();
  const first = new Analysis({ store, engine: firstEngine, pollMs: 5, waitMs: 2000 });
  const second = new Analysis({ store: secondStore, engine: secondEngine, pollMs: 5, waitMs: 2000 });
  const a = first.run('game');
  await new Promise(resolve => setTimeout(resolve, 20));
  const b = second.run('game');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(secondEngine.calls.length, 0); release();
  const [one,two] = await Promise.all([a,b]);
  assert.equal(one.readiness,'ready'); assert.equal(two.readiness,'ready'); assert.equal(secondEngine.calls.length,0);
  assert.equal(one.completedAt,two.completedAt);
});
test('expired lease and durable partial job recover; bounded busy wait reports a retryable error', async t => {
  let clock = 1000; const { store } = setup(t, PGN, () => clock);
  const a = new Analysis({ store, engine: new ControlledEngine(), leaseMs: 50, pollMs: 5, waitMs: 15 });
  store.acquireLease(a.leaseKey,50);
  const waiting = await a.run('game'); assert.equal(waiting.readiness,'failed'); assert.equal(waiting.recoverable,true); assert.match(waiting.error,/busy/);
  clock += 51;
  assert.equal((await a.run('game')).readiness,'ready');
});
test('dead queued process becomes interrupted on restart, retains cache, and requires explicit Resume', async t => {
  const { store } = setup(t);
  const first = new Analysis({ store, engine: new ControlledEngine() });
  const input = first.status('game');
  const child = spawnSync(process.execPath,['-e','process.exit(0)']);
  store.set('analyses','game',{...input,pgnHash,readiness:'pending',ownerPid:child.pid,ownerId:'dead-owner',leaseToken:null});
  store.set('analysis-work',input.analysisKey,{retained:true,cache:{},pgnHash});
  const engine = new ControlledEngine();
  const restarted = new Analysis({store,engine});
  await new Promise(resolve => setTimeout(resolve,15));
  assert.equal(engine.calls.length,0); assert.equal(restarted.status('game').readiness,'interrupted');
  assert.equal(store.get('analysis-work',input.analysisKey).retained,true);
  assert.equal((await restarted.run('game')).readiness,'ready');
});
test('status recovers expired owner with revision bump, while preserving a different live lease', async t => {
  let clock=1000; const {store}=setup(t,PGN,()=>clock), reviews=new Reviews(store);
  const session=reviews.open({gameId:'game'}), analysis=new Analysis({store,engine:new ControlledEngine(),leaseMs:50});
  const input=analysis.status('game'), old=store.acquireLease(analysis.leaseKey,50);
  store.set('analyses','game',{...input,pgnHash,readiness:'analyzing',ownerPid:process.pid,ownerId:'live-owner',leaseToken:old,completedPositions:1});
  assert.equal(analysis.status('game').readiness,'analyzing');
  assert.equal(store.get('analyses','game').readiness,'analyzing');
  assert.equal(reviews.context(session.sessionId).revision,session.revision);
  clock+=51;
  assert.equal(analysis.status('game').readiness,'interrupted');
  assert.equal(reviews.context(session.sessionId).revision,session.revision+1);
  assert.equal(analysis.status('game').completedPositions,1); assert.equal(analysis.status('game').accuracy,null);
  const live=store.acquireLease(analysis.leaseKey,50);
  store.update('analyses','game',r=>({...r,readiness:'analyzing',ownerPid:process.pid,ownerId:'old-worker',leaseToken:old}));
  assert.equal(analysis.status('game').readiness,'interrupted');
  assert.equal(store.renewLease(analysis.leaseKey,live,50),true);
});
test('cancelled queued request persists interruption without scores', async t => {
  const {store} = setup(t), engine = new ControlledEngine(), analysis = new Analysis({store,engine});
  const controller = new AbortController(); controller.abort();
  const result = await analysis.run('game',{signal:controller.signal});
  assert.equal(result.readiness,'interrupted'); assert.equal(result.accuracy,undefined); assert.equal(engine.calls.length,0);
});
test('progress/final commits preserve current navigation and variation while invalidating old mounted acknowledgements', async t => {
  const { store } = setup(t), reviews = new Reviews(store);
  const one = reviews.open({ gameId:'game' }), two = reviews.open({ gameId:'game' });
  const selected = reviews.go({ sessionId:one.sessionId,expectedRevision:one.revision,ply:1 });
  const variation = reviews.variation({ sessionId:selected.sessionId,expectedRevision:selected.revision,moves:['Nc6'] });
  reviews.sync({ sessionId:one.sessionId,mountId:'mount',knownRevision:variation.revision,displayedRevision:variation.revision,contextRevision:variation.revision,contextUpdateId:'old-ack' });
  const otherGame = { id:'other',pgn:PGN,playerColor:'white' }; store.set('games','other',otherGame);
  const other = reviews.open({ gameId:'other' });
  assert.equal((await new Analysis({ store,engine:new ControlledEngine() }).run('game')).readiness,'ready');
  const current = reviews.context(one.sessionId), second = reviews.context(two.sessionId);
  assert.equal(current.selectedPly,1); assert.deepEqual(current.variation,['Nc6']); assert.ok(current.revision > variation.revision);
  assert.ok(second.revision > two.revision); assert.equal(reviews.context(other.sessionId).revision,other.revision);
  assert.equal(current.view.displayed,false); assert.equal(current.view.hostContextAccepted,false);
  assert.throws(() => reviews.go({sessionId:one.sessionId,expectedRevision:variation.revision,ply:0}),/Stale revision/);
});
test('custom FEN game uses its actual initial canonical assessment in Lichess aggregation', async t => {
  const initial = '6k1/5p2/8/8/8/8/5q2/5R1K w - - 0 1';
  const pgn = `[SetUp "1"]\n[FEN "${initial}"]\n[Result "1-0"]\n\n1. Rxf2 1-0`;
  const { store } = setup(t,pgn);
  const result = await new Analysis({store,engine:new ControlledEngine()}).run('game');
  assert.equal(result.readiness,'ready');
  assert.deepEqual(result.accuracy,gameAccuracy(result.positions.slice(1),{initial:result.positions[0]}));
  assert.equal(result.accuracy.w,100);
});
test('position workers run concurrently but remain bounded at two and retain phase progress',async t=>{
  const {store}=setup(t);
  class DelayedEngine extends ControlledEngine {
    active=0;maximum=0;
    async analyze(request){this.active++;this.maximum=Math.max(this.maximum,this.active);try{
      await new Promise(resolve=>setTimeout(resolve,10));return await super.analyze(request);
    }finally{this.active--;}}
  }
  const engine=new DelayedEngine(),analysis=new Analysis({store,engine});
  const phases=[];const original=analysis.publish.bind(analysis);
  analysis.publish=(input,record,guard)=>{phases.push({phase:record.phase,move:record.currentMove});return original(input,record,guard);};
  const result=await analysis.run('game');
  assert.equal(result.readiness,'ready');assert.equal(engine.maximum,2);assert.equal(engine.active,0);
  assert.ok(phases.some(p=>p.phase==='positions'));assert.deepEqual(phases.filter(p=>p.phase==='moves').map(p=>p.move),[1,2]);
  assert.equal(analysis.status('game').phase,'complete');assert.equal(analysis.status('game').totalMoves,2);
});
test('parallel search failure settles its peer before terminal publication and leaves no late cache writes',async t=>{
  const {store}=setup(t);
  class RaceEngine extends ControlledEngine {
    active=0;maximum=0;
    async analyze(request){this.active++;this.maximum=Math.max(this.maximum,this.active);try{
      if(request.moves.length===0){await new Promise(resolve=>setTimeout(resolve,5));throw new Error('Position search failed');}
      await new Promise(resolve=>setTimeout(resolve,40));return await super.analyze(request);
    }finally{this.active--;}}
  }
  const engine=new RaceEngine(),analysis=new Analysis({store,engine});
  const failed=await analysis.run('game');
  assert.equal(failed.readiness,'failed');assert.match(failed.error,/Position search failed/);assert.equal(engine.maximum,2);assert.equal(engine.active,0);
  assert.equal(failed.accuracy,undefined);
  const snapshot=JSON.stringify(store.get('analysis-work',failed.analysisKey));
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(JSON.stringify(store.get('analysis-work',failed.analysisKey)),snapshot);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM leases').get().n,0);
});
