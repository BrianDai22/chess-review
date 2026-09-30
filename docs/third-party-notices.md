# Third-party source and licenses

The plugin source is licensed under AGPL-3.0-or-later (root `LICENSE`). The scoring implementation is a JavaScript adaptation of Lichess's accuracy algorithm, with attribution to the Lichess contributors. The full calculation includes aggregation; special classification rules are this project's independent engineering rules.

| Component | Pinned source | License |
| --- | --- | --- |
| Lichess accuracy and tree score conversion | [lila fbecdb9b1a81553ee254f5a41de98eeba56bf405](https://github.com/lichess-org/lila/tree/fbecdb9b1a81553ee254f5a41de98eeba56bf405) | [AGPL-3.0](licenses/lila-AGPL-3.0.txt) |
| Centipawn, mate, and winning chance conversion | [scalachess 57d3483869abde8a7dbd867520fe78f8f7e87d79](https://github.com/lichess-org/scalachess/tree/57d3483869abde8a7dbd867520fe78f8f7e87d79) | [MIT](licenses/scalachess-MIT.txt) |
| Population standard deviation and harmonic mean floor | [scalalib ea1aae727b3b9bdc2f506f12d4991fe3ed8e8b44](https://github.com/lichess-org/scalalib/tree/ea1aae727b3b9bdc2f506f12d4991fe3ed8e8b44) | [MIT](licenses/scalalib-MIT.txt) |
| Local analysis engine | [Stockfish sf_19, edb0d9db6731067ec50ce619ff372b463bc4dd5d](https://github.com/official-stockfish/Stockfish/tree/edb0d9db6731067ec50ce619ff372b463bc4dd5d) | [GPL-3.0](licenses/Stockfish-GPL-3.0.txt) |

The official [Stockfish macOS universal release archive](https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-macos-universal.tar.gz) includes its corresponding source, authors, and license. Local setup retains these together under `.runtime/stockfish/stockfish/`. The engine's network is embedded in that binary. The ignored `.runtime` directory is not included in the public source repository; setup downloads the official archive. Do not distribute a detached engine binary without its corresponding source and license. Local plugin export must retain the plugin source and license notices.

Other pinned JavaScript dependencies and their transitive license notices remain in their installed package directories and lockfile. None provide a separately billed model chat service.

The board uses [Lichess Chessground 10.4.1](https://github.com/lichess-org/chessground) under [GPL-3.0-or-later](licenses/Chessground-GPL-3.0.txt). Its bundled cBurnett SVG piece set supplies both the board artwork and the pawn plugin icon; the icon adds a green background and scales the view box. The public repository contains the corresponding source and attribution. The UI bundles these assets locally with no external font or piece fetch.
