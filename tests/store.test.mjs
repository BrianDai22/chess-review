import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../src/store.mjs';

function setup(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'chess-store-'));
  const store = new Store({ dataDir, ...options });
  t.after(() => { try { store.close(); } catch {} rmSync(dataDir, { recursive: true, force: true }); });
  return { store, dataDir };
}
test('committed game, analysis, session, and retry survive a restart', t => {
  const { store, dataDir } = setup(t);
  for (const namespace of ['games', 'analyses', 'sessions', 'retries']) store.set(namespace, 'one', { id: 'one', revision: 3, pgn: 'original' });
  store.close();
  const reopened = new Store({ dataDir });
  t.after(() => reopened.close());
  assert.equal(reopened.getGame('one').pgn, 'original');
  for (const namespace of ['analyses', 'sessions', 'retries']) assert.equal(reopened.get(namespace, 'one').revision, 3);
});
test('atomic update rolls back failed or asynchronous transactions', t => {
  const { store } = setup(t);
  store.set('sessions', 's', { revision: 1 });
  assert.throws(() => store.transaction(() => { store.set('sessions', 's', { revision: 2 }); throw Error('failure'); }));
  assert.equal(store.get('sessions', 's').revision, 1);
  assert.throws(() => store.update('sessions', 's', state => { if (state.revision !== 0) throw Error('stale revision'); return state; }), /stale/);
  assert.throws(() => store.transaction(async () => {}), /synchronous/);
  assert.equal(store.update('sessions', 's', state => ({ revision: state.revision + 1 })).revision, 2);
});
test('lease ownership and expiry prevent concurrent job ownership', t => {
  let now = 100;
  const { store, dataDir } = setup(t, { now: () => now });
  const second = new Store({ dataDir, now: () => now });
  t.after(() => second.close());
  const token = store.acquireLease('analysis:g', 10);
  assert.ok(token);
  assert.equal(second.acquireLease('analysis:g', 10), null);
  assert.equal(second.releaseLease('analysis:g', 'other-token'), false);
  now = 111;
  const newToken = second.acquireLease('analysis:g', 10);
  assert.ok(newToken);
  assert.equal(store.renewLease('analysis:g', token), false);
  assert.equal(store.releaseLease('analysis:g', token), false);
  assert.equal(second.releaseLease('analysis:g', newToken), true);
});
test('separate Node processes do not lose concurrent durable updates', async t => {
  const { store, dataDir } = setup(t);
  const source = `import {Store} from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)}; const s=new Store({dataDir:process.env.TEST_STORE_DIR}); for(let i=0;i<40;i++) s.update('test','counter', n=>(n||0)+1); s.close();`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TEST_STORE_DIR: dataDir }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(stderr)));
  });
  await Promise.all([run(), run(), run()]);
  assert.equal(store.get('test', 'counter'), 120);
});
test('recoverable export contains original PGN and excludes HTTP cache', t => {
  const { store, dataDir } = setup(t);
  store.set('games', 'g', { id: 'g', pgn: 'original' });
  store.set('http-cache', 'private-cache', { body: {} });
  const path = join(dataDir, 'export.json');
  store.exportSnapshot(path);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.format, 'chess-review-export-v1');
  assert.deepEqual(data.objects, [{ namespace: 'games', key: 'g', value: { id: 'g', pgn: 'original' } }]);
});
test('an older plugin refuses a newer database format without downgrading it', t => {
  const { store, dataDir } = setup(t);
  store.db.exec('PRAGMA user_version=2');
  store.close();
  assert.throws(() => new Store({ dataDir }), /newer Chess Review version/);
});
