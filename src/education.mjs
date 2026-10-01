import { ENGINE_PROFILE, replayPosition } from './engine.mjs';
import { replay } from './review.mjs';

const uci = m => m.from + m.to + (m.promotion || '');
const movePattern = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const squarePattern = /^[a-h][1-8]$/;
function visualLabel(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 48 || /[\r\n<>`]/.test(value)) {
    throw new Error('Visual titles and labels must be plain text with 1 to 48 characters');
  }
  if (/\b[a-h][1-8](?:[a-h][1-8][qrbn]?)?\b/i.test(value) || /\b[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?(?=$|\s|[.,;:!?])/.test(value) || /\b[O0]-[O0](?:-[O0])?\b/.test(value)) {
    throw new Error('Use plain piece and action words instead of chess notation in visual titles and labels');
  }
  return value.trim();
}
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
  async publishVisual(args) {
    const {context,chess}=this.selected(args);
    if (context.analysis.readiness !== 'ready') throw new Error('Complete canonical analysis is required for a coaching visual');
    const title=visualLabel(args.title);
    if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 4) throw new Error('A coaching visual requires 1 to 4 checked steps');
    const proposed=[];
    for (const step of args.steps) {
      if (!step || typeof step.move !== 'string' || !movePattern.test(step.move)) throw new Error('Visual steps require legal UCI moves');
      const label=visualLabel(step.label),focus=step.focus ?? [];
      if (!Array.isArray(focus) || focus.length > 4 || focus.some(square=>typeof square !== 'string' || !squarePattern.test(square))) {
        throw new Error('Visual focus must contain at most 4 board squares');
      }
      proposed.push({move:step.move,label,focus:[...new Set(focus)]});
    }
    const checked=await this.position(args),evidence=checked.evidence;
    if (!evidence.ready || evidence.exact !== true || evidence.bound || evidence.canonicalEligible === false ||
        evidence.profileId !== ENGINE_PROFILE.id || evidence.profile !== 'refinement' || evidence.budget !== ENGINE_PROFILE.refinementNodes ||
        evidence.fen !== context.fen || evidence.sideToMove !== chess.turn()) {
      throw new Error('Exact checked refinement evidence is required for a coaching visual');
    }
    const steps=[];
    for (let index=0;index<proposed.length;index++) {
      const step=proposed[index],continuation=checked.checkedContinuation[index];
      if (!continuation || step.move !== continuation.uci) throw new Error('Visual moves must be an exact prefix of the checked continuation');
      const played=chess.move({from:step.move.slice(0,2),to:step.move.slice(2,4),promotion:step.move[4]});
      if (step.focus.some(square=>!chess.get(square))) throw new Error('Visual focus must highlight pieces present after that step');
      steps.push({uci:step.move,san:played.san,fen:chess.fen(),label:step.label,focus:step.focus,
        piece:played.piece,color:played.color,from:played.from,to:played.to});
    }
    return this.store.transaction(()=>{
      const current=this.selected(args).context;
      if (current.analysis.readiness !== 'ready' || current.fen !== checked.fen) throw new Error('The selected position is no longer ready for this coaching visual');
      this.store.set('coaching-notes',current.sessionId,{sessionId:current.sessionId,gameId:current.gameId,revision:current.revision,fen:current.fen,
        selectedPly:current.selectedPly,variation:[...current.variation],text:title,label:'AI interpretation',createdAt:this.store.now(),visual:{title,steps}});
      return this.reviews.context(current.sessionId);
    });
  }
}
