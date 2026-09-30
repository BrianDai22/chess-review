import { Chess } from 'chess.js';
import { createHash, randomUUID } from 'node:crypto';
import { ENGINE_PROFILE } from './engine.mjs';
import { SCORING_VERSION } from './scoring.mjs';

export const FIXTURE_ID = 'fixture-scholars-mate';
export function ensureFixture(store) {
  if (!store.getGame(FIXTURE_ID)) store.set('games', FIXTURE_ID, {
    id: FIXTURE_ID, sourceLabel: 'Verification fixture (not Brian’s game)', fixture: true,
    playerColor: 'white', white: { username: 'Fixture White' }, black: { username: 'Fixture Black' },
    pgn: '[Event "Verification fixture"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0',
    timeClass: 'fixture', timeControl: '0', endTime: 0
  });
}
export function replay(game, ply) {
  const full = new Chess(); full.loadPgn(game.pgn);
  const history = full.history({ verbose: true });
  if (!Number.isInteger(ply) || ply < 0 || ply > history.length) throw new Error('Invalid ply');
  const initialFen = full.header().FEN;
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  for (const move of history.slice(0, ply)) chess.move(move);
  return { chess, history, initialFen: initialFen || new Chess().fen() };
}
function requireSession(store, id) {
  const s = store.get('sessions', id);
  if (!s || s.closed) throw new Error('Review session expired or disconnected');
  return s;
}
export class Reviews {
  constructor(store, { learning, analysis } = {}) { this.store = store; this.learning = learning; this.analysis = analysis; }
  open({ gameId, sessionId } = {}) {
    if (sessionId) {
      const state = this.context(sessionId);
      if (gameId && state.gameId !== gameId) throw new Error('Game and session identity conflict');
      return this.analyzeNewGame(state);
    }
    gameId ??= FIXTURE_ID;
    if (!this.store.getGame(gameId)) throw new Error('Game not found');
    const id = randomUUID();
    this.store.set('sessions', id, { sessionId: id, gameId, selectedPly: 0, variation: [], revision: 1, createdAt: Date.now() });
    return this.analyzeNewGame(this.context(id));
  }
  analyzeNewGame(state) {
    if (state.analysis.readiness === 'pending' && this.analysis?.start) {
      this.analysis.start(state.gameId);
      return this.context(state.sessionId);
    }
    return state;
  }
  context(id) {
    let s = requireSession(this.store, id);
    const status = this.analysis?.status(s.gameId);
    s = requireSession(this.store,id);
    const game = this.store.getGame(s.gameId);
    const { chess, history, initialFen } = replay(game, s.selectedPly);
    const moveHistory = chess.history();
    for (const move of s.variation) { chess.move(move); moveHistory.push(move); }
    const storedAnalysis = this.store.get('analyses', s.gameId);
    const fullAnalysis = status && (storedAnalysis?.analysisKey !== status.analysisKey || storedAnalysis?.readiness !== status.readiness) ? status : storedAnalysis || status || { readiness: 'pending' };
    const retry = s.retryId && this.learning ? this.learning.get({ sessionId: id, retryId: s.retryId }) : undefined;
    const hidden = retry && !retry.answerExposed;
    const note = !hidden && fullAnalysis.readiness === 'ready' ? this.store.get('coaching-notes',id) : null;
    const coachingNote = note && note.sessionId === id && note.gameId === s.gameId && note.revision === s.revision && note.fen === chess.fen() &&
      note.selectedPly === s.selectedPly && JSON.stringify(note.variation) === JSON.stringify(s.variation) ? note : undefined;
    const assessment = e => e && Object.fromEntries(['ready','exact','cp','mate','winner','terminal','profileId','profile','budget','fen','sideToMove','bestMove','depth','nodes'].filter(k => e[k] !== undefined).map(k => [k,e[k]]).concat([['pv',(e.pv || []).slice(0,12)]]));
    const selected = fullAnalysis.moves?.find(m => m.ply === s.selectedPly);
    const analysis = { readiness: fullAnalysis.readiness, completedPositions: fullAnalysis.completedPositions, totalPositions: fullAnalysis.totalPositions,
      error: fullAnalysis.error, profile: fullAnalysis.profile, phase: fullAnalysis.phase, currentMove: fullAnalysis.currentMove, totalMoves: fullAnalysis.totalMoves,
      ...(!hidden && fullAnalysis.readiness === 'ready' ? { accuracy: fullAnalysis.accuracy, playerAccuracy: fullAnalysis.playerAccuracy,
        currentPosition: s.variation.length ? null : assessment(fullAnalysis.positions?.[s.selectedPly]),
        selectedMove: selected && { ply:selected.ply,color:selected.color,san:selected.san,uci:selected.uci,classification:selected.classification,
          before:assessment(selected.before),after:assessment(selected.after),best:assessment(selected.best) },
        keyMoments: (fullAnalysis.keyMoments || []).slice(0,12).map(ply => { const m=fullAnalysis.moves.find(m=>m.ply === (ply.ply ?? ply)); return m && {ply:m.ply,san:m.san,label:m.classification.label,loss:m.classification.loss,color:m.color}; }).filter(Boolean),
        moveAssessments: (fullAnalysis.moves || []).map(m => ({ ply:m.ply,san:m.san,color:m.color,label:m.classification.label,loss:m.classification.loss,
          cp:Number.isFinite(m.after?.cp) ? m.after.cp : null,mate:Number.isFinite(m.after?.mate) ? m.after.mate : null })) } : {}) };
    const liveMounts = this.store.list('mounts').filter(m => m.sessionId === id && Date.now() - m.seenAt < 15000)
      .map(m => ({ mountId: m.mountId, displayedRevision: m.displayedRevision, contextRevision: m.contextRevision, contextUpdateId: m.contextUpdateId }));
    return { ...s, fen: chess.fen(), initialFen, moveHistory, totalPlies: history.length, playedMoves: history.slice(0, hidden ? s.selectedPly : history.length).map(m => m.san),
      playerColor: game.playerColor, sideToMove: chess.turn() === 'w' ? 'white' : 'black',
      sourceLabel: game.sourceLabel, game: { white: game.white, black: game.black, timeClass: game.timeClass, timeControl: game.timeControl },
      legalMoves: chess.moves({ verbose: true }).map(m => ({ san: m.san, from: m.from, to: m.to, promotion: m.promotion })),
      analysis, retry, coachingNote, learning: !hidden && this.learning ? { savedMistakes:this.learning.savedMistakes().slice(0,8),progress:this.learning.progress() } : undefined,
      scoringVersion: analysis.profile?.version || 'pending',
      view: { liveMounts, backendRevision: s.revision, displayed: liveMounts.some(m => m.displayedRevision === s.revision), hostContextAccepted: liveMounts.some(m => m.contextRevision === s.revision), modelConsumptionVerified: false },
      summary: `${game.sourceLabel}. Played ply ${s.selectedPly}${s.variation.length ? '; variation ' + s.variation.join(' ') : ''}. ${chess.turn() === 'w' ? 'White' : 'Black'} to move. Revision ${s.revision}.` };
  }
  mutate({ sessionId, expectedRevision }, fn) {
    this.store.update('sessions', sessionId, s => {
      if (!s || s.closed) throw new Error('Review session expired or disconnected');
      if (s.revision !== expectedRevision) throw new Error(`Stale revision: expected ${expectedRevision}, current ${s.revision}. Read current context.`);
      const next = fn({ ...s }); return { ...next, revision: s.revision + 1 };
    });
    return this.context(sessionId);
  }
  go(args) { return this.mutate(args, s => { replay(this.store.getGame(s.gameId), args.ply); return { ...s, selectedPly: args.ply, variation: [], retryId: undefined }; }); }
  select(args) { return this.analyzeNewGame(this.mutate(args, s => { const game=this.store.getGame(args.gameId);if (!game) throw new Error('Game not found');replay(game,0);return {...s,gameId:args.gameId,selectedPly:0,variation:[],retryId:undefined}; })); }
  endRetry(args) { return this.mutate(args, s => ({...s,retryId:undefined,variation:[]})); }
  variation(args) {
    return this.mutate(args, s => {
      if (s.retryId && this.learning && !this.learning.get({sessionId:s.sessionId,retryId:s.retryId}).answerExposed) throw new Error('Submit a retry attempt or request help before showing an answer');
      const { chess } = replay(this.store.getGame(s.gameId), s.selectedPly);
      const moves = [];
      for (const move of args.moves) moves.push(chess.move(move).san);
      return { ...s, variation: moves };
    });
  }
  bestMove(args) {
    return this.store.transaction(() => this.mutate(args, s => {
      if (!Number.isInteger(args.ply) || args.ply < 1) throw new Error('An explicit positive played ply is required');
      if (s.retryId && this.learning && !this.learning.get({sessionId:s.sessionId,retryId:s.retryId}).answerExposed) throw new Error('Submit a retry attempt or request help before showing an answer');
      const game = this.store.getGame(s.gameId), canonical = this.store.get('analyses',s.gameId);
      if (canonical?.readiness !== 'ready' || canonical.pgnHash !== createHash('sha256').update(game.pgn).digest('hex') ||
          canonical.profile?.version !== SCORING_VERSION || canonical.profile?.engineId !== ENGINE_PROFILE.id) throw new Error('Complete canonical analysis of the original game is required');
      const { chess, history } = replay(game,args.ply-1), played = history[args.ply-1];
      const selected = canonical.moves?.find(m => m.ply === args.ply), evidence = canonical.positions?.[args.ply-1];
      if (!played || !selected || selected.uci !== played.from+played.to+(played.promotion || '') || selected.color !== played.color ||
          !evidence?.ready || evidence.exact !== true || evidence.bound || evidence.canonicalEligible === false ||
          evidence.profileId !== ENGINE_PROFILE.id || evidence.profile !== 'refinement' || evidence.fen !== chess.fen() || evidence.sideToMove !== chess.turn() ||
          selected.before?.fen !== evidence.fen || selected.before?.bestMove !== evidence.bestMove ||
          !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(evidence.bestMove || '') || !Array.isArray(evidence.pv) || evidence.pv[0] !== evidence.bestMove) throw new Error('Checked canonical best-move evidence is unavailable for this played move');
      const checked = new Chess(chess.fen());
      let best;
      try {
        for (const move of evidence.pv) {
          if (typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error('Invalid checked continuation');
          const legal = checked.move({from:move.slice(0,2),to:move.slice(2,4),promotion:move[4]});
          best ??= legal.san;
        }
      } catch { throw new Error('Checked canonical continuation is not legal in the original position'); }
      if (played.color === (game.playerColor === 'black' ? 'b' : 'w')) this.store.set('answer-exposures',`${s.gameId}:${args.ply}`,
        {gameId:s.gameId,ply:args.ply,at:this.store.now(),source:'checked best-move comparison'});
      return {...s,selectedPly:args.ply-1,variation:[best],retryId:undefined};
    }));
  }
  publishCoachingNote(args) {
    return this.store.transaction(() => {
      if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1) throw new Error('An explicit positive session revision is required');
      if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 800) throw new Error('Coaching text must contain 1 to 800 characters');
      const state = this.context(args.sessionId);
      if (state.revision !== args.expectedRevision) throw new Error('Stale revision. Read current context.');
      if (state.retry && !state.retry.answerExposed) throw new Error('Submit a retry attempt or request help before showing an answer');
      if (state.analysis.readiness !== 'ready') throw new Error('Complete canonical analysis is required for a coaching note');
      this.store.set('coaching-notes',state.sessionId,{sessionId:state.sessionId,gameId:state.gameId,revision:state.revision,fen:state.fen,
        selectedPly:state.selectedPly,variation:[...state.variation],text:args.text.trim(),label:'AI interpretation',createdAt:this.store.now()});
      return this.context(state.sessionId);
    });
  }
  return(args) { return this.mutate(args, s => ({ ...s, variation: [] })); }
  sync({ sessionId, mountId, knownRevision, displayedRevision, contextRevision, contextUpdateId }) {
    return this.store.transaction(() => {
    const state = this.context(sessionId), key = `${sessionId}:${mountId}`;
    const ack = this.store.update('mounts', key, previous => {
      const current = previous && Date.now() - previous.seenAt < 15000 ? previous : { sessionId, mountId };
      const next = { ...current, seenAt: Date.now() };
      if (displayedRevision === state.revision) next.displayedRevision = displayedRevision;
      if (contextRevision === state.revision && contextUpdateId) { next.contextRevision = contextRevision; next.contextUpdateId = contextUpdateId; }
      return next;
    });
    return { state, changed: knownRevision !== state.revision, displayAcknowledgement: ack.displayedRevision === state.revision,
      hostContextAcknowledgement: ack.contextRevision === state.revision, modelConsumptionVerified: false };
    });
  }
}
