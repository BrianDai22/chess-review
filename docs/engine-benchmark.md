# Local engine benchmark

Measured September 30, 2026 on Brian's Mac: arm64, Mac15,6, 11 logical CPUs, macOS 26.6.2 (25G83). Actual Stockfish processes were run through `src/engine.mjs`; each search launched a fresh process, configured one thread and 16 MB hash, cleared search state, and passed complete legal UCI move history. Wall times include startup and network loading. These are observations under current load, not promised latency or depth.

Identity: Stockfish 19 release `sf_19`, source `edb0d9db6731067ec50ce619ff372b463bc4dd5d`. Official universal archive SHA-256 `a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77`; executable SHA-256 `8eed61129d1493c5d1f2fd9323f0c54c47ac49319911fbde18c6b9c87e8b13c5`; embedded NNUE `nn-1a298aa575a0.nnue`, exported and checked SHA-256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`.

| Position | Requested nodes | Actual nodes | Wall time ms | Depth | White assessment | Best move |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Starting position | 50,000 | 50,001 | 267 | 15 | +30 cp | e2e4 |
| Ruy Lopez after 4...Nf6 | 50,000 | 50,073 | 195 | 14 | +41 cp | O-O |
| Scholar's mate opportunity | 50,000 | 10,539 | 140 | 245 | mate in 1 | Qxf7# |
| Starting position | 100,000 | 100,002 | 248 | 18 | +39 cp | e2e4 |
| Ruy Lopez after 4...Nf6 | 100,000 | 100,061 | 247 | 16 | +43 cp | O-O |
| Scholar's mate opportunity | 100,000 | 10,539 | 151 | 245 | mate in 1 | Qxf7# |
| Starting position | 400,000 | 400,227 | 722 | 21 | +34 cp | e2e4 |
| Ruy Lopez after 4...Nf6 | 400,000 | 400,139 | 575 | 19 | +31 cp | O-O |
| Scholar's mate opportunity | 400,000 | 10,539 | 195 | 245 | mate in 1 | Qxf7# |

Chosen engineering profile: 100,000 ordinary nodes and 400,000 refinement nodes. MultiPV=1, full strength, no tablebases, standard chess. `go nodes` can modestly overshoot; proven short mates can end early. Depth 245 on the mate fixture reflects Stockfish's internal terminal search behavior and is not comparable with normal position depth. Critical special labels require extra constrained root searches, so whole-game time depends on game length and candidate evidence. No whole-game speed promise follows from these nine searches.

The opening history is `e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6`; the tactical history is `e2e4 e7e5 d1h5 b8c6 f1c4 g8f6`. Repeat fixture searches returned identical nodes, mate, and principal variations. One-thread fresh-process repeatability on this binary does not imply deterministic results across machines or future scoring profiles.

`node --test tests/engine.test.mjs` verifies the actual pinned executable, both evaluation perspectives, legal checked principal variations, root move filtering, terminal mate, repetition from move history, and cancellation without finalized evidence. The engine wrapper hashes the executable before use and refuses a different binary rather than silently changing scoring calibration.
