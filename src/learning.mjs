import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { ENGINE_PROFILE, replayPosition } from './engine.mjs';
import { SCORING_VERSION, retryAccepted } from './scoring.mjs';

const uci = move => move.from + move.to + (move.promotion || '');
const playerColor = game => game.playerColor === 'black' ? 'b' : 'w';
const usable = e => e?.ready === true && e.exact === true && !e.bound && e.canonicalEligible !== false && e.profileId === ENGINE_PROFILE.id;
const winner = e => !Number.isFinite(e?.mate) ? null : e.mate === 0 ? e.winner : e.mate > 0 ? 'w' : 'b';
const identity = analysis => `${analysis.analysisKey}|${analysis.completedAt}`;
function gameLine(game) {
  const full = new Chess(); full.loadPgn(game.pgn);
  return { initialFen: full.header().FEN || new Chess().fen(), moves: full.history({ verbose: true }).map(uci) };
}
function validSession(store, sessionId, expectedRevision) {
  const session = store.get('sessions', sessionId);
  if (!session || session.closed) throw new Error('Review session expired or disconnected');
  if (expectedRevision !== undefined && session.revision !== expectedRevision) throw new Error('Stale session revision. Read current context.');
  return session;
}
function explicitRevision(revision) {
  if (!Number.isInteger(revision) || revision < 1) throw new Error('An explicit positive session revision is required');
}
function canonical(store, gameId) {
  const analysis = store.get('analyses', gameId);
  if (analysis?.readiness !== 'ready' || analysis.profile?.version !== SCORING_VERSION || analysis.profile?.engineId !== ENGINE_PROFILE.id) throw new Error('Complete canonical analysis is required for retry');
  return analysis;
}
function publicRetry(record) {
  const attempts = record.attempts.map(({ engineLease, ownerPid, deadline, ...attempt }) => attempt);
  const exposed = record.revealed || record.attempts.length > 0;
  return {
    retryId: record.retryId, sessionId: record.sessionId, gameId: record.gameId,
    ply: record.ply, attemptRevision: record.attemptRevision, positionFen: record.positionFen,
    scoringVersion: record.scoringVersion, requiredOutcome: record.requiredOutcome,
    hintsUsed: record.hintsUsed, hintLevel: record.hintLevel, answerPreviouslyShown: record.answerPreviouslyShown,
    answerExposed: exposed, attempts, firstAttempt: attempts[0] || null,
    ...(exposed ? { checkedAnswer: record.checkedAnswer, originalClassification: record.originalClassification } : {}),
    ...(record.hintLevel > 0 ? { hint: record.hint } : {}),
  };
}
const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function material(chess, color) {
  return chess.board().flat().filter(Boolean).reduce((sum, piece) => sum + values[piece.type] * (piece.color === color ? 1 : -1), 0);
}
function motifs(game, move) {
  const result = [], color = playerColor(game);
  if (winner(move.before) === color && winner(move.after) !== color) result.push({ kind: 'missed_mate', cue: 'A checked mating continuation was available.', line: move.before.pv || [] });
  if (winner(move.before) !== (color === 'w' ? 'b' : 'w') && winner(move.after) === (color === 'w' ? 'b' : 'w')) result.push({ kind: 'allowing_mate', cue: 'The checked opponent response leads to mate.', line: move.after.pv || [] });
  try {
    const { initialFen, moves } = gameLine(game);
    const before = replayPosition(initialFen, moves.slice(0, move.ply - 1));
    const after = replayPosition(initialFen, moves.slice(0, move.ply));
    const checked = (move.after.pv || []).slice(0, 2);
    for (const reply of checked) after.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
    const concession = material(before, color) - material(after, color);
    if (checked.length && concession >= 2) result.push({ kind: 'material_concession', cue: 'Material is conceded in the checked response.', materialPoints: concession, line: checked, resultingFen: after.fen() });
  } catch { /* Incomplete checked lines cannot support a material motif. */ }
  return result;
}

export class Learning {
  constructor(store, engine) { this.store = store; this.engine = engine; this.recoverInterrupted(); }
  recoverInterrupted() {
    this.store.transaction(() => {
      for (const record of this.store.list('retries')) {
        let changed = false;
        const attempts = record.attempts.map(attempt => {
          if (attempt.status !== 'pending') return attempt;
          let alive = true;
          try { process.kill(attempt.ownerPid, 0); } catch { alive = false; }
          if (alive && attempt.deadline > this.store.now()) return attempt;
          changed = true;
          this.store.releaseLease(`retry:${record.retryId}`, attempt.engineLease);
          return { ...attempt, status: 'interrupted', error: 'The engine check ended without a completed result.' };
        });
        if (!changed) continue;
        this.store.set('retries', record.retryId, { ...record, attempts, attemptRevision: record.attemptRevision + 1 });
        const session = this.store.get('sessions', record.sessionId);
        if (session?.retryId === record.retryId && !session.closed) this.store.set('sessions', session.sessionId, { ...session, revision: session.revision + 1 });
      }
    });
  }
  get({ sessionId, retryId }) {
    const session = validSession(this.store, sessionId);
    const record = this.store.get('retries', retryId);
    if (!record || record.sessionId !== sessionId || record.gameId !== session.gameId) throw new Error('Retry does not belong to this review session');
    return publicRetry(record);
  }
  start({ sessionId, expectedRevision, ply, answerPreviouslyShown = false, requiredOutcome } = {}) {
    explicitRevision(expectedRevision);
    return this.store.transaction(() => {
      const session = validSession(this.store, sessionId, expectedRevision);
      const game = this.store.getGame(session.gameId), analysis = canonical(this.store, session.gameId);
      const move = analysis.moves.find(item => item.ply === ply);
      if (!Number.isInteger(ply) || ply < 1 || !move || move.color !== playerColor(game) || !move.classification?.ready || !usable(move.before)) throw new Error('Choose an analyzed player move for retry');
      const { initialFen, moves } = gameLine(game), prefix = moves.slice(0, ply - 1);
      const position = replayPosition(initialFen, prefix);
      if (position.turn() !== move.color || !position.moves().length) throw new Error('The retry position has no player decision');
      requiredOutcome ??= winner(move.before) === move.color ? 'mate' : undefined;
      if (requiredOutcome && !['mate', 'draw'].includes(requiredOutcome)) throw new Error('Unknown retry outcome');
      if (requiredOutcome === 'mate' && winner(move.before) !== move.color) throw new Error('A winning mate must be verified before requiring it');
      if (requiredOutcome === 'draw' && !['draw', 'repetition'].includes(move.before.terminal) && move.before.verifiedOutcome !== 'draw') throw new Error('A zero evaluation alone does not verify a drawing defense');
      const retryId = randomUUID(), record = {
        retryId, sessionId, gameId: game.id, ply, color: move.color, attemptRevision: 1,
        initialFen, moves: prefix, positionFen: position.fen(), reference: move.before,
        analysisIdentity: identity(analysis), scoringVersion: SCORING_VERSION, requiredOutcome,
        checkedAnswer: { move: move.before.bestMove, line: move.before.pv || [], evidence: move.before },
        originalClassification: move.classification, attempts: [], hintsUsed: 0, hintLevel: 0,
        answerPreviouslyShown: Boolean(answerPreviouslyShown), revealed: false, createdAt: this.store.now(),
      };
      this.store.set('retries', retryId, record);
      const nextSession = { ...session, selectedPly: ply - 1, variation: [], retryId, revision: session.revision + 1 };
      this.store.set('sessions', sessionId, nextSession);
      return { retry: publicRetry(record), sessionRevision: nextSession.revision };
    });
  }
  guardedRecord(args) {
    explicitRevision(args.expectedRevision);
    const session = validSession(this.store, args.sessionId, args.expectedRevision);
    const record = this.store.get('retries', args.retryId);
    if (!record || record.sessionId !== args.sessionId || record.gameId !== session.gameId || session.retryId !== args.retryId) throw new Error('Retry is not active in this review session');
    if (record.attemptRevision !== args.attemptRevision) throw new Error('Stale retry revision. Read current retry.');
    if (identity(canonical(this.store, session.gameId)) !== record.analysisIdentity) throw new Error('Canonical analysis changed. Start a new retry.');
    return { session, record };
  }
  commit(args, mutate) {
    return this.store.transaction(() => {
      const { session, record } = this.guardedRecord(args);
      const next = { ...mutate(record), attemptRevision: record.attemptRevision + 1 };
      this.store.set('retries', record.retryId, next);
      this.store.set('sessions', session.sessionId, { ...session, revision: session.revision + 1 });
      return { retry: publicRetry(next), sessionRevision: session.revision + 1 };
    });
  }
  hint(args) {
    return this.commit(args, record => {
      const position = replayPosition(record.initialFen, record.moves);
      const best = record.checkedAnswer.move;
      const piece = best ? position.get(best.slice(0, 2)) : null;
      const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
      const reveal = record.hintLevel >= 1;
      return { ...record, hintsUsed: record.hintsUsed + 1, hintLevel: record.hintLevel + 1, revealed: record.revealed || reveal,
        hint: reveal ? 'Checked answer revealed.' : piece ? `Look for a move by the ${names[piece.type]} on ${best.slice(0, 2)}.` : 'Check the opponent’s immediate threats and your forcing moves.' };
    });
  }
  reveal(args) { return this.commit(args, record => ({ ...record, hintsUsed: record.hintsUsed + 1, hintLevel: Math.max(2, record.hintLevel), revealed: true, hint: 'Checked answer revealed.' })); }
  async attempt(args) {
    this.recoverInterrupted();
    const { record } = this.guardedRecord(args);
    const position = replayPosition(record.initialFen, record.moves);
    const played = position.move(args.move), candidate = uci(played);
    const leaseDuration = (this.engine.timeoutMs || 30000) + 5000;
    let engineLease;
    const reserved = this.commit(args, current => {
      if (current.attempts.some(attempt => attempt.status === 'pending')) throw new Error('A retry check is still running');
      engineLease = this.store.acquireLease(`retry:${record.retryId}`, leaseDuration);
      if (!engineLease) throw new Error('A retry check is still running');
      return { ...current, attempts: [...current.attempts, {
        attempt: current.attempts.length + 1, san: played.san, uci: candidate, ready: false, accepted: null, status: 'pending',
        assisted: current.hintsUsed > 0 || current.answerPreviouslyShown || current.revealed || current.attempts.length > 0,
        hintsUsed: current.hintsUsed, answerPreviouslyShown: current.answerPreviouslyShown || current.revealed || current.attempts.length > 0,
        engineLease, ownerPid: process.pid, deadline: this.store.now() + leaseDuration, attemptedAt: this.store.now(),
      }] };
    });
    const completionGuard = { ...args, expectedRevision: reserved.sessionRevision, attemptRevision: reserved.retry.attemptRevision };
    let evidence, outcome, failure;
    try {
      evidence = await this.engine.analyze({ initialFen: record.initialFen, moves: [...record.moves, candidate], profile: record.reference.profile });
      if (!usable(evidence) || evidence.profile !== record.reference.profile) throw new Error('Retry analysis is not ready under the canonical profile');
      outcome = retryAccepted({ reference: record.reference, attempt: evidence, color: record.color, requiredOutcome: record.requiredOutcome });
      if (!outcome.ready) throw new Error('Retry analysis is incomplete');
    } catch (error) { failure = error.message; }
    try {
      return this.commit(completionGuard, current => ({ ...current, attempts: current.attempts.map(attempt => attempt.engineLease !== engineLease ? attempt : {
        ...attempt, ...(failure ? { status: 'interrupted', error: failure } : { ...outcome, status: 'complete', evidence }),
      }) }));
    } catch (error) {
      // The checked result cannot address a newer position. Preserve the actual submitted move and assistance metadata.
      this.store.update('retries', record.retryId, current => ({ ...current, attemptRevision: current.attemptRevision + 1,
        attempts: current.attempts.map(attempt => attempt.engineLease === engineLease && attempt.status === 'pending'
          ? { ...attempt, status: 'interrupted', error: 'The review changed before this check completed.' } : attempt),
      }));
      throw error;
    } finally { this.store.releaseLease(`retry:${record.retryId}`, engineLease); }
  }
  ownedGames(username = this.store.get('settings', 'username')) {
    if (!username) return [];
    const name = username.toLowerCase();
    return this.store.listGames().filter(game => !game.fixture && !/fixture|public verification/i.test(game.sourceLabel || '')
      && game.importedFor?.toLowerCase() === name && game[game.playerColor]?.username?.toLowerCase() === name);
  }
  savedMistakes({ username } = {}) {
    const result = [];
    for (const game of this.ownedGames(username)) {
      let analysis; try { analysis = canonical(this.store, game.id); } catch { continue; }
      for (const move of analysis.moves) {
        if (move.color !== playerColor(game) || !move.classification?.ready || (!Number.isFinite(move.classification.loss) || move.classification.loss < 10) || !usable(move.before) || !usable(move.after)) continue;
        result.push({ gameId: game.id, ply: move.ply, endTime: game.endTime, timeClass: game.timeClass, timeControl: game.timeControl,
          classification: move.classification, motifs: motifs(game, move), scoringVersion: SCORING_VERSION });
      }
    }
    return result.sort((a, b) => b.endTime - a.endTime || a.ply - b.ply);
  }
  progress({ username } = {}) {
    const groups = new Map();
    for (const game of this.ownedGames(username)) {
      let analysis; try { analysis = canonical(this.store, game.id); } catch { continue; }
      const accuracy = analysis.accuracy?.[playerColor(game)];
      if (!Number.isFinite(accuracy)) continue;
      const key = `${game.timeClass}|${game.timeControl}`;
      const group = groups.get(key) || { timeClass: game.timeClass, timeControl: game.timeControl, sampleCount: 0, moveOpportunities: 0, mistakeCount: 0, accuracyTotal: 0, gameIds: [] };
      const moves = analysis.moves.filter(move => move.color === playerColor(game) && move.classification?.ready);
      group.sampleCount++; group.accuracyTotal += accuracy; group.gameIds.push(game.id);
      group.moveOpportunities += moves.length; group.mistakeCount += moves.filter(move => move.classification.loss >= 10).length;
      groups.set(key, group);
    }
    return { scoringVersion: SCORING_VERSION, engineProfileId: ENGINE_PROFILE.id, groups: [...groups.values()].map(({ accuracyTotal, ...group }) => ({ ...group, averageAccuracy: accuracyTotal / group.sampleCount,
      evidenceStatus: group.sampleCount < 5 ? 'insufficient_history' : 'descriptive_history',
      statement: `${group.sampleCount} reviewed ${group.timeClass} game${group.sampleCount === 1 ? '' : 's'} at ${group.timeControl}; ${group.mistakeCount} mistakes across ${group.moveOpportunities} player moves.`,
    })), retry: { attempts: this.store.list('retries').filter(record => this.ownedGames(username).some(game => game.id === record.gameId)).flatMap(record => record.attempts).length }, improvementClaim: null };
  }
}
