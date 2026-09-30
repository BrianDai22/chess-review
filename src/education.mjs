import { replayPosition } from './engine.mjs';
import { replay } from './review.mjs';

const uci = m => m.from + m.to + (m.promotion || '');
function checkedLine(initialFen, moves, evidence) {
  const chess = replayPosition(initialFen,moves), line=[];
  for(const move of evidence.pv || []) { const played=chess.move({from:move.slice(0,2),to:move.slice(2,4),promotion:move[4]}); line.push({uci:move,san:played.san,fen:chess.fen()}); }
  return line;
}
export class Education {
  constructor({store,engine,reviews}) { this.store=store;this.engine=engine;this.reviews=reviews; }
  selected(args) {
    const context=this.reviews.context(args.sessionId);
    if(context.revision!==args.expectedRevision) throw new Error('Stale revision. Read current context.');
    if(context.retry && !context.retry.answerExposed) throw new Error('Submit a retry attempt or request help before checking answers.');
    const {history,initialFen}=replay(this.store.getGame(context.gameId),context.selectedPly);
    const moves=history.slice(0,context.selectedPly).map(uci), chess=replayPosition(initialFen,moves);
    for(const move of context.variation) moves.push(uci(chess.move(move)));
    return {context,initialFen,moves,chess};
  }
  stillCurrent(args) { if(this.reviews.context(args.sessionId).revision!==args.expectedRevision) throw new Error('The selected position changed during analysis. Read current context.'); }
  exposed(context,evidence) { if(evidence.ready && context.sideToMove===context.playerColor && !context.variation.length) this.store.set('answer-exposures',`${context.gameId}:${context.selectedPly+1}`,{gameId:context.gameId,ply:context.selectedPly+1,at:this.store.now(),source:'checked education tool'}); }
  async position(args) {
    const {context,initialFen,moves,chess}=this.selected(args);
    const canonical=this.store.get('analyses',context.gameId);
    const cached=!context.variation.length && context.analysis.readiness==='ready' && canonical?.readiness==='ready' ? canonical.positions?.[context.selectedPly] : null;
    const evidence=cached || await this.engine.analyze({initialFen,moves,profile:'refinement'});
    this.stillCurrent(args);
    this.exposed(context,evidence);
    // Evidence uses chess.js w/b; review context uses white/black player labels.
    const opponent=context.playerColor==='black'?'w':'b';
    return {sessionId:context.sessionId,revision:context.revision,fen:chess.fen(),sideToMove:chess.turn(),
      facts:{inCheck:chess.isCheck(),pieces:chess.board().flat().filter(Boolean).map(p=>({square:p.square,color:p.color,type:p.type,attackedByOpponent:chess.isAttacked(p.square,p.color==='w'?'b':'w')}))},
      evidence,checkedContinuation:checkedLine(initialFen,moves,evidence),canonicalScoreChanged:false,
      teaching:{instruction:'Explain the opponent response, a checked alternative, and one reusable decision cue. For a quiet position infer a goal, preparation, counterplay, and a reason to reconsider; label strategic interpretation separately.',opponentColor:opponent,selectedPlayedMove:context.analysis.selectedMove || null}};
  }
  async candidate(args) {
    const {context,initialFen,moves,chess}=this.selected(args), played=chess.move(args.move), move=uci(played);
    const evidence=await this.engine.analyze({initialFen,moves:[...moves,move],profile:'refinement'});
    this.stillCurrent(args);
    this.exposed(context,evidence);
    return {sessionId:context.sessionId,revision:context.revision,candidate:{uci:move,san:played.san,fen:chess.fen()},evidence,
      checkedOpponentResponse:checkedLine(initialFen,[...moves,move],evidence),canonicalScoreChanged:false,
      interpretation:'This is checked candidate evidence under the frozen budget, not a new original-game score or guaranteed continuation.'};
  }
}
