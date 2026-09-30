import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { Reviews, replay, ensureFixture, FIXTURE_ID } from '../src/review.mjs';
import { ENGINE_PROFILE } from '../src/engine.mjs';
import { SCORING_VERSION } from '../src/scoring.mjs';

function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'chess-review-'));
  const store = new Store({ dataDir }); ensureFixture(store);
  t.after(() => { try { store.close(); } catch {} rmSync(dataDir, { recursive: true, force: true }); });
  return { dataDir, store, reviews: new Reviews(store) };
}
const storedGame = (id, pgn) => ({ id, pgn, playerColor: 'white', sourceLabel: 'Legal replay fixture', white: { username: 'White' }, black: { username: 'Black' }, timeClass: 'fixture' });
function readyAnalysis(store, gameId=FIXTURE_ID) {
  const game=store.getGame(gameId), history=replay(game,0).history;
  const positions=Array.from({length:history.length+1},(_,ply)=>{
    const chess=replay(game,ply).chess, legal=chess.moves({verbose:true});
    const bestMove=ply===0?'d2d4':ply===1?'c7c5':legal[0] && legal[0].from+legal[0].to+(legal[0].promotion || '');
    return {ready:true,exact:true,profileId:ENGINE_PROFILE.id,profile:'refinement',fen:chess.fen(),sideToMove:chess.turn(),cp:ply*10,
      bestMove:bestMove || null,pv:bestMove?[bestMove]:[]};
  });
  const analysis={readiness:'ready',pgnHash:createHash('sha256').update(game.pgn).digest('hex'),
    profile:{version:SCORING_VERSION,engineId:ENGINE_PROFILE.id},accuracy:{w:80,b:70},playerAccuracy:80,positions,
    moves:history.map((move,i)=>({ply:i+1,san:move.san,color:move.color,uci:move.from+move.to+(move.promotion || ''),
      before:positions[i],after:positions[i+1],best:positions[i],classification:{ready:true,label:i===0?'Mistake':i===1?'Blunder':'Good',loss:i+1}})),keyMoments:[1]};
  store.set('analyses',gameId,analysis);return analysis;
}
test('checked best replacement starts before the requested played move and preserves canonical game, scores and other sessions', t => {
  const {store,reviews}=setup(t), original=readyAnalysis(store), game=store.getGame(FIXTURE_ID), first=reviews.open(), other=reviews.open();
  let state=reviews.go({sessionId:first.sessionId,expectedRevision:first.revision,ply:5});
  state=reviews.bestMove({sessionId:state.sessionId,expectedRevision:state.revision,ply:1});
  assert.equal(state.selectedPly,0);assert.deepEqual(state.variation,['d4']);
  const expected=replay(game,0).chess;expected.move('d4');assert.equal(state.fen,expected.fen());
  assert.equal(state.revision,3);assert.equal(state.analysis.currentPosition,null);
  assert.equal(store.get('answer-exposures',`${FIXTURE_ID}:1`).source,'checked best-move comparison');
  assert.deepEqual(store.get('analyses',FIXTURE_ID),original);assert.deepEqual(store.getGame(FIXTURE_ID),game);
  assert.equal(reviews.context(other.sessionId).selectedPly,0);assert.deepEqual(reviews.context(other.sessionId).variation,[]);
  state=reviews.go({sessionId:state.sessionId,expectedRevision:state.revision,ply:1});
  assert.equal(state.selectedPly,1);assert.deepEqual(state.variation,[]);assert.equal(state.fen,replay(game,1).chess.fen());
  state=reviews.bestMove({sessionId:state.sessionId,expectedRevision:state.revision,ply:2});
  assert.equal(state.selectedPly,1);assert.deepEqual(state.variation,['c5']);
  assert.equal(store.get('answer-exposures',`${FIXTURE_ID}:2`),null,'an opponent replacement is not help for a player decision');
});
test('best replacement rejects stale, incomplete, mismatched and illegal evidence without committing or exposing answers', t => {
  const {store,reviews}=setup(t), original=readyAnalysis(store), state=reviews.open(), guard={sessionId:state.sessionId,expectedRevision:state.revision,ply:1};
  assert.throws(()=>reviews.bestMove({...guard,expectedRevision:99}),/Stale revision/);
  for(const ply of [undefined,0,-1,1.5,100]) assert.throws(()=>reviews.bestMove({...guard,ply}));
  for(const alter of [
    a=>{a.readiness='analyzing';}, a=>{a.pgnHash='another-game';},a=>{a.profile.engineId='another-engine';},
    a=>{a.positions[0].ready=false;},a=>{a.positions[0].exact=false;},a=>{a.positions[0].bound='lowerbound';},
    a=>{a.positions[0].canonicalEligible=false;},a=>{a.positions[0].profile='ordinary';},
    a=>{a.positions[0].fen=replay(store.getGame(FIXTURE_ID),1).chess.fen();},a=>{a.positions[0].sideToMove='b';},
    a=>{a.moves[0].uci='d2d4';},a=>{a.positions[0].pv=['e2e4'];},a=>{a.positions[0].pv=['d2d4','e7e5','d4d8'];}
  ]) {
    const corrupted=structuredClone(original);alter(corrupted);store.set('analyses',FIXTURE_ID,corrupted);
    assert.throws(()=>reviews.bestMove(guard));
    assert.equal(store.get('sessions',state.sessionId).revision,state.revision);
    assert.deepEqual(store.get('sessions',state.sessionId).variation,[]);
    assert.equal(store.get('answer-exposures',`${FIXTURE_ID}:1`),null);
  }
});
test('best replacement preserves checked promotion as SAN from a custom original starting position', t => {
  const {store,reviews}=setup(t),game=storedGame('promotion','[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/7K/8 w - - 0 1"]\n\n1. a8=Q *');
  store.set('games',game.id,game);const canonical=readyAnalysis(store,game.id);
  canonical.positions[0].bestMove='a7a8n';canonical.positions[0].pv=['a7a8n'];store.set('analyses',game.id,canonical);
  const state=reviews.open({gameId:game.id}),comparison=reviews.bestMove({sessionId:state.sessionId,expectedRevision:state.revision,ply:1});
  assert.deepEqual(comparison.variation,['a8=N']);assert.equal(comparison.selectedPly,0);
  const after=replay(game,0).chess;after.move('a8=N');assert.equal(comparison.fen,after.fen());
  assert.equal(store.getGame(game.id).pgn,game.pgn);
});
test('best comparison rejects a hidden retry and failed exposure write rolls back session mutation', t => {
  const {store}=setup(t);readyAnalysis(store);
  const reviews=new Reviews(store,{learning:{get:()=>({answerExposed:false}),savedMistakes:()=>[],progress:()=>({})}}),state=reviews.open();
  store.update('sessions',state.sessionId,s=>({...s,retryId:'hidden'}));
  assert.throws(()=>reviews.bestMove({sessionId:state.sessionId,expectedRevision:state.revision,ply:1}),/Submit a retry/);
  assert.equal(store.get('answer-exposures',`${FIXTURE_ID}:1`),null);
  store.update('sessions',state.sessionId,s=>({...s,retryId:undefined}));
  const set=store.set.bind(store);store.set=(namespace,key,value)=>{if(namespace==='sessions')throw new Error('Injected session commit failure');return set(namespace,key,value);};
  assert.throws(()=>reviews.bestMove({sessionId:state.sessionId,expectedRevision:state.revision,ply:1}),/Injected session commit failure/);
  assert.equal(store.get('answer-exposures',`${FIXTURE_ID}:1`),null);
  assert.equal(store.get('sessions',state.sessionId).revision,state.revision);
});
test('move overview includes both colors and canonical after evaluations only when ready and unmasked', t => {
  const {store}=setup(t),canonical=readyAnalysis(store),reviews=new Reviews(store,{learning:{get:()=>({answerExposed:false}),savedMistakes:()=>[],progress:()=>({})}});
  canonical.moves[6].after={...canonical.moves[6].after,cp:undefined,mate:0};store.set('analyses',FIXTURE_ID,canonical);
  const state=reviews.open(), assessments=state.analysis.moveAssessments;
  assert.equal(assessments.length,7);
  assert.deepEqual(assessments[0],{ply:1,san:'e4',color:'w',label:'Mistake',loss:1,cp:10,mate:null});
  assert.deepEqual(assessments[1],{ply:2,san:'e5',color:'b',label:'Blunder',loss:2,cp:20,mate:null});
  assert.equal(assessments[6].mate,0);assert.equal(assessments[6].cp,null);
  assert.equal(state.analysis.keyMoments.length,1);assert.equal(state.analysis.selectedMove,undefined);
  store.update('sessions',state.sessionId,s=>({...s,retryId:'hidden'}));
  assert.equal(reviews.context(state.sessionId).analysis.moveAssessments,undefined);
  store.update('sessions',state.sessionId,s=>({...s,retryId:undefined}));
  for(const readiness of ['pending','analyzing','failed','interrupted']) {
    store.set('analyses',FIXTURE_ID,{...canonical,readiness});assert.equal(reviews.context(state.sessionId).analysis.moveAssessments,undefined);
  }
});
test('native AI note appears in unchanged-revision sync and preserves game, canonical analysis and session', t => {
  const {store,reviews}=setup(t),canonical=readyAnalysis(store),game=store.getGame(FIXTURE_ID),state=reviews.open(),session=store.get('sessions',state.sessionId);
  const note=reviews.publishCoachingNote({sessionId:state.sessionId,expectedRevision:state.revision,text:'  Develop a piece before moving the queen again.  '});
  assert.equal(note.revision,state.revision);assert.equal(note.fen,state.fen);
  assert.equal(note.coachingNote.text,'Develop a piece before moving the queen again.');assert.equal(note.coachingNote.label,'AI interpretation');
  assert.deepEqual(store.get('sessions',state.sessionId),session);assert.deepEqual(store.get('analyses',FIXTURE_ID),canonical);assert.deepEqual(store.getGame(FIXTURE_ID),game);
  const sync=reviews.sync({sessionId:state.sessionId,mountId:'notes-mount',knownRevision:state.revision});
  assert.equal(sync.changed,false);assert.equal(sync.state.coachingNote.text,note.coachingNote.text);
  const next=reviews.go({sessionId:state.sessionId,expectedRevision:state.revision,ply:1});
  assert.equal(next.coachingNote,undefined);
  assert.throws(()=>reviews.publishCoachingNote({sessionId:state.sessionId,expectedRevision:state.revision,text:'Late explanation'}),/Stale revision/);
  assert.equal(store.get('coaching-notes',state.sessionId).text,note.coachingNote.text);
});
test('coaching notes require matching session, revision, FEN, game, played ply and variation identity', t => {
  const {store,reviews}=setup(t);readyAnalysis(store);const state=reviews.open(),other=reviews.open();
  reviews.publishCoachingNote({sessionId:state.sessionId,expectedRevision:state.revision,text:'A position-specific interpretation.'});
  const original=store.get('coaching-notes',state.sessionId);
  assert.equal(reviews.context(other.sessionId).coachingNote,undefined);
  assert.throws(()=>reviews.publishCoachingNote({sessionId:'missing-session',expectedRevision:1,text:'Missing session'}),/expired or disconnected/);
  for(const patch of [{sessionId:other.sessionId},{revision:99},{fen:replay(store.getGame(FIXTURE_ID),1).chess.fen()},
    {gameId:'another-game'},{selectedPly:1},{variation:['e4']}]) {
    store.set('coaching-notes',state.sessionId,{...original,...patch});assert.equal(reviews.context(state.sessionId).coachingNote,undefined);
  }
  store.set('coaching-notes',state.sessionId,original);
  store.update('sessions',state.sessionId,s=>({...s,revision:s.revision+1}));
  assert.equal(reviews.context(state.sessionId).coachingNote,undefined,'an analysis-driven revision invalidates an explanation even with unchanged FEN');
});
test('coaching note rejects hidden retries, unfinished analysis and invalid text without writing', t => {
  const {store}=setup(t),canonical=readyAnalysis(store),reviews=new Reviews(store,{learning:{get:()=>({answerExposed:false}),savedMistakes:()=>[],progress:()=>({})}}),state=reviews.open();
  const guard={sessionId:state.sessionId,expectedRevision:state.revision,text:'Checked interpretation'};
  for(const text of [undefined,'',' \n ', 'x'.repeat(801)]) assert.throws(()=>reviews.publishCoachingNote({...guard,text}),/1 to 800/);
  assert.throws(()=>reviews.publishCoachingNote({...guard,expectedRevision:undefined}),/explicit positive/);
  store.update('sessions',state.sessionId,s=>({...s,retryId:'hidden'}));
  assert.throws(()=>reviews.publishCoachingNote(guard),/Submit a retry/);
  assert.equal(store.get('coaching-notes',state.sessionId),null);
  store.update('sessions',state.sessionId,s=>({...s,retryId:undefined}));
  reviews.publishCoachingNote(guard);
  store.update('sessions',state.sessionId,s=>({...s,retryId:'hidden'}));assert.equal(reviews.context(state.sessionId).coachingNote,undefined);
  store.update('sessions',state.sessionId,s=>({...s,retryId:undefined}));
  for(const readiness of ['pending','analyzing','failed','interrupted']) {
    store.set('analyses',FIXTURE_ID,{...canonical,readiness});
    assert.equal(reviews.context(state.sessionId).coachingNote,undefined);
    assert.throws(()=>reviews.publishCoachingNote({...guard,text:'Should not publish'}),/Complete canonical/);
  }
  assert.equal(store.get('coaching-notes',state.sessionId).text,guard.text);
});
test('opening or selecting a new game starts analysis automatically, but never resumes a failed job implicitly', t => {
  const { store } = setup(t), started = [];
  const statuses = new Map();
  const analysis = {
    status: gameId => ({ readiness: statuses.get(gameId) || 'pending' }),
    start: gameId => {
      started.push(gameId); statuses.set(gameId, 'analyzing');
      for (const session of store.list('sessions')) if (session.gameId === gameId) store.set('sessions', session.sessionId, { ...session, revision: session.revision + 1 });
    }
  };
  const reviews = new Reviews(store, { analysis });
  let state = reviews.open();
  assert.deepEqual(started, [FIXTURE_ID]);
  assert.equal(state.analysis.readiness, 'analyzing'); assert.equal(state.revision, 2);
  assert.equal(state.analysis.playerAccuracy, undefined);
  reviews.open({ sessionId: state.sessionId });
  assert.equal(started.length, 1);
  for (const readiness of ['failed', 'interrupted', 'ready']) {
    statuses.set(FIXTURE_ID, readiness);
    assert.equal(reviews.open({ sessionId: state.sessionId }).analysis.readiness, readiness);
    assert.equal(started.length, 1);
  }
  store.set('games', 'new-game', storedGame('new-game', '1. e4 e5 *'));
  assert.throws(() => reviews.select({ sessionId: state.sessionId, expectedRevision: 1, gameId: 'new-game' }), /Stale revision/);
  assert.equal(started.length, 1);
  state = reviews.select({ sessionId: state.sessionId, expectedRevision: state.revision, gameId: 'new-game' });
  assert.equal(state.gameId, 'new-game'); assert.equal(state.analysis.readiness, 'analyzing');
  assert.deepEqual(started, [FIXTURE_ID, 'new-game']);
  assert.equal(state.revision, 4);
});
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
