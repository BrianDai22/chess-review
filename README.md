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

Open **Plugins → Chess Review → Open plugin**, or its **Review Board** sidebar entry. After an update, click **Refresh** in Plugins, then **Chess Review → Open plugin** to load the new package. Existing chats and mounted boards can retain a previous tool/resource snapshot; a fresh native chat can also reopen the session ID from your attached review context. Saved positions and history survive updates. Updated servers retain their bundled view if a later installation removes their package directory, but older running servers still need a refresh. Edit this repository and rerun the install command to update. Do not edit the installed cache.

If the directory shows the new version but the board still uses the old UI, toggle **Chess Review** off and on in **Settings → Plugins**, then reopen it. This restarts its connection without removing saved games.

## Use

1. Open Games, enter your Chess.com username, and import recent completed standard games. The username is remembered after a successful refresh. Brian's username is initially unset; the labeled verification fixture is available for checking setup.
2. Select a game. Local analysis starts automatically, reports progress, then shows both players' accuracy, move classifications, and key moments. A failed or interrupted job offers Resume and preserves completed evidence.
3. Start review or jump to a key moment. Show better move replaces a mistake from the position before it; Resume played move restores what happened in the game. Explain visually asks native Codex to publish short, checked visual steps. Play/Next animates those moves with arrows and piece highlights; Back rewinds and Close restores the starting position. The main workspace uses piece icons and short labels; notation stays in the Moves and Keyboard drawers. An evaluation graph and Moves drawer support direct navigation.
4. Click or drag pieces to explore. Engine mode shows checked best-move arrows; Play best move and Play next follow a continuation without typing notation. Previous steps back through your variation; Return to game restores the played position. Native chat can also demonstrate checked alternatives on the same board.
5. Retry an analyzed player move and click or drag your attempt. Promotions offer an explicit piece choice; Keyboard moves provides an optional accessible input. The answer stays hidden until an attempt or reveal. Hints, first attempts, sound alternatives, and prior answer exposure are recorded separately; retries do not change the original score.

The board and primary controls fit the review pane. Games, moves, saved history, and keyboard input open over the workspace rather than adding a long page below the board. See the [live Chess.com reference audit](docs/chesscom-review-audit.md) for the interaction choices behind guided review.

Pieces move with brief animations and checked last-move highlights. Rapid navigation keeps one guarded request in flight and coalesces later clicks to their latest destination. Unchanged graphs and move lists retain focus across background updates. A missing initial launch result recovers the supplied session or game once, with an explicit retry if opening fails.

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
