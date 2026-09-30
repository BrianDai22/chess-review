# Independent scoring v1

Status: frozen v1 engineering profile, September 30, 2026. Accuracy, ordinary classifications, conservative special-label predicates, source identities, and budgets have mathematical fixtures and actual pinned-engine fixtures. This is an independent scoring method, not validated Chess.com equivalence. Finite searches are evidence under this profile, not proofs of every continuation.

## Accuracy and analysis profile

Use the complete Lichess accuracy calculation, translated in `src/scoring.mjs`, with these source pins:

- [lila AccuracyPercent.scala at fbecdb9b1a81553ee254f5a41de98eeba56bf405](https://github.com/lichess-org/lila/blob/fbecdb9b1a81553ee254f5a41de98eeba56bf405/modules/analyse/src/main/AccuracyPercent.scala) and [tree evaluation conversion](https://github.com/lichess-org/lila/blob/fbecdb9b1a81553ee254f5a41de98eeba56bf405/modules/tree/src/main/eval.scala).
- [scalachess evaluation conversion at 57d3483869abde8a7dbd867520fe78f8f7e87d79](https://github.com/lichess-org/scalachess/blob/57d3483869abde8a7dbd867520fe78f8f7e87d79/core/src/main/scala/eval.scala).
- [scalalib Maths at ea1aae727b3b9bdc2f506f12d4991fe3ed8e8b44](https://github.com/lichess-org/scalalib/blob/ea1aae727b3b9bdc2f506f12d4991fe3ed8e8b44/lila/src/main/scala/Maths.scala).

White-oriented centipawns are clipped to ±1000 and converted as `100 / (1 + exp(-0.00368208 * cp))`. Mates use the corresponding ±1000 proxy and retain their actual outcome separately; mate zero requires an explicit winner. Move accuracy is 100 when the mover's proxy improves or ties. Otherwise it is `clamp(103.1668100711649 * exp(-0.04354415386753951 * d) - 3.166924740191411 + 1, 0, 100)`. The +1 is Lichess's uncertainty allowance.

Game aggregation uses white-oriented evaluation after every ply plus an initial evaluation, with Lichess's default initial +15 cp unless the game supplies a checked initial assessment. Window size is integer `clamp(plyCount / 10, 2, 8)`. The first window is repeated `windowSize - 2` times, then full overlapping windows are used so each move has one weight. Weights are population standard deviations of the white proxies clipped to 0.5–12. Each color's score is the mean of its volatility-weighted arithmetic accuracy and its harmonic accuracy; harmonic divisors use `max(1, moveAccuracy)`. Color alignment follows the starting side. No move missing exact finalized evidence is omitted to make an apparently complete score. Keep one visible Accuracy number for Brian's moves and one canonical result used by tools, labels, and progress. Special labels do not change that number.

Analyze with Stockfish 19, source `edb0d9db6731067ec50ce619ff372b463bc4dd5d`, official macOS universal binary SHA-256 `8eed61129d1493c5d1f2fd9323f0c54c47ac49319911fbde18c6b9c87e8b13c5`, and embedded NNUE `nn-1a298aa575a0.nnue` (SHA-256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`). Profile `stockfish19-n100k-r400k-t1-h16-v1` uses 100,000 ordinary and 400,000 refinement nodes, one thread, 16 MB hash, MultiPV=1, full strength, standard chess, and no tablebases. Each search starts a fresh process and clears search state. Include complete move history for repetition-aware analysis. See [the measured Mac benchmark](engine-benchmark.md); this does not promise a depth, latency, or deterministic results across machines. Missing, interrupted, bound-only, or inconsistent evidence remains pending. A different engine executable is rejected rather than silently assigned this profile. Custom node budgets are explicitly tagged exploratory and excluded from canonical scoring, retry acceptance, and game aggregation.

`W` is the selected method's 0–100 evaluation proxy, not Brian's personal winning probability. For a played move, loss `d = max(0, W_before - W_after)` from the mover's perspective, using finalized evidence from the same profile. Retain actual mate assessments separately. Compute grades at full precision, independently of rounded display values.

Sources: [Lichess accuracy explanation](https://lichess.org/page/accuracy), [Full accuracy implementation](https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala), [Evaluation conversion](https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/eval.scala), [Stockfish analysis controls](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html).

## Ordinary grades

Check Best first: the move must match the stable canonical best move, or be a checked alternative within both 10 centipawns and 0.5 W points of it. For mate positions, require preservation of the verified outcome rather than a centipawn comparison. If best-move evidence contradicts the before/after evaluation, refine it before finalization.

Otherwise use these half-open loss bands:

| Grade | Loss d in W points |
| --- | --- |
| Excellent | 0 <= d < 2 |
| Good | 2 <= d < 5 |
| Inaccuracy | 5 <= d < 10 |
| Mistake | 10 <= d < 20 |
| Blunder | d >= 20 |

Exactly 2 is Good, 5 is Inaccuracy, 10 is Mistake, and 20 is Blunder. These local bands are inspired by the published category meanings, applied to our own proxy. They are not Chess.com's expected-points calibration. A zero loss caused by clamping or search noise does not automatically earn Best.

Source for the familiar meanings: [Chess.com move classifications](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc).

## Special labels

Require the relevant predicates to remain true in both ordinary and refinement searches and in the canonical move assessment. Keep the ordinary grade internally. If special evidence is incomplete or unstable, retain the finalized ordinary grade. If the ordinary scoring evidence is itself missing or bound-only, keep the move pending. The numeric gates below are frozen conservative engineering defaults supported by the fixtures, with intentionally limited coverage.

- **Brilliant:** d < 2, W_after >= 45, and W_before < 90. The played move must create a legal immediate opportunity to capture its moved knight, bishop, rook, or queen. A checked acceptance followed by the mover's best reply must leave a net material concession of at least 2 points relative to the pre-move material balance, using P=1, N=B=3, R=5, Q=9. Check every legal immediate acceptance of that offered piece; each must retain W >= 45 and avoid a losing mate. Exclude equal exchanges, immediate compensating recaptures, and only-legal moves. This intentionally omits longer or indirect sacrifices that the v1 detector cannot establish.
- **Great:** d < 2, at least two legal choices, and the strongest searched alternative excluding the played move is at least 15 W points worse. Additionally, the played move either preserves W >= 45 while that alternative yields W <= 30, or preserves W >= 75 while the alternative yields W <= 60. Run a constrained `searchmoves` search with the entire remaining legal root pool at each budget; retain that full coverage and its strongest exact assessment. The budget is shared across that pool. A sampled top-two list is insufficient. Describe this as engine-checked critical-move evidence under the profile, not a mathematical proof about every continuation.
- **Miss:** the opponent's immediately preceding move raised the mover's available evaluation from W <= 60 to W >= 75, then the played move drops it to W <= 60 with d >= 15. Retain the opponent's mistake, missed continuation, and checked resulting position. An opportunity that existed before the opponent's move does not qualify under this rule.

Display precedence: Brilliant, then Great, then Miss, then the ordinary grade. No label is assigned by the language model. Do not add Book without a verified opening source. Fixed scoring calibration supports comparable history; coaching difficulty can change as Brian improves.

## Retry acceptance

Accept any legal move with d < 2 against the same finalized reference, regardless of whether it ranks first. If the exercise asks for a verified forced mate or drawing defense, additionally require that outcome to remain verified; saturated proxy values cannot decide it alone. Record the first unassisted attempt, hints, and prior answer exposure separately. Retry never changes the original game's score.

## v1 validation and limits

`tests/scoring.test.mjs` covers both colors, every exact band boundary, tied evaluations, stable versus unchecked Best, forced-mate preservation, mate-zero alignment, partial/bound/exploratory evidence rejection, full aggregation against an independent Python golden, mixed-profile rejection, special-label stability, equal/temporary material recovery, unsound acceptances, multiple acceptance coverage, only-legal moves, unique saving thresholds, equivalent choices, new gifts versus existing opportunities, and retry alternatives/outcome guards.

`tests/engine.test.mjs` runs the actual pinned engine for legal principal variations, repeatability, both mate perspectives, repetition-aware history, terminal mate/draw, constrained legal roots, and cancellation. `tests/special-evidence.test.mjs` runs both budgets on legal authored positions or known opening sequences: a near-best bishop sacrifice `Bxh7+ Kxh7 Ng5` with a verified net two-point concession; an unsound bishop offer; the Ruy Lopez bishop-for-knight exchange with both pawn acceptances; a uniquely winning `Rxf2` with all other root moves searched; a missed `Qxf7#` opportunity newly given by `...Nf6`, including the checked `...Nxh5` punishment absent from the played line; and ordinary equivalent opening choices. These are test/teaching positions, not claims about Brian's games.

The unsound-offer fixture also produces a bound-only refinement assessment, so its finalized classification remains pending. A near-best sacrificial pattern with missing exact acceptance evidence earns no special label. V1 intentionally omits indirect sacrifices, pawn/promotion sacrifices, and sound exchanges whose concession disappears after the immediate best reply. A forced winning sacrifice with W_before >= 90 is also intentionally excluded from Brilliant. These are conservative false negatives, not grounds for a model to add a label.

Freeze source revisions, thresholds, engine identity, and budgets together as `independent-lichess-v1` with the engine profile above. Later changes create a new scoring profile and require reanalysis before comparing history. Whole-game completion, native display, and persisted canonical use have separate integration checks; passing these fixtures alone does not establish a working plugin.
