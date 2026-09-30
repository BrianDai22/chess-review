# Chess Review

A local Codex plugin for reviewing completed Chess.com games beside native coaching. Import a username, choose a game, analyze it with pinned Stockfish, and discuss or retry decisions on the same board. The board uses Chessground with bundled SVG pieces; the plugin uses a pawn icon.

One SQLite backend owns original PGNs, positions, scoring, sessions, and retry history. Accuracy follows the documented independent Lichess-based method, so numbers can differ from Chess.com. Coaching uses the existing signed-in Codex subscription; this application makes no model inference API calls or requests a model API key.

## Install or update on this Mac

Requirements: macOS, Node.js 24 or newer, and Codex desktop installed as `/Applications/ChatGPT.app`.

```sh
npm ci --ignore-scripts
npm run install:local
```

The installer obtains and verifies the pinned official Stockfish release, retains its corresponding source and license, builds the self-contained package, preserves existing personal-marketplace entries, and runs the bundled CLI's `plugin add chess-review@personal`. A fresh package version is generated for each install. `CHESS_REVIEW_CODEX_CLI` can override the CLI path.

Open **Plugins → Chess Review → Open plugin**, or its **Review Board** sidebar entry. Existing chats and mounted boards can retain a previous tool/resource snapshot. After an update, start a fresh native chat mentioning Chess Review and ask it to reopen your saved session. The session ID is in the attached review context; the saved position and history survive updates. Edit this repository and rerun the install command to update. Do not edit the installed cache.

## Use

1. Open Games, enter your Chess.com username, and import recent completed standard games. The username is remembered after a successful refresh. Brian's username is initially unset; the labeled verification fixture is available for checking setup.
2. Select a game and choose Analyze. Local analysis reports progress, then shows player accuracy, move classifications, and key moments. An interrupted job offers Resume and preserves completed evidence.
3. Navigate the played line and ask native chat about the selected position. Coaching checks evidence and alternatives through semantic chess tools; demonstrated variations leave the original game untouched. Moving a piece during ordinary review creates a variation; Return to game restores the played position.
4. Retry an analyzed player move. Click or drag a legal move on the board, or submit SAN (`Nf3`) or from-to notation (`g1f3`). Promotions offer an explicit piece choice. The answer stays hidden until an attempt or reveal. Hints, first attempts, sound alternatives, and prior answer exposure are recorded separately; retries do not change the original score.

Saved mistakes and comparable history use actual imported games under the same scoring version and exact time control. The fixture supplies no personal progress. Multiple open boards have explicit, independent sessions. To restore a particular session in native chat, ask to reopen its session ID from the attached review context.

## Local data and verification

Data lives outside the plugin cache at `~/Library/Application Support/Chess Review/chess-review.sqlite`; the verified engine and its source live in that directory's `engine/stockfish/` subdirectory. `CHESS_REVIEW_DATA_DIR` selects another store, and `CHESS_REVIEW_STOCKFISH` selects a binary that must match the frozen hash. Keep personal databases private. Neither databases nor engine binaries are published in this source repository.

```sh
npm run setup:engine
npm test
npm run build
node scripts/verify-stdio.mjs
```

The build includes corresponding plugin source and license notices. The verifier uses a disposable store and actual compiled MCP stdio transport, local analysis, retry, and restart. It does not stand in for native rendering checks. See [verification evidence](docs/verification.md), [host integration](docs/host-sdk-findings.md), [scoring](docs/scoring-v1.md), [engine measurements](docs/engine-benchmark.md), [import](docs/import.md), [analysis](docs/analysis.md), and [learning](docs/learning.md).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [third-party source and notices](docs/third-party-notices.md).
