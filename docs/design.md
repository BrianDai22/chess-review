# Codex-native Chess Review plan

Status: Codex-native plugin and independent documented scoring selected; host feasibility and detailed scoring rules still need verification. Updated September 30, 2026. This document records decisions and recommendations; application implementation has not started.

## Goal and confirmed choices

Brian plays on Chess.com at approximately 1100 and wants more completed-game reviews than the daily allowance provides. The tool should provide a familiar guided review, explain the consequences of moves, support discussion of plans, and help track improvement.

- First version: a personal Codex-native plugin on Brian's Mac. Its web-based review interface runs as an MCP App beside the native Codex conversation. Actual embedded UI support must pass a feasibility check before the full build.
- Import: remember a Chess.com username and display recent completed games. Occasional public-archive delays are acceptable.
- One authoritative, independent, documented scoring method applies to every game. Familiar accuracy presentation and special labels matter. Brian accepts that local numbers may differ from Chess.com; identical CAPS2 output is not required.
- Codex provides the conversation beside the review interface. The plugin supplies current position context and semantic chess tools; it does not implement a separate model chat service. Codex must manipulate the board through those tools, never computer use.
- Avoid separately billed model API usage. The public Chess.com game API remains the proposed import source; avoiding model billing is not interpreted as banning all network APIs.
- Keep the app minimal and limited to reviewing games, understanding decisions, and practicing mistakes. Use design-taste-frontend during the build, applying only guidance appropriate to this learning interface.

## Design tree

```text
Personal learning tool
├── Package: personal Codex plugin; Mac first [selected]
│   ├── Interface: embedded MCP App beside native conversation [needs host verification]
│   ├── Model context updates and semantic chess tools [required; needs functional verification]
│   └── Local backend: games, review state, engine, one scoring method [selected]
├── Import: username and recent games [confirmed]
│   └── Fresh-game delays acceptable [confirmed]
├── Guided review: familiar Chess.com workflow [requested]
│   ├── One score source with familiar special labels [confirmed]
│   └── Independent documented scoring accepted; detailed rules need validation
└── Education: explanations and strategic discussion [requested]
    ├── Concrete evidence and playable variations [proposed]
    └── Comparable progress measures over multiple games [proposed]
```

## Architecture and evidence

### Import

Chess.com's public monthly archives contain completed games and PGNs. The archive can be cached: describe a missing newest game as not yet available rather than asserting a specific cause or erasing existing history. Fetch recent archives first, serialize requests, honor caching headers, retain imported games on network errors, deduplicate by game URL, and expose the last successful refresh. Refresh on opening the game picker and on explicit Refresh; no background monitoring or Chess.com browser extension is planned. Remember one username, identify Brian's color from the players, and analyze only the selected game. Distinguish invalid accounts, no available completed games, unsupported variants, and temporary fetch failures.

The public archive may include Chess.com's already-calculated accuracy for a game. Do not display or use that optional score: Brian requires one authoritative scoring method for every game.

Source: [Published-Data API](https://www.chess.com/news/view/published-data-api).

### Plugin package and subscription

Package the tool as a personal local plugin: root `plugin.json` describes the package using Agent Plugins 1.0, portable `mcp.json` declares the actual local server command, the server supplies the review UI as an MCP App resource and exposes semantic tools, and `skills/chess-coach/SKILL.md` instructs Codex to ground explanations in the current review and checked variations. The skill guides reasoning; the backend alone computes scores and classifications. Exact runtime and startup lifecycle will follow the supported desktop implementation after the feasibility check. No framework or dependency is selected yet.

Codex owns model access through the signed-in subscription. The plugin makes no model inference calls and requires no separate model API connection; subscription limits still apply. A local backend owns imported games, saved reviews, analysis results, scoring, and active review sessions. The MCP App and Codex tools use the same backend operations and data. Confirmed tool changes update the mounted board; model context updates carry manual board navigation back to the conversation.

Target a private local install on Brian's Mac. Official packaging docs describe local marketplaces and supported local clients, including Codex in the desktop app. Local MCP transport support alone does not prove MCP App rendering, context sharing, or panel entrypoints. Verify those capabilities in the actual installed host. No configuration has been changed and no end-to-end connection has been tested.

Build one plugin interface. A standalone browser app, WebMCP transport, remote ChatGPT service, public plugin listing, and MCP Events are outside the first-version plan. If the local host cannot support the required native experience, report the specific limitation and revisit the design before building a second surface or introducing hosting.

Sources: [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins), [Package and local installation](https://developers.openai.com/plugins/build/plugins), [Codex MCP](https://developers.openai.com/codex/mcp).

### Plugin Creator standards review

Reviewed the installed [Plugin Creator create-plugin skill](/Users/briandai/.codex/plugins/cache/openai-curated-remote/plugin-creator/0.1.22/skills/create-plugin/SKILL.md), including its local-plugin, package, and Extensions references. Its default is cloud hosting through Sites MCP, but its explicit local path applies because Brian selected a Mac-local tool and local engine/backend. Do not create a cloud Site or account plugin as part of this planning review.

- Package one self-contained `chess-review` directory. Use a matching manifest name, semantic version, root `plugin.json`, portable `mcp.json`, and discoverable `skills/`. Put OpenAI presentation fields under `extensions.com.openai.interface`; do not put `skills`, `mcpServers`, `apps`, or `interface` at the manifest's top level. Add a synchronized `.codex-plugin/plugin.json` compatibility overlay only if the actual host requires it. Keep the listing subtitle within 30 characters.
- Declare the actual built server entrypoint with portable plugin-root paths. For a stdio server, stdout carries protocol messages and stderr carries logs. Use supported local authoring helpers when available, validate the package against its schemas, and keep secrets, dependency directories, and unrelated files out of export archives.
- Register the HTML review as an MCP App resource and associate an opener tool using the official SDK's resource metadata and host bridge. A website URL or JSON response alone does not register an app. Declare fullscreen as the review's supported and preferred display mode; the guide identifies this as the side panel in a Codex conversation. Verify actual placement because display preferences are hints. No inline review widget is needed.
- Use compatible official MCP, MCP Apps, and OpenAI Extensions SDK releases. Read APIs at the pinned release or commit, feature-detect host capabilities, and avoid mixing metadata from different API versions. OpenAI's September 29 Node release is a reference, not an installed dependency or a claim of local support. Adapt relevant Bits & Bolts integration patterns without copying its unrelated features.
- Apply the host's theme and style variables at connection and when they change. Bundle required CSS with the app resource rather than relying on external stylesheets. Register initial tool-result handling before connecting, render the opener's launch data, and avoid a redundant opener call from the UI. Attach only relevant current review evidence; a context attachment alone neither sends a message nor authorizes an action.
- On later authorized installation, preserve marketplace entries, edit the source package rather than the installed cache, and reload through the supported host flow. Validate startup, tool discovery, a harmless context read, rendered placement, context updates, and visible semantic board actions. Investigate desktop logs when needed. Package/account creation alone is not proof of working tools or UI; account upload does not deploy a local process.

Sources: [Agent Plugins manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json), [OpenAI Node SDK release reference](https://github.com/openai/mcp-extensions/blob/node-v0.1.0/typescript/README.md), [Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md). Select and verify the supported versions again when implementation begins.

### Fresh context and board actions

Every context read returns live state from an explicitly connected review session: game ID, session ID, selected ply, player color, side to move, current FEN, recent moves, whether the board shows a variation, classification, evaluation, candidate continuations, scoring version, and analysis readiness. Include a compact plain-language summary and fetch the full game history only when needed.

Each state has a revision. Position-dependent coaching must use current context and refresh it when absent, stale, or ambiguous; board changes include the expected session and revision, reject stale requests, validate legal moves, and return the resulting state. Manual UI actions first call the canonical server through the MCP App host bridge, render the returned state, and then publish that state as model context. `ui/update-model-context` updates the host's model context; it is not a write to the backend. Preserve the played line when demonstrating alternatives.

Illustrative tool contract, to be finalized during implementation:

| Tool | Purpose |
| --- | --- |
| `import_games` | Refresh completed games for the remembered Chess.com username. |
| `list_games` | List imported games and review readiness for the game picker. |
| `open_review` | Open a game, bind the mounted app to a review session, and return its initial state. |
| `get_review_context` | Read the current position, canonical analysis, and compact summary. |
| `get_game_review` | Read the played game and its important moments for broader discussion. |
| `go_to_move` | Select a move in the played line. |
| `analyze_candidate` | Check an alternative through the same local engine. |
| `show_variation` | Display legal alternative moves and relevant highlights. |
| `return_to_game` | Leave a demonstration and restore the played-line position. |

The mounted app also needs an app-only `sync_review_view` read. A model tool response alone does not prove an already-open app received or displayed the change. The first-version recommendation is bounded polling through the same host bridge: send session ID, mount ID, known revision, and displayed revision; return unchanged, the latest snapshot, or an expired/disconnected session. Keep one read in flight, use timeouts and error backoff, pause periodic reads while hidden, and refresh on resume/remount. Only changed state needs rendering or context publication. Measure the cadence during the feasibility check; polling must not generate model turns or fill conversation history. Do not add an untested resource-push transport as a second implementation.

Track backend commit, mounted UI acknowledgement, and host context acknowledgement separately. Context update IDs confirm attachment acceptance, not that the model consumed the data. Ignore responses older than the current rendered revision; serialize and coalesce context publications so a delayed acknowledgement cannot replace a newer position. Create a mount ID for each view and expire old acknowledgements. Tools must not claim a change is displayed until the matching live view acknowledges it. Use explicit review-session IDs rather than a global active game, and resolve conflicting session attachments before acting.

On manual game selection, move navigation, or variation changes, publish the compact current review context through `ui/update-model-context` and handle its acknowledgement. The documented extension replaces context previously supplied by the same mounted app instance. Context is intended for the next user question; board clicks do not start a coaching response. An Explain action may update context, await acknowledgement, and send the user's requested question through the host's supported message mechanism.

Keep live context reads and revision validation for reconnects, multiple app instances, and changes during a reply. Do not claim that an idle model is continuously reasoning or that an existing answer automatically rewrites when the board changes. If the position changes during a reply, identify the position the explanation refers to. A disconnected session must report disconnection; it must not fall back to screenshots, mouse actions, or arbitrary JavaScript. Multiple mounted instances must not cause a tool call to address a different review accidentally.

Source: [Model-context extension](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#uiupdate-model-context-extensions).

Pinned implementation references: [MCP App host bridge](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.5/src/app.ts), [App-only tool visibility](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.5/src/server/index.ts), [Context acknowledgement](https://github.com/openai/mcp-extensions/blob/node-v0.1.0/typescript/src/app/model-context.ts). These explain the reviewed behavior; dependency selection remains subject to the installed host check.

### Native UI support and MCP Events

Selected September 30: render the review as an MCP App beside native Codex conversation. OpenAI extensions describe sidebar and conversation-panel entrypoints. Prefer a conversation panel for the review; add a sidebar launch entry only if supported and needed to open it. The exact entrypoint remains a host feasibility question, not an extra product feature. Actual support in Brian's installed desktop host remains untested.

Brian's shared link resolves to MCP Events. Those are server subscriptions and signed webhook deliveries into a subscribed ChatGPT conversation, not automatic board-context synchronization. They could support a later requested notification when a game is ready, but are unnecessary for the first review workflow. The events guide does not establish equivalent Codex behavior.

Remote ChatGPT connection testing requires a reachable HTTPS endpoint or Secure MCP Tunnel. That is a different deployment path from the selected local Codex plugin and is not planned for the first version. Do not infer local embedded UI availability from remote ChatGPT documentation.

The decisive first integration check, once implementation is authorized: manually select a different position while chat is idle, ask an ordinary question, verify the model receives that position, then use a semantic tool to display a legal variation in the same board instance.

Sources: [Plugin extensions](https://developers.openai.com/plugins/build/extensions), [Model-context extension](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#uiupdate-model-context-extensions), [MCP Events](https://developers.openai.com/plugins/build/mcp-events), [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt).

### Scores and familiar labels

Chess.com publishes ordinary move-classification cutoffs based on expected points lost and describes rating-sensitive Brilliant, Great, and Miss rules. Its separate game accuracy system is CAPS2. The reviewed official documentation does not give a complete specification sufficient to guarantee identical local results, including the full expected-points calibration, CAPS2 aggregation, and all special-label details.

This is a compatibility limit, not a reason to drop familiar terminology. An independent implementation can use documented meanings and clearly disclose its scoring method. A Brilliant classification must have evidence of a sound sacrifice; the language model should not assign labels by impression.

Confirmed boundary: compute one canonical local score and classification set for every game. The board, summary, progress views, and Codex tools use those same results. Do not mix imported Chess.com accuracy with local results or allow a language model to invent a second score.

Brian confirmed on September 30 that an independent documented score is acceptable. Recommended foundation: a version-pinned Lichess accuracy calculation, including its winning-chance conversion and game aggregation, plus separately documented rules for the familiar labels. [The proposed v1 specification](scoring-v1.md) defines ordinary boundaries, Best tolerances, conservative special-label predicates, precedence, retry tolerance, and validation cases. Freeze its source versions and validate its defaults before treating the method as complete; accepting independent scoring does not silently certify every special-label heuristic. A single source of truth ensures internal consistency, not numerical equality with Chess.com.

Sources: [Move classification](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc), [CAPS2 accuracy](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined).

Candidate public accuracy implementation: [Lichess AccuracyPercent](https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala).

## Minimal interface and design guidance

Reading this as: a personal chess learning MCP App inside Codex, with a calm, minimal, board-first interface beside native chat. This is a greenfield product interface rather than a marketing site. Use [design-taste-frontend](/Users/briandai/.agents/skills/design-taste-frontend/SKILL.md) for relevant typography, spacing, contrast, consistent styling, interaction states, and visual verification. Its marketing layouts, decorative photography, hero sections, and animation defaults do not fit this surface. Brian's explicit minimal scope takes precedence over conflicting skill defaults.

Design dials: `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 2`, `VISUAL_DENSITY: 3`. A predictable layout and low motion support concentration; low density means fewer competing elements, not oversized empty space. No design framework or animation dependency is selected solely because the skill lists it.

The primary flow is choose a game, review it, and discuss or retry a position. Keep one main review workspace: a prominent board, compact move navigation and evaluation graph, Brian's canonical accuracy score, and compact move feedback. Use native chat for generated explanations. Show familiar move labels in context. Keep deeper variations and engine detail behind purposeful actions rather than displaying every line at once.

UI/UX copy is minimal: short, literal action labels; no slogans, feature descriptions, redundant headings, instructional filler, or technical implementation text in the normal review flow. Explain a chess decision briefly where it matters and let the user request more through coaching. Keep necessary field labels, accessible names, actionable errors, and meaningful position feedback. Show setup guidance only when a connection or import actually needs it. Every visible sentence and control must support the next chess-learning action.

Retry uses the same board. Saved mistakes may be reached through a small list rather than a separate training application. The existing Codex composer is the primary place to ask questions; an optional short Explain action may send a position-specific question. Do not add a duplicate chat panel or a Discuss in Codex handoff. Connection or analysis problems appear only where they affect the user's next action.

Use readable sans-serif text, neutral surfaces, one restrained interface accent, and consistent semantic colors for move classifications. Respect system light/dark preference, keyboard focus, sufficient contrast, reduced motion, and smaller-window layout. Motion is limited to useful board changes and interaction feedback. Inspect loading, empty, error, disconnected, retry, and variation states during implementation.

Exclude a marketing page, social features, achievement systems, course platform, and a large analytics dashboard. New visible features must directly help review a game, understand a decision, practice a mistake, or assess progress. Technical correctness and native integration remain required even when their implementation is invisible in the interface.

## Defaults from the September 30 self-review

These are concrete recommendations for shared understanding, not authorization to implement them. The independent scoring compatibility decision above is confirmed; exact engine budgets and classifier thresholds must be validated rather than invented.

### Engine evidence and score stability

Use a pinned full-strength local engine and analysis profile. Prefer fixed node budgets, one thread, and reset search state for repeatability; benchmark the actual Mac before selecting the budget. Retain engine/NNUE identity, options, scoring version, position history, candidate lines, and exact versus bound output. FEN is useful board context but insufficient by itself for repetition-aware analysis or cache identity.

Compare the best and played moves using matched settings and a consistent player perspective. Grade the move immediately after it was played, independently of whether the opponent found the punishment. Deep analysis requested in chat does not silently assign another grade. If it contradicts saved evidence materially, re-finalize the canonical review deliberately and replace its results together.

Show analysis readiness rather than a fabricated score when evidence is missing or interrupted. Partial evaluation data may be shown as provisional, but the aggregate accuracy and move classifications become final only under the completed scoring profile. Keep one active profile for comparable history. A probability-like engine proxy is a scoring input, not a claim about Brian's personal chance of winning.

Ordinary labels use documented local loss bands, exact boundary rules, and evaluation tolerances. Best requires a checked best alternative. Special labels require explicit evidence: Brilliant needs a sound near-best piece sacrifice with checked responses; Great needs a critical uniquely good or substantially superior move; Miss needs a missed opportunity rather than merely a bad move. When the evidence is insufficient, show the ordinary classification. Use fixed calibration for progress and adapt the teaching language to Brian's level. The exact special-label predicates remain part of the scoring specification and validation work.

Sources: [Lichess accuracy](https://lichess.org/page/accuracy), [Accuracy implementation](https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala), [Evaluation conversion](https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/eval.scala), [Stockfish analysis controls](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html).

### Teaching flow

Choose a game, prepare its engine review, then request a short guided overview through native Codex chat. Generate coaching only in response to a review/explanation request; manual board navigation publishes context without producing a response at every click. Keep generated teaching primarily in native chat. The board's compact feedback shows the current assessment and relevant evidence rather than duplicating a second conversation. Any delayed explanation request must remain bound to its originating session.

Focus the first overview on a few useful moments rather than narrating every move. For a mistake: identify the opponent's threat, show what the played move allows, demonstrate a checked alternative, and give one decision cue Brian can reuse. Show the opponent's relevant strong response even when it was missed in the actual game. Clearly identify actual moves and hypothetical continuations.

For a quiet planning position: state a concrete goal, useful preparation, the opponent's counterplay, and what would make the plan change. Check immediate tactical claims with the engine. A principal variation illustrates a plan; it is not a guaranteed long-term sequence or a complete explanation of the engine's reasoning. Distinguish observed facts from strategic interpretation and ask what Brian was trying to achieve when that matters.

### Retry and improvement evidence

Retry uses the position before the decision and preserves the original game. Hide the preferred move and line until the attempt; if the answer was already shown or a hint was used, record that help. Accept comparably sound alternatives under the selected scoring tolerance, including preservation of a forced mate or draw where relevant. Record the first attempt and later attempts separately. Retry outcomes never change the played-game accuracy score, and remembering an answer is not by itself proof of stronger live play.

Recurring-mistake feedback cites actual positions and separates error counts from opportunities. Compare similar time controls, include the number of reviewed games, and keep retry performance distinct from real-game performance. Avoid treating high accuracy in an already-decided position as evidence of overall playing strength.

### Persistence and restart

Store games, original PGNs, complete analyses, retry outcomes, and committed session state outside the installed plugin cache. Treat stdio servers as potentially multiple host-managed processes rather than assuming a singleton; the local store must prevent conflicting writes and duplicate analysis jobs. Exact storage implementation remains a build choice within this boundary.

Persist committed changes as they occur. On remount or restart, read canonical state before publishing context; a cached host attachment is not permitted to overwrite newer backend state. Invalidate old view acknowledgements, resume the identified durable session or report its expiration, and preserve completed reviews if engine work is interrupted. Provide a recoverable export. Verify the source-to-install update flow; do not promise hot reload or store learning history inside files replaced during plugin updates.

Engine analysis is independent of model inference. The review UI still depends on the local host and backend being available. AI discussion depends on internet access and subscription allowance; do not promise unlimited chat or an untested offline interface.

## Compact improvement feedback

Keep score history beside recent games and provide a short recurring-mistake summary when enough evidence exists. Saved mistakes and unassisted retry results can inform Codex coaching. Do not introduce a dedicated dashboard or a collection of metric cards in the first version. Compare like time controls and make the amount of evidence clear before describing a trend. Scores from a short forced game and a long difficult game are not interchangeable evidence of playing strength.

Keep engine and scoring versions with each review. Progress feedback uses one active scoring method; if it changes, deliberately reanalyze comparable games before treating their results as a single progress series. Labels and an aggregate score summarize performance; the error patterns identify what to practice.

## Verification before calling a first version complete

- Import a known account, handle a cached newest game and an invalid username, and avoid duplicate imports.
- Replay legal moves correctly, including castling, en passant, promotion, and terminal positions. Check evaluation direction for both colors and mate scores.
- Reproduce documented scoring boundaries for the selected independent method; check sound sacrifices against ordinary exchanges and unsound sacrifices if special labels are included.
- Show an actual mistake, a sound alternative, and a quiet planning position with evidence. Retry must accept equivalent good choices within the selected tolerance.
- Verify the installed plugin renders the MCP App in Codex beside conversation. Manually change positions while chat is idle, ask an ordinary question, and confirm the latest acknowledged context reaches the model. Then navigate and display a variation through a real semantic tool without computer use. Check UI acknowledgement, stale commands, multiple instances, reconnect/remount, disconnection, and returning to the original played line.
- Verify local persistence and assert that every displayed score and Codex-provided classification uses the canonical scoring result.
- Apply the relevant design-taste-frontend checks to the actual review interface. Inspect both color modes and smaller windows; verify legible controls, clear focus, loading/error states, usable board navigation, and absence of unrelated visible features.

## Build sequence after implementation is authorized

1. Prove local plugin loading, an embedded board, model-context updates, and a semantic tool changing that same board in the installed Codex host. If any required capability is unsupported, stop the full build and resolve that specific limitation.
2. Implement username import, legal game replay, local persistence, engine analysis, and the selected canonical scoring rules. Keep original games separate from explored variations.
3. Add the minimal guided review, retry, and coaching tools. Ground explanations in checked continuations and include quiet planning positions; use the host's native conversation.
4. Add compact score history and recurring-mistake feedback within the existing game/review flow. Verify native integration, chess correctness, score consistency, and the actual UI.

This is an implementation sequence, not authorization to start coding or installing the plugin. Current work is limited to the plan and architecture records.

## Remaining decisions and checks

1. Validate and freeze the proposed v1 scoring specification, source revisions, and benchmarked analysis budgets. Independent documented scoring is confirmed; identical Chess.com scores are not required. The proposed rules are concrete, but their outcomes remain untested.
2. Verify embedded MCP App rendering, native context updates, semantic tools, and local installation in Brian's actual Codex desktop host. The direction is selected; runtime support remains unverified.
3. Obtain implementation authorization before coding, dependency installation, or plugin/configuration changes.
