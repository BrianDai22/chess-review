import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { ChessComImporter, normalizeUsername } from '../src/importer.mjs';

const archiveList = 'https://api.chess.com/pub/player/fixture-player/games/archives';
const latest = 'https://api.chess.com/pub/player/fixture-player/games/2026/09';
const older = 'https://api.chess.com/pub/player/fixture-player/games/2026/08';
const game = (id = '123', extras = {}) => ({ url: `https://www.chess.com/game/live/${id}`, pgn: '[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0', end_time: 1700000000, rules: 'chess', time_control: '600', time_class: 'rapid', white: { username: 'Fixture-Player', result: 'win' }, black: { username: 'opponent', result: 'checkmated' }, accuracies: { white: 99 }, ...extras });
const response = (body, status = 200, headers = {}) => new Response(status === 304 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function setup(t, fetchImpl, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'chess-import-'));
  const store = new Store({ dataDir, now: options.now });
  const importer = new ChessComImporter(store, { fetchImpl, ...options });
  t.after(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { store, importer, dataDir };
}
const refreshFixture = importer => importer.refresh({ username: 'Fixture-Player', rememberUsername: false, sourceLabel: 'Fixture data' });
test('normalizes explicit username and rejects path injection', () => {
  assert.equal(normalizeUsername('  Some-Player  '), 'some-player');
  assert.throws(() => normalizeUsername('../secrets'), /Enter a Chess.com username/);
  assert.throws(() => normalizeUsername(''), /Enter a Chess.com username/);
});
test('newest archives first, URL dedup, color, PGN, and no imported accuracy', async t => {
  const calls = [];
  const { store, importer } = setup(t, async url => {
    calls.push(url);
    return response(url === archiveList ? { archives: [older, latest] } : { games: [game()] });
  });
  const result = await refreshFixture(importer);
  assert.equal(result.status, 'ready'); assert.equal(result.imported, 1); assert.equal(result.duplicates, 1);
  assert.deepEqual(calls, [archiveList, latest, older]);
  const saved = store.listGames()[0];
  assert.equal(saved.playerColor, 'white'); assert.equal(saved.pgn, game().pgn); assert.equal(saved.sourceLabel, 'Fixture data');
  assert.equal(saved.accuracies, undefined); assert.equal(store.get('settings', 'username'), null);
  await refreshFixture(importer);
  assert.equal(store.listGames().length, 1);
});
test('remembers only supplied username after a successful account refresh', async t => {
  const { store, importer } = setup(t, async url => response(url === archiveList ? { archives: [latest] } : { games: [game()] }));
  await importer.refresh({ username: 'Fixture-Player' });
  assert.equal(store.get('settings', 'username'), 'fixture-player');
  assert.equal((await importer.refresh()).status, 'ready');
});
test('max-age avoids requests and expired cache revalidates with ETag and Last-Modified', async t => {
  let now = 100000, calls = 0;
  const { importer } = setup(t, async (_url, init) => {
    calls++;
    if (calls === 1) return response({ archives: [] }, 200, { 'cache-control': 'max-age=60', etag: 'abc', 'last-modified': 'yesterday' });
    assert.equal(init.headers['if-none-match'], 'abc'); assert.equal(init.headers['if-modified-since'], 'yesterday');
    return response(null, 304, { 'cache-control': 'max-age=120' });
  }, { now: () => now });
  await refreshFixture(importer); await refreshFixture(importer); assert.equal(calls, 1);
  now += 61000;
  assert.equal((await refreshFixture(importer)).cached, true);
  await refreshFixture(importer); assert.equal(calls, 2);
});
test('network, 404, 500, and malformed JSON preserve history and last successful refresh', async t => {
  let failure = null;
  const { store, importer } = setup(t, async url => {
    if (failure === 'network') throw Error('offline');
    if (failure === 'json') return new Response('not-json', { status: 200 });
    if (failure) return response({}, failure);
    return response(url === archiveList ? { archives: [latest] } : { games: [game()] });
  });
  const successful = await refreshFixture(importer);
  for (const value of ['network', 404, 500, 'json']) {
    failure = value;
    const result = await refreshFixture(importer);
    assert.equal(result.status, 'error'); assert.equal(result.lastSuccessAt, successful.lastSuccessAt);
    assert.equal(store.listGames().length, 1); assert.equal(store.listGames()[0].pgn, game().pgn);
  }
});
test('429 Retry-After persists a wait across importer instances', async t => {
  let now = 100000, calls = 0;
  const fetchImpl = async () => { calls++; return response({}, 429, { 'retry-after': '30' }); };
  const { store, importer } = setup(t, fetchImpl, { now: () => now });
  assert.equal((await refreshFixture(importer)).error.code, 'rate_limited');
  const second = new ChessComImporter(store, { fetchImpl, now: () => now });
  assert.equal((await refreshFixture(second)).error.retryAt, 130000); assert.equal(calls, 1);
  now = 131000; await refreshFixture(second); assert.equal(calls, 2);
});
test('410 tombstone is not fetched again', async t => {
  let calls = 0;
  const { importer } = setup(t, async () => { calls++; return response({}, 410); });
  await refreshFixture(importer); await refreshFixture(importer); assert.equal(calls, 1);
});
test('distinguishes no completed games and unsupported variants; identifies black', async t => {
  let games = [];
  const { store, importer } = setup(t, async url => response(url === archiveList ? { archives: [latest] } : { games }));
  assert.equal((await refreshFixture(importer)).status, 'no_games');
  games = [game('960', { rules: 'chess960' })];
  assert.equal((await refreshFixture(importer)).status, 'unsupported_variants');
  games = [game('black', { white: { username: 'opponent', result: 'win' }, black: { username: 'FIXTURE-PLAYER', result: 'resigned' } })];
  assert.equal((await refreshFixture(importer)).status, 'ready'); assert.equal(store.listGames()[0].playerColor, 'black');
});
test('requests serialize across two separate SQLite connections', async t => {
  let active = 0, maxActive = 0;
  const fetchImpl = async url => {
    active++; maxActive = Math.max(maxActive, active);
    await delay(15); active--;
    return response(url === archiveList ? { archives: [latest] } : { games: [game()] });
  };
  const { store, importer, dataDir } = setup(t, fetchImpl);
  const secondStore = new Store({ dataDir }); t.after(() => secondStore.close());
  const second = new ChessComImporter(secondStore, { fetchImpl });
  const results = await Promise.all([refreshFixture(importer), refreshFixture(second)]);
  assert.ok(results.every(result => result.status === 'ready'));
  assert.equal(maxActive, 1); assert.equal(store.listGames().length, 1);
});
test('rejects foreign archive URLs and incomplete games without losing prior games', async t => {
  let badArchive = false;
  const { store, importer } = setup(t, async url => response(url === archiveList ? { archives: [badArchive ? 'https://evil.invalid/data' : latest] } : { games: [game(), game('incomplete', { end_time: undefined })] }));
  assert.equal((await refreshFixture(importer)).malformed, 1);
  badArchive = true;
  assert.equal((await refreshFixture(importer)).error.code, 'invalid_response'); assert.equal(store.listGames().length, 1);
});
test('unpublished newest archive does not prevent importing an older completed archive', async t => {
  const { store, importer } = setup(t, async url => response(url === archiveList ? { archives: [older, latest] } : { games: [game()] }, url === latest ? 404 : 200));
  const result = await refreshFixture(importer);
  assert.equal(result.status, 'ready'); assert.equal(result.imported, 1);
  assert.deepEqual(result.unavailableArchives, [latest]); assert.equal(store.listGames().length, 1);
});
test('no-store responses are not persisted; fresh payload removes obsolete validators', async t => {
  let calls = 0;
  const { store, importer } = setup(t, async (_url, options) => {
    calls++;
    if (calls === 1) return response({ archives: [] }, 200, { etag: 'old' });
    if (calls === 2) { assert.equal(options.headers['if-none-match'], 'old'); return response({ archives: [] }); }
    assert.equal(options.headers['if-none-match'], undefined);
    return response({ archives: [] }, 200, { 'cache-control': 'no-store' });
  });
  await refreshFixture(importer); await refreshFixture(importer); await refreshFixture(importer);
  assert.equal(store.get('http-cache', archiveList), null);
});
