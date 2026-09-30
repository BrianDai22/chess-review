# Retry and grounded learning history

`src/learning.mjs` supplies the local learning service. It reads the same complete canonical analyses used for scores; it never changes the original PGN, accuracy, or move classifications.

## Service contract

```js
const learning = new Learning(store, engine);
learning.start({ sessionId, expectedRevision, ply, answerPreviouslyShown: false });
learning.get({ sessionId, retryId });
learning.hint({ sessionId, expectedRevision, retryId, attemptRevision });
learning.reveal({ sessionId, expectedRevision, retryId, attemptRevision });
await learning.attempt({ sessionId, expectedRevision, retryId, attemptRevision, move: 'Nf3' });
learning.savedMistakes();
learning.progress();
```

`ply` is the one-based played halfmove being retried, not the displayed pre-move position. Start accepts only an analyzed move by the imported player. It selects `ply - 1`, clears the explored variation, binds `session.retryId`, and increments the session revision atomically. Each successful mutation returns `{retry, sessionRevision}`. Read requires the explicit owning review session; mutation requires both the expected session revision and expected `attemptRevision`.

A retry has its own durable ID, revisions, selected pre-decision FEN, required outcome, hint count, and immutable first-submission metadata. Its public state omits the checked answer and original classification until an actual legal submission or an explicit reveal. The first hint provides only the checked best move's piece and origin square. A second hint reveals the checked answer and counts assistance. Native chat and the board adapter must mask full analysis evidence and future played moves while `retry.answerExposed` is false, including after the first hint. Merely sanitizing the retry object does not sanitize a separate full-game analysis field.

The adapter or coaching skill supplies `answerPreviouslyShown:true` when a checked answer was already shown or discussed. The local backend cannot independently observe explanations in native chat. First submission, later submissions, hints, and prior answer exposure are recorded separately. Later submissions count as assisted because the first submission reveals the checked answer.

## Submission, engine evidence, and interruptions

A legal SAN or UCI submission is persisted **before** engine work, with `ready:false`, `accepted:null`, and `status:'pending'`. That committed reservation increments both revisions. Illegal or already-stale submissions create no attempt. A SQLite lease prevents concurrent checks of the same retry.

The engine checks the candidate using its full position history and the reference's canonical profile. V1 complete-game references use the fixed refinement budget of 400,000 nodes; retry uses that same budget. Exploratory budgets, incompatible engine identity, incomplete results, bound-only evidence, and changed canonical analyses cannot assign an outcome. The engine's documented completed-exact-iteration policy also applies here.

Acceptance uses the backend's `retryAccepted`: loss below two evaluation-proxy points, plus any verified required mate/draw outcome. A verified winning mate must remain verified. Zero centipawns alone cannot prove a drawing defense. The service permits a draw requirement only when canonical evidence explicitly verifies it; the current engine does not manufacture a nonterminal forced-draw proof from a zero evaluation.

A matching completion records `status:'complete'`, actual acceptance, loss, and engine evidence, and increments both revisions again. An engine interruption records `status:'interrupted'` with unknown acceptance, preserving the submitted move and its original assistance state. A delayed completion after navigation, hints, or another canonical analysis does not change the newer session or attach its stale evaluation. The submitted move remains recorded as interrupted.

On service startup, pending attempts belonging to dead processes or expired check deadlines become interrupted. Restart preserves the first submission even when its process died before returning a result. Interrupted retries do not fabricate a failed or successful answer and never alter the played-game score.

The board adapter should render pending/interrupted outcomes separately from wrong moves. Normal navigation or an explicit end-retry action clears `session.retryId`; historical retry records remain saved.

## Saved mistakes and comparable history

Default history is limited to the remembered username's actual imported games, matching both `importedFor` and the player's recorded color. Fixture and public-verification games are excluded. Pending analyses and obsolete scoring/engine profiles are excluded. No supplied username means no personal history.

Saved mistakes are canonical player moves losing at least ten evaluation-proxy points. Additional motifs require checkable evidence:

- `missed_mate`: the reference verifies a winning mate that the played result no longer verifies.
- `allowing_mate`: the played move introduces a checked losing mate that the reference did not show.
- `material_concession`: the played move and the first two legal plies of the checked opponent response concede at least two material points, using P=1, N=B=3, R=5, Q=9.

These motifs describe finite checked evidence. A material concession in a short line is not a claim that every continuation loses that material. V1 does not invent positional, psychological, or strategic mistake categories.

Progress groups exact `timeClass` and `timeControl`, reporting actual game sample counts, mean canonical accuracy, mistakes, and player-move opportunities. Different controls remain separate. Fewer than five games are labeled `insufficient_history`; larger samples remain descriptive. The service makes no automatic improvement claim. Retry submissions are counted separately from real-game performance.

## Verification

`node --test tests/learning.test.mjs` covers actual pinned-engine acceptance of a similarly sound opening alternative at the matched refinement budget; actual immediate mate, terminal winner, and repetition-aware retry history; saturated evaluation losing a verified mate; explicit draw guards; illegal, stale, and foreign-session rejection; interruption and process-death recovery; first/later assistance records; two SQLite connections; original score immutability; deterministic material motifs; and exclusion of fixture, foreign, outdated, and incomparable histories.
