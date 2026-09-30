---
status: superseded by ADR-0003
---

# Native chess tools and one authoritative scoring method

Brian requires Codex to read and manipulate the live review through native application tools, without computer use or manual context transfer. The design uses a local MCP connection to the same application state and chess operations used by the browser; a prepared-prompt handoff alone no longer meets the requirement. One locally computed scoring method supplies every game, dashboard, move classification, and coaching tool result, avoiding the conflicting score sources previously proposed. Live reads and revision checks provide fresh tool results and reject stale board commands; they do not claim that an idle model's context updates automatically. The numerical scoring formula remains to be selected.
