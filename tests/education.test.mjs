import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {Reviews,ensureFixture} from '../src/review.mjs';
import {Engine} from '../src/engine.mjs';
import {Education} from '../src/education.mjs';
function fixture(t,options={}) {const dir=mkdtempSync(join(tmpdir(),'chess-education-')),store=new Store({dataDir:dir});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});ensureFixture(store);const reviews=new Reviews(store,options);return {store,reviews,state:reviews.open()};}
test('actual checked evidence shows mate and a strong opponent response missed in the played line',async t=>{
 const {store,reviews,state}=fixture(t),education=new Education({store,reviews,engine:new Engine()});
 const selected=reviews.go({sessionId:state.sessionId,expectedRevision:state.revision,ply:6}),args={sessionId:selected.sessionId,expectedRevision:selected.revision};
 const before=store.getGame(state.gameId).pgn;
 const position=await education.position(args); assert.equal(position.evidence.ready,true);assert.equal(position.sideToMove,'w');assert.equal(position.checkedContinuation[0].san,'Qxf7#');
 const candidate=await education.candidate({...args,move:'a3'});assert.equal(candidate.evidence.ready,true);assert.equal(candidate.checkedOpponentResponse[0].san,'Nxh5');
 assert.equal(candidate.canonicalScoreChanged,false);assert.equal(store.get('analyses',state.gameId),null);assert.equal(store.getGame(state.gameId).pgn,before);assert.equal(reviews.context(state.sessionId).revision,selected.revision);
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
