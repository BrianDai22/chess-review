---
status: superseded by ADR-0002
---

# Personal local review with discussion in Codex

The first version is a browser web app served locally on Brian's Mac and opens coaching conversations in Codex using his existing subscription instead of integrating a separately billed model API. Brian selected this over embedded chat to simplify the integration; the web app must prepare explicit game and position context, and the handoff must not imply live board synchronization or automatic sending. Public hosting and embedded model access would require revisiting this boundary.
