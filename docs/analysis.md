# Canonical analysis service

`src/analysis.mjs` exports `Analysis({store, engine, leaseMs, pollMs, waitMs})`. `store` is the existing canonical SQLite Store; `engine` defaults to the pinned local Stockfish adapter. No model service or new dependency is involved.

- `start(gameId)` synchronously persists pending readiness and queues work, returning compact status. It never waits for an engine search.
- Opening or selecting a previously unanalyzed game starts analysis automatically. Reopening a failed or interrupted job preserves its error and requires explicit Resume. Ready scores are reused.
- `status(gameId)` returns game/analysis identity, frozen profile, readiness, exact canonical position count, total position count, retryable error, update/completion times, and accuracy only after completion.
- `await run(gameId, {signal})` awaits the serialized job, returning its persisted ready, failed, or interrupted record. A second process waits for the renewable lease and reuses the first process's finished result. Waiting is bounded; a queued game reports a recoverable busy error rather than staying pending indefinitely. A game actually being analyzed by another process continues to report that owner's status.

The single active canonical record is `Store.get('analyses', gameId)`. Its `analysisKey` combines game ID, `independent-lichess-v1`, and the pinned engine profile. `pgnHash` binds it to the untouched original PGN. Work is stored separately under `analysis-work` using that composite key; exact engine cache identity includes engine profile, initial FEN, complete UCI history, node-budget profile, and the entire constrained root pool. A new PGN invalidates the work cache. No downloaded model credentials or private inference keys are stored.

Ready record shape:

```js
{
  gameId, analysisKey, pgnHash,
  profile: { version, engineId, engine, canonicalBudget: 'refinement', canonicalNodes: 400000 },
  readiness: 'ready', completedPositions, totalPositions,
  phase: 'complete', currentMove: null, totalMoves,
  accuracy: { w, b }, playerAccuracy, playerColor: 'w' | 'b',
  positions, // initial assessment at index 0, then each played ply; uniformly refinement
  ordinaryPositions, // separately retained 100k evidence
  moves: [{
    ply, color, san, uci, before, after, best,
    ordinaryBefore, ordinaryAfter,
    classification: { ready, ordinaryGrade, label, loss, beforeW, afterW, accuracy, scoringVersion },
    special
  }],
  keyMoments: [/* 1-based player move plies */],
  startedAt, updatedAt, completedAt, error: null, recoverable: false
}
```

Position assessments preserve complete legal UCI history, white-oriented evaluation, mate winner when terminal, exact/bound state, selected completed iteration, searched nodes, and profile. The PGN's SetUp/FEN headers determine the initial position and starting color. Lichess aggregation uses its fixed initial +15 cp for standard-start games; custom-FEN games use their actual finalized initial assessment.

Canonical move pairs and aggregate inputs uniformly use 400,000-node refinement evidence. Ordinary 100,000-node results only verify stability and special labels. The same-profile cache prevents the special-evidence collector from repeating already-completed root searches. Ordinary evaluation gates conservatively skip expensive special searches that cannot qualify; an unverified special label never replaces a supported ordinary grade. Retry tools must assess attempts against the same refinement budget as their canonical reference.

One renewable cross-process lease bounds active canonical analysis to one game across host-managed stdio processes. That owner computes at most two positions concurrently with independent fresh engine processes; each position retains the same ordinary/refinement budgets and cache identity. Both workers settle before failure publication or lease release, preventing late writes from a failed job. Async engine work never runs inside a SQLite transaction. Every result/cache commit checks lease ownership and original PGN identity; a lost owner cannot publish final scores. Pending/analyzing records retain owner PID, instance identity, and the acquired lease token. Constructor/status recovery detects a dead queued owner or expired/mismatched engine lease, atomically marks the record interrupted, and bumps affected session revisions without losing cached evidence. It releases only the recorded dead/expired owner's matching token, preserving another live process's lease. Recovery exposes explicit Resume; polling never restarts an engine job or migrates historical scores. Pending, failed, or interrupted records contain no final aggregate or classifications.

Progress distinguishes `phase: 'positions'` from `phase: 'moves'`. The latter publishes the 1-based played ply in `currentMove` while classifying moves and checking special evidence. Completing the position searches does not present the remaining classification work as a stuck full progress bar. `totalMoves` is the played ply count; ready uses phase `complete` and clears `currentMove`.

Progress and final records commit atomically with a revision increment for every nonclosed session on that game. The transaction reads the latest sessions, preserving their selected ply and variation. Sessions on other games are untouched. Existing display/context acknowledgements become stale because their revision no longer matches; final analysis does not claim the board displayed it or the model consumed it.

`node --test tests/analysis.test.mjs` includes actual pinned-engine Fool's mate analysis, standard/custom initial alignment, pending startup, same-profile restart reuse, interrupted cache recovery, two independent Store/Analysis instances sharing one job, expired lease recovery, bounded busy failure, and navigation/variation preservation with stale acknowledgements.
