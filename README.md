# Chess Review

A local Codex plugin for reviewing completed Chess.com games beside native subscription-powered coaching. Development is in progress; the first version is **not yet complete**.

The initial plugin has rendered a fixture board in the installed desktop host, persisted review sessions in SQLite, and published acknowledged selected-position context. Native model consumption, visible semantic changes, and remount/isolation still need live verification. Computer-use inspection was stopped during that check. The board now uses Lichess Chessground with SVG pieces and a matching pawn plugin icon; its updated native appearance still needs inspection. The full review, import picker, canonical game-analysis orchestration, and retry workflow are not connected yet.

Independent modules implement public username import, caching/deduplication/error preservation, Stockfish analysis, and documented Lichess-based scoring. No model API keys or separately billed model inference calls are used. The verification fixture is not a user's game history.

## Development

Node.js 24 or newer is required. Install the exact lockfile dependencies and run:

```sh
npm ci --ignore-scripts
npm test
npm run build
```

The build writes a self-contained `chess-review/` package containing its MCP server and embedded HTML resource. Engine tests need the pinned Stockfish binary described in [the benchmark](docs/engine-benchmark.md). Engine binaries are excluded from Git. See [scoring](docs/scoring-v1.md), [import and storage](docs/import.md), and [host integration findings](docs/host-sdk-findings.md) for evidence and limits.

## Data and installation

Learning data lives outside the plugin cache in `~/Library/Application Support/Chess Review/chess-review.sqlite`. `CHESS_REVIEW_DATA_DIR` can select a disposable verification store. Keep this database private; it is not part of this repository. Original PGNs remain separate from explored variations.

The current local package uses portable root manifests and a synchronized Codex compatibility overlay. It installs through the personal local marketplace using `codex plugin add chess-review@personal`. A local authoring helper creates that marketplace entry; its generated source location is `~/plugins/chess-review`. Edit this repository, rebuild and copy the generated package there, then use the supported cachebuster/reinstall flow. Never edit the installed cache. Complete startup/update/use instructions will accompany the verified first version.

## License

AGPL-3.0-or-later. The scoring code adapts Lichess source. See [third-party notices](docs/third-party-notices.md) and [LICENSE](LICENSE). No Stockfish binary is published in this source repository.
