# Verification record

September 30, 2026. Implementation authorized by the build request; historical planning-only wording is superseded.

Completed evidence:

- Board source now uses Chessground 10.4.1 and locally bundled cBurnett SVG pieces. Both plugin icon fields point to a matching white pawn on green. Build and all 48 tests passed after this change; updated native appearance remains uninspected.

- Installed `chess-review@personal` initially as 0.1.0, then updated through bundled Codex CLI 0.159.2 to `0.1.0+codex.202609301854`. Updated installed stdio tool discovery, opener, bundled SVG resource and pawn metadata checks passed in a disposable store.
- Actual fixture board rendered in the native desktop MCP App surface; host model-context attachment accepted. This is not yet evidence of model consumption.
- Installed server startup, tool discovery and a harmless `open_review` call succeeded through the real stdio transport.
- Import/store tests cover cache validation, deduplication, error preservation, restart and cross-process writes. A disposable live public-account check imported 493 available games and zero duplicates on refresh.
- Engine/scoring tests use pinned Stockfish and cover perspective, terminal outcomes, repetition, boundaries and conservative predicate evidence. Actual-engine Brilliant, Great and Miss fixtures pass; the scoring profile is frozen in its documentation.
- Review tests cover special legal moves, immutable played lines, stale revision rejection, explicit session isolation and acknowledgement separation.
- UI coordination tests cover delayed context acknowledgements and stale/cross-session replies.

Still required before first-version completion:

- Manual selected position consumed by the next ordinary native question, followed by a semantic tool visibly changing the same mounted board.
- Real host remount and second-instance isolation; disconnection and light/dark/small-window inspection.
- Connected username picker, complete canonical game analysis, checked education, retry alternatives and grounded saved-mistake feedback.
- Packaging/update verification and final review.

The native computer-use session was explicitly stopped during inspection. No standalone browser substitute was created. The goal remains active and incomplete.

Setup tracking: `codexcfg status` was inspected. The new personal marketplace file is excluded by its existing ignore rules. The CLI's new plugin entry in `config.toml` is intentionally not committed yet because that tracked file contains pre-existing unrelated changes. Existing configuration, marketplace entries and those changes are preserved. No broad setup commit or forced add was performed.
