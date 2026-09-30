import { Chess } from 'chess.js';
import { randomUUID } from 'node:crypto';

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
      return state;
    }
    gameId ??= FIXTURE_ID;
    if (!this.store.getGame(gameId)) throw new Error('Game not found');
    const id = randomUUID();
    this.store.set('sessions', id, { sessionId: id, gameId, selectedPly: 0, variation: [], revision: 1, createdAt: Date.now() });
    return this.context(id);
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
    const assessment = e => e && Object.fromEntries(['ready','exact','cp','mate','winner','terminal','profileId','profile','budget','fen','sideToMove','bestMove','depth','nodes'].filter(k => e[k] !== undefined).map(k => [k,e[k]]).concat([['pv',(e.pv || []).slice(0,12)]]));
    const selected = fullAnalysis.moves?.find(m => m.ply === s.selectedPly);
    const analysis = { readiness: fullAnalysis.readiness, completedPositions: fullAnalysis.completedPositions, totalPositions: fullAnalysis.totalPositions,
      error: fullAnalysis.error, profile: fullAnalysis.profile,
      ...(!hidden && fullAnalysis.readiness === 'ready' ? { accuracy: fullAnalysis.accuracy, playerAccuracy: fullAnalysis.playerAccuracy,
        currentPosition: s.variation.length ? null : assessment(fullAnalysis.positions?.[s.selectedPly]),
        selectedMove: selected && { ply:selected.ply,color:selected.color,san:selected.san,uci:selected.uci,classification:selected.classification,
          before:assessment(selected.before),after:assessment(selected.after),best:assessment(selected.best) },
        keyMoments: (fullAnalysis.keyMoments || []).slice(0,12).map(ply => { const m=fullAnalysis.moves.find(m=>m.ply === (ply.ply ?? ply)); return m && {ply:m.ply,san:m.san,label:m.classification.label,loss:m.classification.loss,color:m.color}; }).filter(Boolean) } : {}) };
    const liveMounts = this.store.list('mounts').filter(m => m.sessionId === id && Date.now() - m.seenAt < 15000)
      .map(m => ({ mountId: m.mountId, displayedRevision: m.displayedRevision, contextRevision: m.contextRevision, contextUpdateId: m.contextUpdateId }));
    return { ...s, fen: chess.fen(), initialFen, moveHistory, totalPlies: history.length, playedMoves: history.slice(0, hidden ? s.selectedPly : history.length).map(m => m.san),
      playerColor: game.playerColor, sideToMove: chess.turn() === 'w' ? 'white' : 'black',
      sourceLabel: game.sourceLabel, game: { white: game.white, black: game.black, timeClass: game.timeClass, timeControl: game.timeControl },
      legalMoves: chess.moves({ verbose: true }).map(m => ({ san: m.san, from: m.from, to: m.to, promotion: m.promotion })),
      analysis, retry, learning: !hidden && this.learning ? { savedMistakes:this.learning.savedMistakes().slice(0,8),progress:this.learning.progress() } : undefined,
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
  select(args) { return this.mutate(args, s => { const game=this.store.getGame(args.gameId);if (!game) throw new Error('Game not found');replay(game,0);return {...s,gameId:args.gameId,selectedPly:0,variation:[],retryId:undefined}; }); }
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
