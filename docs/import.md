# Local persistence and Chess.com import

Implemented September 30, 2026. This module makes no model inference calls and uses no Chess.com credentials.

## Persistence contract

`src/store.mjs` uses Node 24's built-in `node:sqlite`. The checked runtime is Node v24.13.1; SQLite currently emits an experimental API warning to stderr. The default database is `~/Library/Application Support/Chess Review/chess-review.sqlite`. `CHESS_REVIEW_DATA_DIR` selects an explicit alternate directory. Installation and source updates must not replace this directory.

One SQLite database owns JSON records under these namespaces: `games`, `sessions`, `analyses`, `retries`, `settings`, and `http-cache`. Game records preserve the original PGN. This is a local storage format, not a public wire contract. SQLite WAL and a 10-second busy timeout coordinate host-managed stdio processes; `BEGIN IMMEDIATE` makes read/check/write operations atomic. No network or engine work may run inside a database transaction.

```js
const store = new Store({ dataDir }); // omit dataDir for normal persistent use
store.get(namespace, key);           // JSON value, or null
store.set(namespace, key, value);    // returns value
store.list(namespace);              // array of JSON values
store.update(namespace, key, old => next); // synchronous atomic check/write
store.transaction(store => result); // synchronous; rollback on error
store.getGame(id);
store.listGames();                  // newest completed game first
store.acquireLease(key, durationMs); // token, or null when another owner holds it
store.renewLease(key, token, durationMs);
store.releaseLease(key, token);
store.exportSnapshot('/absolute/export.json');
store.close();
```

Session callers validate the expected session and revision inside `update`; a stale request throws and preserves the current value. Background engine jobs should acquire a per-game lease, renew it while working, and check ownership before publishing a completed result. Leases survive process boundaries and expire after crashes; they are separate from committed review state.

`exportSnapshot` writes a versioned JSON export including PGNs, sessions, analyses, retry records, and settings. It excludes HTTP cache and transient leases. This is a recoverable data artifact; v1 does not add an automatic restore UI.

## Import contract

`new ChessComImporter(store).refresh({username})` refreshes the supplied username, or the remembered username when omitted. It remembers an explicit username only after a successful account/archive-list refresh. An invalid account or temporary failure preserves prior games and the previous remembered username. No username belonging to Brian is guessed or prefilled.

The importer reads the archive list, then the newest three available months by default. `months` can select 1–12 months. It imports only completed standard chess games containing a PGN, completion timestamp, both results, an official game URL, and a matching player. It identifies `playerColor` case-insensitively. The original PGN is unchanged; optional Chess.com `accuracies` are excluded from stored game records and never become local scores. Games are deduplicated by a stable SHA-256 ID derived from their game URL; existing games, original PGNs, and their attached analyses are preserved.

Requests run serially through a shared SQLite lease, including requests from separate stdio processes. Fresh `Cache-Control` responses avoid another request; expired responses send ETag and Last-Modified validators. HTTP 304 reuses the saved body; no-store responses do not persist a response body. HTTP 429 persists Retry-After; HTTP 410 is a durable tombstone. A listed monthly archive returning 404/410 is skipped and reported as unavailable so an older available archive can still import. Other fetch failures fail the refresh without deleting history. HTTPS archive URLs and redirects must stay on `api.chess.com`.

The returned status is `ready`, `no_games`, `unsupported_variants`, `publication_pending`, or `error`. Results contain imported/duplicate/unsupported/malformed counts, unavailable archives, the refresh time, and the last successful refresh where available. Publication may lag. `sourceLabel` and `rememberUsername:false` let verification use clearly marked public/fixture data without setting Brian's account.

The published API documents monthly completed-game archives, serial requests, and conditional cache validators. [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api).

## Verification evidence

`node --test tests/store.test.mjs tests/importer.test.mjs` passed 18 checks on Node v24.13.1. Coverage includes three separate concurrent Node writers with 120 preserved increments, SQLite restart, refusal to downgrade newer database formats, rollback, lease expiry/ownership, recoverable export, HTTP serialization through two SQLite connections, deduplication, both player colors, cache expiry, no-store and 304, 429/410, variants, incomplete games, unavailable newest archives, and preservation on network/404/500/invalid-JSON errors.

A live public API check on September 30 used `hikaru`, explicitly labeled “Public verification: hikaru (not Brian),” in a disposable directory. The listed September 2026 archive returned 404; August yielded 493 completed standard games. Repeating the refresh imported zero games, counted 493 duplicates, and made no additional HTTP requests. Both refreshes together made three requests. The remembered username remained null. No public verification games were left in Brian's durable database.
