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
  constructor(store) { this.store = store; }
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
    const s = requireSession(this.store, id), game = this.store.getGame(s.gameId);
    const { chess, history, initialFen } = replay(game, s.selectedPly);
    const moveHistory = chess.history();
    for (const move of s.variation) { chess.move(move); moveHistory.push(move); }
    const analysis = this.store.get('analyses', s.gameId) || { readiness: 'pending' };
    const liveMounts = this.store.list('mounts').filter(m => m.sessionId === id && Date.now() - m.seenAt < 15000)
      .map(m => ({ mountId: m.mountId, displayedRevision: m.displayedRevision, contextRevision: m.contextRevision, contextUpdateId: m.contextUpdateId }));
    return { ...s, fen: chess.fen(), initialFen, moveHistory, totalPlies: history.length, playedMoves: history.map(m => m.san),
      playerColor: game.playerColor, sideToMove: chess.turn() === 'w' ? 'white' : 'black',
      sourceLabel: game.sourceLabel, game: { white: game.white, black: game.black, timeClass: game.timeClass, timeControl: game.timeControl },
      legalMoves: chess.moves({ verbose: true }).map(m => ({ san: m.san, from: m.from, to: m.to, promotion: m.promotion })),
      analysis, scoringVersion: analysis.profile?.version || 'pending',
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
  go(args) { return this.mutate(args, s => { replay(this.store.getGame(s.gameId), args.ply); return { ...s, selectedPly: args.ply, variation: [] }; }); }
  variation(args) {
    return this.mutate(args, s => {
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
