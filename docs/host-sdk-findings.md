# Native MCP App integration findings

Observed September 30, 2026. This records source and installed-host evidence. Rendering, context consumption, and semantic updates require separate live verification.

## Versions and package

The installed Plugin Creator skill is version 0.1.22. Its local-plugin path applies because the requested backend and engine run on this Mac. Author source in this repository, build a self-contained `chess-review/` package, install through the supported local marketplace, and reload rather than modifying the installed cache. Portable package metadata belongs in root `plugin.json` and `mcp.json`; use the compatibility manifest only when the installed client requires it.

The official OpenAI `node-v0.1.0` release declares Node >=22, `@openai/mcp-extensions` 0.1.0, peer MCP SDK ^1.29.0, and peer MCP Apps ^1.7.5. The selected exact MCP SDK 1.31.0 and MCP Apps 1.7.5 satisfy those peers. The release depends on Zod 4.4.3. Bundle the browser module and CSS into the HTML resource so the sandbox needs no external scripts, fonts, or stylesheets.

## Tool and resource registration

Use `registerAppTool` and `registerAppResource` from `@modelcontextprotocol/ext-apps/server`. The HTML resource MIME type is `RESOURCE_MIME_TYPE`, currently `text/html;profile=mcp-app`.

The opener accepts `{}` and supplies its initial state. Its human title should distinguish the view from the plugin, for example `Review Board`.

```js
_meta: {
  ui: {
    resourceUri: "ui://chess-review/review",
    visibility: ["app", "model"],
  },
  "openai/ui": {
    entrypoints: [{ type: "thread" }, { type: "global" }],
    preferredModelDisplayMode: "fullscreen",
  },
}
```

Use the thread entrypoint for the existing native conversation. The global entrypoint is a supported launch fallback, opening a conversation layout and permanent app tab. Static entrypoints ignore the tool visibility field. App-only synchronization tools use `ui.visibility: ["app"]` and have no entrypoint.

Place display preferences in each HTML resource content item's `_meta`:

```js
"openai/ui": {
  preferredDisplayMode: "fullscreen",
  availableDisplayModes: ["fullscreen"],
}
```

After connection inspect the returned host context. If fullscreen was requested but not selected, request it once only if advertised. Preferences are hints and do not prove panel placement.

## App bridge and acknowledgements

Create an `App` from `@modelcontextprotocol/ext-apps` and `OpenAIExtensions` from `@openai/mcp-extensions/app`. Register `app.ontoolresult` before `app.connect()` and render its `structuredContent`. Do not repeat the opener from the mounted view.

Manual controls call `app.callServerTool({ name, arguments })`, commit through the canonical backend, render the returned session/revision, then publish context. The mounted view has one bounded app-only sync request in flight and publishes only changes. Give every mount an independent random ID and preserve explicit session IDs across every call.

After initialization, `extensions.modelContext` can remain undefined when unsupported. `extensions.modelContext.update({ content, structuredContent })` calls `ui/update-model-context` and parses `_meta["openai/modelContext"].updateId`. That ID proves host attachment acceptance. It proves neither backend commit nor model consumption. A separate app-only backend acknowledgement records the displayed revision and accepted context update ID. Do not record context acceptance before the await resolves, do not let delayed responses replace newer rendered revisions, and do not call a change displayed before a live mount acknowledges it.

Use the advertised `extensions.message.send({ role: "user", content, _meta: { "openai/message": { target: "active", send: true } } })`, or standard `app.sendMessage` when the host advertises text-message support, only for an explicit Explain action after publishing and awaiting current context. The extension wraps the same MCP Apps message bridge; it is advertised through `experimental["openai/message"]`. Navigation by itself does not start a model turn. Production coaching uses semantic chess tools and native chat, with no separate model endpoint.

The native model publishes a short `publish_coaching_note` only after reading the requested position and checked evidence. Notes live in their own store namespace and carry exact session, game, revision, FEN, ply, and variation identity. They do not change the selected position or canonical score. App-only sync returns fresh context even for unchanged revisions, so new notes appear without a navigation mutation. Notes disappear after position changes or while answers are hidden.

## Theme and minimal presentation

On connection and every `hostcontextchanged` event, apply `applyDocumentTheme(context.theme)` and `applyHostStyleVariables(context.styles.variables)`. Bundle `@openai/mcp-extensions/app/styles.css` or the applicable native control styles. Preserve visible focus, accessible button names, keyboard board/navigation actions, and a whole-app automatic host theme.

The requested interface is a compact learning workspace: one prominent board, username/game picker, navigation/evaluation, canonical labels/accuracy, key moments, retry, and small saved-mistake feedback. Native chat supplies explanations. The selected design-taste skill's marketing layouts and image requirements do not apply to this scope.

Following direct feedback on the first probe's appearance, the board uses the maintained `@lichess-org/chessground` component pinned to 10.4.1. Bundle its `assets/chessground.base.css` and `assets/chessground.cburnett.css` before application styles. The cBurnett file contains twelve inline SVG piece images and needs no remote image hosting. Legal clicks and drags commit through the existing semantic tools: ordinary moves create a variation, retry moves submit an explicitly guarded attempt, and promotion requires a piece choice. The component restores canonical FEN while awaiting the backend, disables movement before authoritative synchronization or during pending work, and never writes the original PGN. Updating `ground.set({fen, orientation, turnColor})` renders returned state. Coordinates appear at the edges, with accessible piece descriptions and SAN/UCI input. The board width is capped by the 560-pixel inner workspace and constrained by available viewport height. Actual native rendering of the bundled SVG board was observed in the September 30 installed host. The later board-first redesign and direct move interaction are verified separately in the verification record.

## Installed host evidence

The running desktop bundle is `/Applications/ChatGPT.app`, bundle version `26.928.21956`, build `12404`; it contains the Codex surface. Read-only inspection of its `app.asar` found:

- `thread-app-shell-chrome-9a84c333f674.js` includes local server tools with `entrypoint.type === "thread"` among current conversation content-tab launch actions.
- `app-initial-135a4ef2552c.js` parses `_meta["openai/ui"].entrypoints` and requires a `ui://` app resource for launch.
- `thread-mcp-app-side-panel-tab-a68c8e6ebbf3.js` renders a mounted MCP App side-panel frame with a tab title, width control, and close control.
- `resource-9e26e1dcc06a.js` accepts resource fullscreen preferences and the MCP App HTML MIME type.
- `widget-4027197e5a6d.js` implements `tools/call` forwarding, conditional `updateModelContext` host capability, and `ui/update-model-context`. The context handler requires an available composer, rejects inactive widget sources, and can return the OpenAI context update ID.

These code paths establish implementation presence, not successful installation or runtime availability. The narrow live check passed actual board rendering, manual selection of 1.e4, the next ordinary native question identifying Black to move and the pawn on e4, and semantic show_variation displaying e5/Nf3 on that same mount. Two native sessions remained isolated. Reopening the global review restored its saved selection; final updated-resource remount evidence is recorded separately. Existing chats and open app frames can retain their pre-update server/resource snapshot.

## Sidebar icon

The global entrypoint icon is separate from plugin manifest logo/composerIcon. Read-only inspection of installed app-initial code shows local entrypoints choose tool icons, then MCP serverInfo icons. The pinned high-level MCP SDK does not expose tool icons in registerTool, but its standard Implementation metadata supports server icons. The server therefore advertises the contained pawn SVG as a data URI in serverInfo.icons; manifest fields retain the matching asset for plugin listing and composer. Real stdio discovery verifies the advertised icon. Actual native inspection confirmed the pawn in the sidebar, board tab, opener and context attachment after a fresh plugin launch.

## Primary references

- [Pinned OpenAI TypeScript SDK](https://github.com/openai/mcp-extensions/blob/node-v0.1.0/typescript/README.md)
- [Pinned OpenAI Extensions specification](https://github.com/openai/mcp-extensions/blob/node-v0.1.0/docs/spec.md)
- [Pinned app context acknowledgement implementation](https://github.com/openai/mcp-extensions/blob/node-v0.1.0/typescript/src/app/model-context.ts)
- [Pinned UI metadata schemas](https://github.com/openai/mcp-extensions/blob/node-v0.1.0/typescript/src/server/ui.ts)
- [Pinned MCP Apps app API](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.5/src/app.ts)
- [Pinned Chessground configuration](https://github.com/lichess-org/chessground/blob/v10.4.1/src/config.ts)
- [Pinned Chessground license and usage](https://github.com/lichess-org/chessground/blob/v10.4.1/README.md)
- [Installed local Plugin Creator guide](/Users/briandai/.codex/plugins/cache/openai-curated-remote/plugin-creator/0.1.22/skills/create-plugin/references/local-plugins.md)
