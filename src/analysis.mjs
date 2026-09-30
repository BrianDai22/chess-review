import { createHash, randomUUID } from 'node:crypto';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { Engine, ENGINE_PROFILE, replayPosition } from './engine.mjs';
import { SCORING_VERSION, gameAccuracy, scoreMove, winPercent } from './scoring.mjs';
import { collectSpecialEvidence } from './special-evidence.mjs';

const exact = e => e?.ready === true && e.exact === true && !e.bound && e.canonicalEligible !== false;
const hash = text => createHash('sha256').update(text).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = Object.freeze({ version: SCORING_VERSION, engineId: ENGINE_PROFILE.id, engine: ENGINE_PROFILE,
  canonicalBudget: 'refinement', canonicalNodes: ENGINE_PROFILE.refinementNodes });
const uci = move => move.from + move.to + (move.promotion || '');
const pidAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
};

function gameInput(store, gameId) {
  const game = store.getGame(gameId);
  if (!game?.pgn) throw new Error('Game not found or PGN missing');
  const chess = new Chess(); chess.loadPgn(game.pgn);
  const history = chess.history({ verbose: true });
  if (!history.length) throw new Error('Completed game has no supported played moves');
  const initialFen = chess.header().FEN || DEFAULT_POSITION;
  return { game, history, initialFen, moves: history.map(uci), pgnHash: hash(game.pgn),
    analysisKey: `${gameId}:${SCORING_VERSION}:${ENGINE_PROFILE.id}`, totalPositions: history.length + 1 };
}
function cacheKey(initialFen, moves, budget, searchMoves = []) {
  return hash(JSON.stringify([ENGINE_PROFILE.id, initialFen, moves, budget, [...searchMoves].sort()]));
}

/** One frozen result, durable resumable evidence, and one engine job across stdio processes. */
export class Analysis {
  constructor({ store, engine = new Engine(), leaseMs = 120_000, pollMs = 100, waitMs = 120_000 } = {}) {
    if (!store) throw new Error('Analysis requires the canonical Store');
    this.store = store; this.engine = engine; this.leaseMs = leaseMs; this.pollMs = pollMs; this.waitMs = waitMs;
    this.jobs = new Map(); this.queue = Promise.resolve();
    this.ownerId = randomUUID(); this.activeToken = null;
    this.leaseKey = `analysis-engine:${ENGINE_PROFILE.id}`;
    // Crash recovery changes readiness, but never silently restarts analysis.
    for (const record of this.store.list('analyses')) {
      if (['pending','analyzing'].includes(record.readiness) && record.profile?.version === SCORING_VERSION && record.profile?.engineId === ENGINE_PROFILE.id) {
        try { this.recover(gameInput(this.store,record.gameId)); } catch { /* Invalid or removed games require an explicit repair. */ }
      }
    }
  }
  recover(input) {
    return this.store.transaction(() => {
      const record = this.store.get('analyses',input.game.id);
      if (!record || !['pending','analyzing'].includes(record.readiness) || record.analysisKey !== input.analysisKey) return record;
      const lease = this.store.db.prepare('SELECT token,expires_at FROM leases WHERE key=?').get(this.leaseKey);
      const deadOwner = record.ownerPid ? !pidAlive(record.ownerPid) : false;
      const legacyOrphan = !record.ownerPid && (!lease || lease.expires_at <= this.store.now());
      const invalidLease = record.readiness === 'analyzing' && (record.leaseToken
        ? !lease || lease.token !== record.leaseToken || lease.expires_at <= this.store.now()
        : !lease || lease.expires_at <= this.store.now());
      if (!deadOwner && !invalidLease && !legacyOrphan) return record;
      if (record.leaseToken && lease?.token === record.leaseToken && (deadOwner || lease.expires_at <= this.store.now())) this.store.releaseLease(this.leaseKey,record.leaseToken);
      return this.publish(input,{readiness:'interrupted',completedPositions:record.completedPositions || 0,totalPositions:input.totalPositions,
        error:'Previous analysis process ended or its lease expired. Resume analysis.',recoverable:true});
    });
  }
  status(gameId) {
    const input = gameInput(this.store, gameId), record = this.recover(input);
    const current = record?.analysisKey === input.analysisKey && record.pgnHash === input.pgnHash ? record : null;
    return { gameId, analysisKey: input.analysisKey, profile, readiness: current?.readiness || 'pending',
      completedPositions: current?.completedPositions || 0, totalPositions: input.totalPositions,
      error: current?.error || null, recoverable: current?.recoverable || false,
      accuracy: current?.readiness === 'ready' ? current.accuracy : null,
      playerAccuracy: current?.readiness === 'ready' ? current.playerAccuracy : null,
      updatedAt: current?.updatedAt || null, completedAt: current?.completedAt || null };
  }
  start(gameId) {
    const current = this.status(gameId);
    if (current.readiness === 'ready') return current;
    void this.run(gameId).catch(() => {});
    return this.status(gameId);
  }
  run(gameId, { signal } = {}) {
    const input = gameInput(this.store, gameId);
    const existing = this.recover(input);
    if (existing?.readiness === 'ready' && existing.analysisKey === input.analysisKey && existing.pgnHash === input.pgnHash) return Promise.resolve(existing);
    if (this.jobs.has(input.analysisKey)) return this.jobs.get(input.analysisKey);
    if (!existing || existing.analysisKey !== input.analysisKey || !['pending','analyzing'].includes(existing.readiness)) this.publish(input,
      {readiness:'pending',completedPositions:existing?.completedPositions || 0,totalPositions:input.totalPositions,error:null});
    const job = this.queue.then(() => this.perform(input, signal));
    this.queue = job.catch(() => {});
    this.jobs.set(input.analysisKey, job);
    job.finally(() => { if (this.jobs.get(input.analysisKey) === job) this.jobs.delete(input.analysisKey); }).catch(() => {});
    return job;
  }
  publish(input, record, assertOwnership = () => {}) {
    return this.store.transaction(() => {
      assertOwnership();
      const previous = this.store.get('analyses', input.game.id);
      const next = { gameId: input.game.id, analysisKey: input.analysisKey, pgnHash: input.pgnHash, profile,
        ownerPid:['pending','analyzing'].includes(record.readiness) ? process.pid : null,
        ownerId:['pending','analyzing'].includes(record.readiness) ? this.ownerId : null,
        leaseToken:record.readiness === 'analyzing' ? this.activeToken : null,
        startedAt: previous?.analysisKey === input.analysisKey ? previous.startedAt || this.store.now() : this.store.now(),
        ...record, updatedAt: this.store.now() };
      this.store.set('analyses', input.game.id, next);
      for (const session of this.store.list('sessions')) {
        if (session.gameId === input.game.id && !session.closed) this.store.set('sessions', session.sessionId, { ...session, revision: session.revision + 1 });
      }
      return next;
    });
  }
  async perform(input, signal) {
    let token = null, heartbeat = null, ownershipLost = false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const assertOwnership = () => {
      if (ownershipLost || !this.store.renewLease(this.leaseKey, token, this.leaseMs)) {
        ownershipLost = true; controller.abort(); throw new Error('Analysis lease lost; another process can recover this job');
      }
      if (controller.signal.aborted) throw new Error('Analysis interrupted');
      if (hash(this.store.getGame(input.game.id)?.pgn || '') !== input.pgnHash) throw new Error('Original PGN changed while analysis was running; start the current game again');
    };
    try {
      const deadline = performance.now() + this.waitMs;
      while (!token) {
        if (controller.signal.aborted) throw new Error('Analysis interrupted');
        const completed = this.store.get('analyses', input.game.id);
        if (completed?.readiness === 'ready' && completed.analysisKey === input.analysisKey && completed.pgnHash === input.pgnHash) return completed;
        token = this.store.acquireLease(this.leaseKey, this.leaseMs);
        if (!token && performance.now() >= deadline) return this.store.transaction(() => {
          const current = this.store.get('analyses',input.game.id);
          if (current?.readiness === 'analyzing' || (current?.ownerId !== this.ownerId && pidAlive(current?.ownerPid))) return this.status(input.game.id);
          return this.publish(input, { readiness: 'failed', completedPositions: this.status(input.game.id).completedPositions,
            totalPositions: input.totalPositions, error: 'Engine is busy in another process. Start analysis again.', recoverable: true });
        });
        if (!token) await sleep(this.pollMs);
      }
      this.activeToken = token;
      heartbeat = setInterval(() => {
        try { if (!this.store.renewLease(this.leaseKey, token, this.leaseMs)) { ownershipLost = true; controller.abort(); } }
        catch { ownershipLost = true; controller.abort(); }
      }, Math.max(5, Math.min(5000, Math.floor(this.leaseMs / 3))));
      const completed = this.store.get('analyses', input.game.id);
      if (completed?.readiness === 'ready' && completed.analysisKey === input.analysisKey && completed.pgnHash === input.pgnHash) return completed;
      let work = this.store.get('analysis-work', input.analysisKey);
      if (!work || work.pgnHash !== input.pgnHash) work = { gameId: input.game.id, analysisKey: input.analysisKey, pgnHash: input.pgnHash, cache: {} };
      const progress = () => Array.from({ length: input.totalPositions }, (_, ply) => work.cache[cacheKey(input.initialFen, input.moves.slice(0, ply), 'refinement')]).filter(exact).length;
      this.publish(input, { readiness: 'analyzing', completedPositions: progress(), totalPositions: input.totalPositions, error: null }, assertOwnership);
      const cachedEngine = { analyze: async request => {
        assertOwnership();
        const { initialFen = DEFAULT_POSITION, moves = [], profile: budget = 'ordinary', searchMoves = [] } = request;
        const key = cacheKey(initialFen, moves, budget, searchMoves), cached = work.cache[key];
        if (exact(cached) && cached.profileId === ENGINE_PROFILE.id && cached.profile === budget) return cached;
        const evidence = await this.engine.analyze({ ...request, signal: controller.signal });
        this.store.transaction(() => {
          assertOwnership();
          work.cache[key] = evidence; work.updatedAt = this.store.now();
          this.store.set('analysis-work', input.analysisKey, work);
          const current = this.store.get('analyses', input.game.id), count = progress();
          if (current.completedPositions !== count) this.publish(input, { readiness: 'analyzing', completedPositions: count, totalPositions: input.totalPositions, error: null }, assertOwnership);
        });
        return evidence;
      } };
      const ordinaryPositions = [], positions = [];
      for (let ply = 0; ply < input.totalPositions; ply++) {
        const moves = input.moves.slice(0, ply);
        ordinaryPositions.push(await cachedEngine.analyze({ initialFen: input.initialFen, moves, profile: 'ordinary' }));
        const refinement = await cachedEngine.analyze({ initialFen: input.initialFen, moves, profile: 'refinement' });
        positions.push(refinement);
        if (!exact(refinement) || refinement.profileId !== ENGINE_PROFILE.id) throw new Error(`Position at ply ${ply} lacks exact canonical refinement evidence`);
      }
      const assessedMoves = [];
      for (let i = 0; i < input.history.length; i++) {
        const played = input.history[i], before = positions[i], after = positions[i + 1], ordinaryBefore = ordinaryPositions[i], ordinaryAfter = ordinaryPositions[i + 1];
        const beforeW = winPercent(ordinaryBefore, played.color);
        const afterW = winPercent(ordinaryAfter, played.color);
        const eligibleSpecial = exact(ordinaryBefore) && exact(ordinaryAfter) &&
          ((Math.max(0, beforeW - afterW) < 2 && afterW >= 45) || (beforeW >= 75 && afterW <= 60 && beforeW - afterW >= 15));
        const special = eligibleSpecial ? await collectSpecialEvidence({ engine: cachedEngine, initialFen: input.initialFen,
          moves: input.moves.slice(0, i), playedMove: input.moves[i], color: played.color, before: ordinaryBefore, after: ordinaryAfter, signal: controller.signal }) : { ordinary: {}, refinement: {} };
        const legalMoveCount = replayPosition(input.initialFen, input.moves.slice(0, i)).moves().length;
        const classification = scoreMove({ before, after, best: before, playedMove: input.moves[i], color: played.color,
          bestStable: exact(ordinaryBefore) && ordinaryBefore.bestMove === before.bestMove, legalMoveCount, special });
        if (!classification.ready) throw new Error(`Move at ply ${i + 1} has incomplete canonical scoring evidence`);
        assessedMoves.push({ ply: i + 1, color: played.color, san: played.san, uci: input.moves[i], before, after, best: before,
          ordinaryBefore, ordinaryAfter, classification, special });
      }
      const accuracy = gameAccuracy(positions.slice(1), { startColor: replayPosition(input.initialFen).turn(),
        ...(input.initialFen === DEFAULT_POSITION ? {} : { initial: positions[0] }) });
      if (!accuracy || Object.values(accuracy).some(value => value !== null && !Number.isFinite(value))) throw new Error('Canonical game accuracy is incomplete');
      const color = input.game.playerColor === 'black' || input.game.playerColor === 'b' ? 'b' : 'w';
      return this.publish(input, { readiness: 'ready', completedPositions: input.totalPositions, totalPositions: input.totalPositions,
        accuracy, playerAccuracy: accuracy[color], playerColor: color, positions, ordinaryPositions, moves: assessedMoves,
        keyMoments: assessedMoves.filter(move => move.color === color && ['Inaccuracy','Mistake','Blunder','Miss','Great','Brilliant'].includes(move.classification.label)).map(move => move.ply),
        completedAt: this.store.now(), error: null, recoverable: false }, assertOwnership);
    } catch (error) {
      if (ownershipLost) return this.status(input.game.id);
      if (!token) return this.store.transaction(() => {
        const current = this.store.get('analyses',input.game.id);
        if (['analyzing','ready'].includes(current?.readiness) || (current?.ownerId !== this.ownerId && pidAlive(current?.ownerPid))) return this.status(input.game.id);
        return this.publish(input, { readiness: controller.signal.aborted ? 'interrupted' : 'failed',
          completedPositions: this.status(input.game.id).completedPositions, totalPositions: input.totalPositions,
          error: error.message, recoverable: true });
      });
      const work = this.store.get('analysis-work', input.analysisKey), completedPositions = this.status(input.game.id).completedPositions;
      if (work) this.store.set('analysis-work', input.analysisKey, { ...work, error: error.message, updatedAt: this.store.now() });
      return this.publish(input, { readiness: controller.signal.aborted ? 'interrupted' : 'failed', completedPositions,
        totalPositions: input.totalPositions, error: error.message, recoverable: true }, () => {
        if (!this.store.renewLease(this.leaseKey, token, this.leaseMs)) throw new Error('Analysis owner changed before error publication');
      });
    } finally {
      clearInterval(heartbeat); signal?.removeEventListener('abort', abort);
      if (token) this.store.releaseLease(this.leaseKey, token);
      if (this.activeToken === token) this.activeToken = null;
    }
  }
}
