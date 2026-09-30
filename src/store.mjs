import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaultDataDir = () => process.env.CHESS_REVIEW_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'Chess Review');

/** One durable authority. Synchronous transactions cannot span asynchronous engine/network work. */
export class Store {
  constructor({ dataDir = defaultDataDir(), now = Date.now } = {}) {
    this.dataDir = dataDir;
    this.now = now;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.path = join(dataDir, 'chess-review.sqlite');
    this.db = new DatabaseSync(this.path);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('This database requires a newer Chess Review version.'); }
    this.db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS objects (
        namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        updated_at INTEGER NOT NULL, PRIMARY KEY(namespace, key));
      CREATE TABLE IF NOT EXISTS leases (
        key TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
      `);
    if (version === 0) this.db.exec('PRAGMA user_version=1');
    this.inTransaction = false;
  }
  get(namespace, key) {
    const row = this.db.prepare('SELECT value FROM objects WHERE namespace=? AND key=?').get(namespace, key);
    return row ? JSON.parse(row.value) : null;
  }
  set(namespace, key, value) {
    if (value === undefined) throw new TypeError('Cannot persist undefined');
    this.db.prepare(`INSERT INTO objects(namespace,key,value,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(namespace, key, JSON.stringify(value), this.now());
    return value;
  }
  delete(namespace, key) {
    return this.db.prepare('DELETE FROM objects WHERE namespace=? AND key=?').run(namespace, key).changes > 0;
  }
  list(namespace) {
    return this.db.prepare('SELECT value FROM objects WHERE namespace=? ORDER BY key').all(namespace).map(row => JSON.parse(row.value));
  }
  transaction(fn) {
    if (this.inTransaction) {
      const nested = fn(this);
      if (nested && typeof nested.then === 'function') throw new TypeError('Store transactions must be synchronous');
      return nested;
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const result = fn(this);
      if (result && typeof result.then === 'function') throw new TypeError('Store transactions must be synchronous');
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally { this.inTransaction = false; }
  }
  update(namespace, key, fn) {
    return this.transaction(() => {
      const next = fn(this.get(namespace, key));
      if (next === undefined) throw new TypeError('Update callback must return a value');
      return this.set(namespace, key, next);
    });
  }
  acquireLease(key, durationMs = 30000) {
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT expires_at FROM leases WHERE key=?').get(key);
      if (existing && existing.expires_at > this.now()) return null;
      const token = randomUUID();
      this.db.prepare(`INSERT INTO leases(key,token,expires_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at`)
        .run(key, token, this.now() + durationMs);
      return token;
    });
  }
  renewLease(key, token, durationMs = 30000) {
    return this.db.prepare('UPDATE leases SET expires_at=? WHERE key=? AND token=? AND expires_at>?')
      .run(this.now() + durationMs, key, token, this.now()).changes > 0;
  }
  releaseLease(key, token) {
    return this.db.prepare('DELETE FROM leases WHERE key=? AND token=?').run(key, token).changes > 0;
  }
  getGame(id) { return this.get('games', id); }
  listGames() { return this.list('games').sort((a, b) => (b.endTime || 0) - (a.endTime || 0)); }
  exportSnapshot(path) {
    const snapshot = this.transaction(() => ({ format: 'chess-review-export-v1', exportedAt: new Date(this.now()).toISOString(), objects:
      this.db.prepare('SELECT namespace,key,value FROM objects ORDER BY namespace,key').all()
        .filter(row => row.namespace !== 'http-cache').map(row => ({ namespace: row.namespace, key: row.key, value: JSON.parse(row.value) })) }));
    writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
    return snapshot;
  }
  close() { this.db.close(); }
}
