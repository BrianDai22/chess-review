# Verification record

September 30, 2026. Implementation is authorized by the build request. The subsequent request to create a public GitHub repository supersedes the original no-publication instruction.

## Automated and compiled checks

- `npm test`: **101 passed, zero failed or skipped**, including actual pinned Stockfish tests, import/store, scoring boundaries, conservative special labels, full-game analysis, education, retry, replay, restart, cross-process writes and UI coordination.
- `npm run install:local`: engine verification, self-contained build and supported local installation passed. Final UI code was inspected from installed package `0.1.0+codex.1790797304802`; later packaging refreshes include the same runtime code and updated documentation.
- `node scripts/verify-stdio.mjs`: **7 compiled transport checks passed in 7.2 seconds** using a disposable SQLite store and the actual engine. Verified tool discovery, pawn serverInfo metadata, twelve locally bundled SVG pieces, empty username, explicit session/stale guards, complete eight-position fixture analysis (player accuracy 91.497), hidden retry, accepted checked mate, immutable original PGN/full score record, educational continuations and restoration after a real stdio-process restart.
- A disposable live public Chess.com import obtained 493 available games and zero duplicates on refresh. Import tests exercise cache validators/max-age, Retry-After across instances, serialization, invalid/foreign archives, unsupported games and network/API errors while preserving history. Brian's actual username remains unset; no personal-game import or personal progress is claimed.
- The verified engine/source installer also recovered a partially populated external engine directory and reused the verified installation on its next run.
- `git diff --check` passed. Generated bundles, engine binaries, local databases and verification screenshots are excluded from published source. The build includes corresponding source and license notices.

## Actual Codex desktop evidence

Inspected `/Applications/ChatGPT.app`, version 26.928.21956/build 12404, using its native MCP App and signed-in conversation, with no standalone browser substitute or model inference API.

1. The board rendered in the native desktop surface. Manual Next selected `1.e4` and committed revision 2. The next ordinary question correctly identified Black to move, White's pawn on e4 and the last move; actual semantic `show_variation` displayed `e5 Nf3` on that same mounted board at revision 3. Chat: `Analyze the selected chess position` (`01a0f3af-485a-7f33-8fa0-3643446d5273`).
2. A second native review had a distinct session. Its navigation did not change the first session; closing it removed its separate context attachment. Reopening the first session preserved its selected position and variation.
3. Actual Analyze and Retry controls completed local fixture analysis, displayed accuracy 91.5 and the checked Great key moment, then hid future moves and answer evidence during the unattempted retry.
4. A fresh native plugin launch after installation restored session `5c2054c7-71ba-4e14-bb33-61d85f22f726` at saved ply 6, revision 23, preserving its retry. The redesigned resource showed the corrected header, collapsed account/game panel during retry, readable player bars and green SVG board. The **pawn appeared in the actual Codex sidebar, board tab, opener and context attachment**. Setting manifest icons alone had not changed the sidebar; standard MCP `serverInfo.icons` did.
5. Dragging the queen from h5 to f7 on the real board called the guarded retry path and displayed `Qxf7#: accepted as a sound move`. Returning to review and navigating Previous selected ply 5. The next ordinary question asked to check Nf6 without supplying FEN/ply. Native chat read context at revision 27, called `check_candidate` for Nf6 and g6, `get_position_evidence`, then `show_variation` with `Nf6 Qxf7#`.
6. That same mounted board visibly showed the queen on f7 and the variation at revision 28. Native chat explained the mate, checked defense g6 and a reusable decision cue. The live mount `934dde42-490e-4bce-bb64-7cd91cb1d913` separately acknowledged displayed/context revision 28 with accepted context update `0d1f6519-e289-42fb-be13-7a21756a60ca`. Chat: `Reopen saved review session` (`01a0f3d7-2f5f-75b3-a307-4967b7b05b20`). The original game and accuracy remained intact.
7. The final dark-theme interface was inspected both beside native chat and at approximately 360 CSS pixels of pane width: header, board, controls and assessments remained readable without material horizontal clipping or overlap. Pane width was restored afterward. A header overlap found during inspection was fixed and checked again in the actual host.

Computer-use screenshots and clicks were verification actions only. Production navigation, demonstrations and coaching use canonical semantic tools. The first pre-fix fixture retry was created before UI prior-answer tracking; its attempt history is verification data, not Brian's learning history. The current UI records that a move shown before a retry was already exposed.

## Practical limits and update flow

Existing chats and mounted frames can retain their old tool/resource snapshot. A fresh native chat mentioning Chess Review loaded the updated package and restored the explicit saved session. Installation alone is not proof that an already-open frame refreshed. Use the README's fresh-chat restoration flow after updates.

Failed synchronization, delayed/cross-session replies, context retry/backoff and promotion staleness are covered by the UI harness; process interruption/recovery is covered by actual backend checks. Live light-theme switching and a forced host bridge outage were not performed. Theme application uses the supported host context/styles API and both light/dark CSS values; this record does not claim live inspection of those unperformed cases. Quiet-position strategic prose remains model interpretation, while checked continuations and all scores come from the engine/backend.

Setup tracking: `codexcfg status` was inspected. The new personal marketplace file is excluded by existing ignore rules. The CLI's plugin entry in `config.toml` remains outside a setup commit because that tracked file contains pre-existing unrelated changes. Configuration, marketplace entries and unrelated work are preserved; no broad commit or forced add was performed.
