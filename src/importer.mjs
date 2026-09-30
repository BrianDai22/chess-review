import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const API = 'https://api.chess.com';
export class ImportError extends Error {
  constructor(code, message, { status, retryAt } = {}) {
    super(message); this.name = 'ImportError'; this.code = code; this.status = status; this.retryAt = retryAt;
  }
}
export function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(username)) throw new ImportError('invalid_username', 'Enter a Chess.com username using letters, numbers, underscores, or hyphens.');
  return username;
}
export const gameId = url => createHash('sha256').update(url).digest('hex').slice(0, 24);

function retryTime(header, now) {
  if (!header) return now + 60000;
  if (/^\d+$/.test(header)) return now + Number(header) * 1000;
  return Math.max(now, Date.parse(header) || now + 60000);
}
function freshness(headers, now) {
  const control = headers.get('cache-control') || '';
  if (/no-cache|no-store/i.test(control)) return now;
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control);
  if (maxAge) return now + Math.max(0, Number(maxAge[1]) - Number(headers.get('age') || 0)) * 1000;
  return Math.max(now, Date.parse(headers.get('expires') || '') || now);
}
function safeApiUrl(url) {
  const parsed = new URL(url);
  if (parsed.origin !== API || parsed.username || parsed.password) throw new ImportError('invalid_response', 'Chess.com returned an unsupported archive URL.');
  return parsed.href;
}

export class ChessComImporter {
  constructor(store, { fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 20000, wait = delay } = {}) {
    this.store = store; this.fetch = fetchImpl; this.now = now; this.timeoutMs = timeoutMs; this.wait = wait;
  }
  async request(url) {
    url = safeApiUrl(url);
    const deadline = this.now() + this.timeoutMs + 5000;
    let lease;
    while (!(lease = this.store.acquireLease('chess.com-http', this.timeoutMs + 5000))) {
      if (this.now() >= deadline) throw new ImportError('busy', 'Another Chess.com refresh is still running. Try again shortly.');
      await this.wait(50);
    }
    try {
      const cached = this.store.get('http-cache', url);
      if (cached?.status === 404 && cached.expiresAt > this.now()) throw new ImportError('not_found', 'Chess.com could not find this account or archive.', { status: 404 });
      if (cached?.status === 410) throw new ImportError('unavailable', 'This Chess.com archive is no longer available.', { status: 410 });
      if (cached?.retryAt > this.now()) throw new ImportError('rate_limited', 'Chess.com asked us to wait before refreshing.', { status: 429, retryAt: cached.retryAt });
      if (cached?.body && cached.expiresAt > this.now()) return { body: cached.body, cached: true };
      const headers = { accept: 'application/json', 'user-agent': 'ChessReviewLocal/0.1 (personal Codex plugin)' };
      if (cached?.etag) headers['if-none-match'] = cached.etag;
      if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
      let response;
      try {
        const signal = AbortSignal.timeout(this.timeoutMs);
        let requestUrl = url;
        for (let redirects = 0; redirects <= 3; redirects++) {
          response = await this.fetch(requestUrl, { headers, signal, redirect: 'manual' });
          if (![301, 302, 307, 308].includes(response.status)) break;
          if (redirects === 3) throw new Error('Too many redirects');
          requestUrl = safeApiUrl(new URL(response.headers.get('location'), requestUrl).href);
        }
      } catch (error) {
        if (error instanceof ImportError) throw error;
        throw new ImportError('network_error', 'Could not reach Chess.com. Your imported games are saved.');
      }
      const noStore = /no-store/i.test(response.headers.get('cache-control') || '');
      const metadata = {
        etag: response.headers.get('etag') || (response.status === 304 ? cached?.etag : null) || null,
        lastModified: response.headers.get('last-modified') || (response.status === 304 ? cached?.lastModified : null) || null,
        expiresAt: freshness(response.headers, this.now()), fetchedAt: this.now(), status: response.status,
      };
      if (response.status === 304 && cached?.body) {
        if (noStore) this.store.delete('http-cache', url);
        else this.store.set('http-cache', url, { ...cached, ...metadata, status: 200 });
        return { body: cached.body, cached: true };
      }
      if (response.status === 404) {
        this.store.set('http-cache', url, { ...metadata, status: 404 });
        throw new ImportError('not_found', 'Chess.com could not find this account or archive.', { status: 404 });
      }
      if (response.status === 410) {
        this.store.set('http-cache', url, { ...metadata, status: 410 });
        throw new ImportError('unavailable', 'This Chess.com account or archive is no longer available.', { status: 410 });
      }
      if (response.status === 429) {
        const retryAt = retryTime(response.headers.get('retry-after'), this.now());
        this.store.set('http-cache', url, { ...cached, ...metadata, retryAt });
        throw new ImportError('rate_limited', 'Chess.com asked us to wait before refreshing.', { status: 429, retryAt });
      }
      if (!response.ok) throw new ImportError('temporary_error', 'Chess.com could not refresh games right now. Your imported games are saved.', { status: response.status });
      let body;
      try { body = await response.json(); } catch { throw new ImportError('invalid_response', 'Chess.com returned an unreadable response. Your imported games are saved.'); }
      if (noStore) this.store.delete('http-cache', url);
      else this.store.set('http-cache', url, { ...metadata, body });
      return { body, cached: false };
    } finally { this.store.releaseLease('chess.com-http', lease); }
  }
  async refresh({ username, rememberUsername = true, months = 3, sourceLabel = 'Chess.com public archive' } = {}) {
    const name = normalizeUsername(username || this.store.get('settings', 'username'));
    const statusKey = `import:${name}`;
    const prior = this.store.get('settings', statusKey);
    const startedAt = this.now();
    try {
      const archiveResponse = await this.request(`${API}/pub/player/${encodeURIComponent(name)}/games/archives`);
      if (!Array.isArray(archiveResponse.body.archives)) throw new ImportError('invalid_response', 'Chess.com returned an invalid archive list.');
      const archives = [...new Set(archiveResponse.body.archives)].map(safeApiUrl)
        .filter(url => new RegExp(`^${API}/pub/player/${name}/games/\\d{4}/\\d{2}$`, 'i').test(url))
        .sort().reverse().slice(0, Math.max(1, Math.min(12, Math.trunc(months) || 3)));
      let imported = 0, duplicates = 0, unsupported = 0, malformed = 0, cached = archiveResponse.cached;
      const pending = [], unavailableArchives = [];
      for (const archive of archives) {
        let response;
        try { response = await this.request(archive); } catch (error) {
          if (error.status === 404 || error.status === 410) { unavailableArchives.push(archive); continue; }
          throw error;
        }
        cached ||= response.cached;
        if (!Array.isArray(response.body.games)) throw new ImportError('invalid_response', 'Chess.com returned an invalid game archive.');
        for (const raw of response.body.games) {
          if (raw.rules !== 'chess') { unsupported++; continue; }
          const playerColor = raw.white?.username?.toLowerCase() === name ? 'white' : raw.black?.username?.toLowerCase() === name ? 'black' : null;
          if (!playerColor || typeof raw.pgn !== 'string' || !raw.pgn.trim() || typeof raw.url !== 'string' || !Number.isFinite(raw.end_time) || !raw.white?.result || !raw.black?.result) { malformed++; continue; }
          let parsedUrl;
          try { parsedUrl = new URL(raw.url); } catch { malformed++; continue; }
          if (parsedUrl.protocol !== 'https:' || !['www.chess.com', 'chess.com'].includes(parsedUrl.hostname)) { malformed++; continue; }
          pending.push({
            id: gameId(raw.url), url: raw.url, pgn: raw.pgn, playerColor, importedFor: name,
            white: { username: raw.white.username, rating: raw.white.rating ?? null, result: raw.white.result },
            black: { username: raw.black.username, rating: raw.black.rating ?? null, result: raw.black.result },
            endTime: raw.end_time, timeControl: raw.time_control || '?', timeClass: raw.time_class || 'unknown',
            rated: Boolean(raw.rated), rules: 'chess', finalFen: raw.fen || null, sourceLabel, importedAt: this.now(),
          });
        }
      }
      const completedAt = this.now();
      return this.store.transaction(() => {
        for (const game of pending) {
          if (this.store.getGame(game.id)) { duplicates++; continue; }
          this.store.set('games', game.id, game); imported++;
        }
        if (rememberUsername) this.store.set('settings', 'username', name);
        const total = this.store.listGames().filter(game => game.importedFor === name).length;
        const result = { status: total ? 'ready' : unsupported ? 'unsupported_variants' : unavailableArchives.length ? 'publication_pending' : 'no_games', username: name, imported, duplicates, unsupported, malformed, total, cached, unavailableArchives, lastSuccessAt: completedAt, attemptedAt: startedAt,
          message: total ? unavailableArchives.length ? 'Some recent public archives are not available yet.' : null : unsupported ? 'Only unsupported chess variants were found in recent archives.' : 'No completed standard games are available in recent public archives yet.' };
        this.store.set('settings', statusKey, result);
        return result;
      });
    } catch (error) {
      const result = { ...prior, username: name, status: 'error', error: { code: error.code || 'unexpected_error', message: error.message, status: error.status, retryAt: error.retryAt }, attemptedAt: startedAt, lastSuccessAt: prior?.lastSuccessAt || null };
      this.store.set('settings', statusKey, result);
      return result;
    }
  }
}
