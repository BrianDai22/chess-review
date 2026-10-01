import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {Reviews,ensureFixture} from '../src/review.mjs';
import {Engine,ENGINE_PROFILE,replayPosition} from '../src/engine.mjs';
import {Education} from '../src/education.mjs';
function fixture(t,options={}) {const dir=mkdtempSync(join(tmpdir(),'chess-education-')),store=new Store({dataDir:dir});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});ensureFixture(store);const reviews=new Reviews(store,options);return {store,reviews,state:reviews.open()};}
test('actual checked evidence shows mate and a strong opponent response missed in the played line',async t=>{
 const {store,reviews,state}=fixture(t),education=new Education({store,reviews,engine:new Engine()});
 const selected=reviews.go({sessionId:state.sessionId,expectedRevision:state.revision,ply:6}),args={sessionId:selected.sessionId,expectedRevision:selected.revision};
 const before=store.getGame(state.gameId).pgn;
 const position=await education.position(args); assert.equal(position.evidence.ready,true);assert.equal(position.sideToMove,'w');assert.equal(position.checkedContinuation[0].san,'Qxf7#');
 const candidate=await education.candidate({...args,move:'a3'});assert.equal(candidate.evidence.ready,true);assert.equal(candidate.checkedOpponentResponse[0].san,'Nxh5');
 assert.equal(candidate.canonicalScoreChanged,false);assert.equal(store.get('analyses',state.gameId),null);assert.equal(store.getGame(state.gameId).pgn,before);assert.equal(reviews.context(state.sessionId).revision,selected.revision);
 const positions=[];positions[6]=position.evidence;
 store.set('analyses',state.gameId,{readiness:'ready',positions,moves:[],accuracy:{w:99,b:50},keyMoments:[]});
 const visual=await education.publishVisual({...args,title:'Queen finishes the attack',steps:[{move:'h5f7',label:'Queen traps the king',focus:['f7','e8']}]});
 assert.equal(visual.coachingNote.visual.steps[0].san,'Qxf7#');
 assert.equal(replayPosition(visual.coachingNote.visual.steps[0].fen).isCheckmate(),true);
 assert.equal(visual.fen,selected.fen);assert.equal(visual.revision,selected.revision);assert.equal(store.getGame(state.gameId).pgn,before);
});
function visualFixture(t,options={}) {
 const data=fixture(t,options),{store,reviews,state}=data;
 const evidence={ready:true,exact:true,canonicalEligible:true,profileId:ENGINE_PROFILE.id,profile:'refinement',budget:ENGINE_PROFILE.refinementNodes,
  fen:state.fen,sideToMove:'w',cp:20,bestMove:'e2e4',pv:['e2e4','e7e5','g1f3','b8c6']};
 store.set('analyses',state.gameId,{readiness:'ready',positions:[evidence],moves:[],accuracy:{w:92,b:86},keyMoments:[]});
 const education=new Education({store,reviews,engine:{analyze:()=>{throw Error('cached checked evidence should be reused');}}});
 const args={sessionId:state.sessionId,expectedRevision:state.revision,title:'Build the center',steps:[
  {move:'e2e4',label:'Pawn claims the center',focus:['e4']},
  {move:'e7e5',label:'Opponent contests the center',focus:['e4','e5']}]};
 return {...data,evidence,education,args};
}
test('checked visual stores each resulting position without changing original game, score or selected board',async t=>{
 const {store,reviews,state,education,args}=visualFixture(t);
 const beforeGame=store.getGame(state.gameId),beforeAnalysis=store.get('analyses',state.gameId),beforeSession=store.get('sessions',state.sessionId);
 const result=await education.publishVisual(args),note=result.coachingNote;
 assert.equal(note.text,args.title);assert.equal(note.label,'AI interpretation');assert.equal(note.visual.title,args.title);
 assert.deepEqual(note.visual.steps.map(s=>[s.uci,s.san,s.piece,s.color,s.from,s.to]),[
  ['e2e4','e4','p','w','e2','e4'],['e7e5','e5','p','b','e7','e5']]);
 assert.equal(replayPosition(note.visual.steps[0].fen).get('e4').color,'w');
 assert.equal(replayPosition(note.visual.steps[1].fen).get('e5').color,'b');
 assert.deepEqual(store.getGame(state.gameId),beforeGame);assert.deepEqual(store.get('analyses',state.gameId),beforeAnalysis);
 assert.deepEqual(store.get('sessions',state.sessionId),beforeSession);assert.equal(result.fen,state.fen);assert.equal(result.revision,state.revision);
 reviews.go({sessionId:state.sessionId,expectedRevision:state.revision,ply:1});assert.equal(reviews.context(state.sessionId).coachingNote,undefined);
});
test('visual rejects skipped, different, illegal or unchecked moves and nonexistent focus pieces',async t=>{
 const {store,state,education,args}=visualFixture(t);
 for(const steps of [
  [{move:'e7e5',label:'Opponent contests the center'}],
  [{move:'d2d4',label:'Pawn claims the center'}],
  [{move:'e2e5',label:'Pawn claims the center'}],
  [{move:'e2e4',label:'Pawn claims the center',focus:['e2']}],
  [{move:'e2e4',label:'Pawn claims the center',focus:['d4']}],
  [...args.steps,{move:'f1c4',label:'Bishop joins the attack'}],
 ]) {
  await assert.rejects(education.publishVisual({...args,steps}),/prefix|pieces present/);
  assert.equal(store.get('coaching-notes',state.sessionId),null);
 }
});
test('visual validates short plain wording, UCI moves and bounded step/focus input',async t=>{
 const {education,args}=visualFixture(t);
 for(const title of ['', 'a'.repeat(49),'Attack f7','Play Qxf7#','Try e2e4','Prepare O-O','<b>Attack</b>','First\nsecond']) {
  await assert.rejects(education.publishVisual({...args,title}),/plain|notation/);
 }
 for(const steps of [[],Array(5).fill(args.steps[0]),[{move:'e4',label:'Move the pawn'}],
  [{move:'e2e4',label:'Qh5 attacks'}],[{move:'e2e4',label:'a'.repeat(49)}],
  [{move:'e2e4',label:'Move the pawn',focus:['z9']}],
  [{move:'e2e4',label:'Move the pawn',focus:['a1','b1','c1','d1','e1']}]]) {
  await assert.rejects(education.publishVisual({...args,steps}),/steps|UCI|notation|plain|squares/);
 }
});
test('visual rejects hidden retries, stale requests, incomplete analysis and bound evidence',async t=>{
 const {store,state,education,args}=visualFixture(t,{learning:{get:()=>({answerExposed:false}),savedMistakes:()=>[],progress:()=>({groups:[]})}});
 await assert.rejects(education.publishVisual({...args,expectedRevision:state.revision+1}),/Stale/);
 store.update('sessions',state.sessionId,s=>({...s,retryId:'hidden'}));
 await assert.rejects(education.publishVisual(args),/retry attempt/);
 store.update('sessions',state.sessionId,s=>({...s,retryId:undefined}));
 store.update('analyses',state.gameId,a=>({...a,readiness:'analyzing'}));
 await assert.rejects(education.publishVisual(args),/Complete canonical/);
 store.update('analyses',state.gameId,a=>({...a,readiness:'ready',positions:a.positions.map(e=>({...e,exact:false,bound:'lowerbound'}))}));
 await assert.rejects(education.publishVisual(args),/Exact checked/);
 assert.equal(store.get('coaching-notes',state.sessionId),null);
});
test('late visual evidence is rejected after navigation, hidden retry or readiness change',async t=>{
 for(const change of ['navigation','hidden retry','not ready']) {
  const {store,reviews,state,args,evidence}=visualFixture(t,{learning:{get:()=>({answerExposed:false}),savedMistakes:()=>[],progress:()=>({groups:[]})}});
  // Ready canonical analysis may have no selected-position cache on a branch.
  store.update('analyses',state.gameId,a=>({...a,positions:[]}));
  let finish;const pending=new Promise(resolve=>finish=resolve);
  const education=new Education({store,reviews,engine:{analyze:()=>pending}}),publication=education.publishVisual(args);
  if(change==='navigation') reviews.go({sessionId:state.sessionId,expectedRevision:state.revision,ply:1});
  else if(change==='hidden retry') store.update('sessions',state.sessionId,s=>({...s,retryId:'newly-hidden'}));
  else store.update('analyses',state.gameId,a=>({...a,readiness:'pending'}));
  finish(evidence);
  await assert.rejects(publication,/changed during analysis|retry attempt|no longer ready/);
  assert.equal(store.get('coaching-notes',state.sessionId),null);
 }
});
test('visual on a variation checks full move history and stays bound to that branch',async t=>{
 const {store,reviews,state,evidence}=visualFixture(t),beforeAnalysis=store.get('analyses',state.gameId);
 const selected=reviews.go({sessionId:state.sessionId,expectedRevision:state.revision,ply:2});
 const branch=reviews.variation({sessionId:state.sessionId,expectedRevision:selected.revision,moves:['Nf3']});
 const education=new Education({store,reviews,engine:{analyze:async request=>{
  assert.deepEqual(request.moves,['e2e4','e7e5','g1f3']);assert.equal(request.profile,'refinement');
  return {...evidence,fen:branch.fen,sideToMove:'b',bestMove:'b8c6',pv:['b8c6','f1b5']};
 }}});
 const result=await education.publishVisual({sessionId:state.sessionId,expectedRevision:branch.revision,title:'Develop with pressure',steps:[
  {move:'b8c6',label:'Knight supports the center',focus:['c6']},
  {move:'f1b5',label:'Bishop pressures the knight',focus:['b5','c6']}]});
 assert.deepEqual(result.variation,['Nf3']);assert.equal(result.fen,branch.fen);assert.equal(result.revision,branch.revision);
 assert.equal(result.coachingNote.visual.steps[0].san,'Nc6');assert.deepEqual(result.coachingNote.variation,['Nf3']);
 assert.deepEqual(store.get('analyses',state.gameId),beforeAnalysis);
});
test('late educational evidence cannot describe a newly selected position',async t=>{
 const {store,reviews,state}=fixture(t);let finish;const pending=new Promise(resolve=>finish=resolve);
 const education=new Education({store,reviews,engine:{analyze:()=>pending}});
 const result=education.position({sessionId:state.sessionId,expectedRevision:state.revision});
 reviews.go({sessionId:state.sessionId,expectedRevision:state.revision,ply:1});finish({ready:true,exact:true,cp:20,pv:['e2e4']});await assert.rejects(result,/changed during analysis/);
});
test('unattempted retry masks future moves, scores and checked educational answers',async t=>{
 const {store,reviews,state}=fixture(t,{learning:{get:()=>({retryId:'retry',answerExposed:false}),savedMistakes:()=>[],progress:()=>({groups:[]})}});
 store.set('analyses',state.gameId,{readiness:'ready',accuracy:{w:99,b:50},positions:[{bestMove:'e2e4',pv:['e2e4']}],moves:[],keyMoments:[]});
 store.update('sessions',state.sessionId,s=>({...s,retryId:'retry'}));
 const context=reviews.context(state.sessionId);assert.deepEqual(context.playedMoves,[]);assert.equal(context.analysis.accuracy,undefined);assert.equal(context.analysis.currentPosition,undefined);
 const education=new Education({store,reviews,engine:{analyze:()=>{throw Error('must not analyze hidden answer');}}});
 await assert.rejects(education.position({sessionId:state.sessionId,expectedRevision:state.revision}),/retry attempt/);
 await assert.rejects(education.candidate({sessionId:state.sessionId,expectedRevision:state.revision,move:'e4'}),/retry attempt/);
});
test('opponent means the imported player’s opponent at both ply parities, with coherent color identifiers',async t=>{
 for(const playerColor of ['white','black']) {
  const {store,reviews,state}=fixture(t);
  store.update('games',state.gameId,game=>({...game,playerColor}));
  const education=new Education({store,reviews,engine:{analyze:async()=>({ready:true,exact:true,cp:0,pv:[]})}});
  let selected=reviews.context(state.sessionId);
  for(const ply of [0,1,2]) {
   selected=reviews.go({sessionId:state.sessionId,expectedRevision:selected.revision,ply});
   const evidence=await education.position({sessionId:selected.sessionId,expectedRevision:selected.revision});
   assert.equal(selected.playerColor,playerColor);
   assert.equal(selected.sideToMove,ply%2===0?'white':'black');
   assert.equal(evidence.sideToMove,ply%2===0?'w':'b');
   assert.equal(evidence.teaching.opponentColor,playerColor==='white'?'b':'w');
   const exposure=store.get('answer-exposures',`${state.gameId}:${ply+1}`);
   assert.equal(Boolean(exposure),selected.sideToMove===selected.playerColor);
  }
 }
});
test('education does not reuse a stored score that canonical status has invalidated',async t=>{
 const {store,reviews,state}=fixture(t,{analysis:{status:()=>({analysisKey:'current-profile',readiness:'pending'})}});
 store.set('analyses',state.gameId,{analysisKey:'obsolete-profile',readiness:'ready',positions:[{ready:true,exact:true,cp:900,pv:['e2e4']}]});
 let calls=0;const education=new Education({store,reviews,engine:{analyze:async()=>{calls++;return {ready:false,pv:[]};}}});
 const result=await education.position({sessionId:state.sessionId,expectedRevision:state.revision});
 assert.equal(calls,1);assert.equal(result.evidence.ready,false);assert.equal(reviews.context(state.sessionId).analysis.readiness,'pending');
});
