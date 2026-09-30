import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Chess, DEFAULT_POSITION } from 'chess.js';

export const ENGINE_PROFILE = Object.freeze({
  id: 'stockfish19-n100k-r400k-t1-h16-v1', engine: 'Stockfish 19',
  sourceRevision: 'edb0d9db6731067ec50ce619ff372b463bc4dd5d',
  binarySha256: '8eed61129d1493c5d1f2fd9323f0c54c47ac49319911fbde18c6b9c87e8b13c5',
  nnue: 'nn-1a298aa575a0.nnue', nnueSha256: '1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2', threads: 1, hashMb: 16,
  ordinaryNodes: 100_000, refinementNodes: 400_000,
});
const defaultBinary = fileURLToPath(new URL('../.runtime/stockfish/stockfish/stockfish-macos-universal', import.meta.url));

export function replayPosition(initialFen = DEFAULT_POSITION, moves = []) {
  const chess = new Chess(initialFen);
  for (const move of moves) {
    if (!/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(move)) throw new Error('Expected legal UCI move history');
    chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  }
  return chess;
}

export class Engine {
  constructor({ binary = process.env.CHESS_REVIEW_STOCKFISH || defaultBinary, timeoutMs = 30_000 } = {}) {
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.identityPromise = null;
  }
  async identity() {
    this.identityPromise ??= readFile(this.binary).then(bytes => {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== ENGINE_PROFILE.binarySha256) throw new Error('Engine binary differs from the frozen scoring profile');
      return { ...ENGINE_PROFILE, binarySha256: sha256 };
    });
    return this.identityPromise;
  }
  async analyze({ initialFen = DEFAULT_POSITION, moves = [], profile = 'ordinary', searchMoves = [], signal, nodes } = {}) {
    await this.identity();
    if (!['ordinary', 'refinement'].includes(profile)) throw new Error('Unknown engine profile');
    const chess = replayPosition(initialFen, moves);
    const legal = chess.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
    if (searchMoves.some(m => !legal.includes(m))) throw new Error('Illegal root search move');
    const budget = nodes ?? (profile === 'ordinary' ? ENGINE_PROFILE.ordinaryNodes : ENGINE_PROFILE.refinementNodes);
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Invalid node budget');
    const canonicalEligible = budget === (profile === 'ordinary' ? ENGINE_PROFILE.ordinaryNodes : ENGINE_PROFILE.refinementNodes);
    const evidence = { profileId: canonicalEligible ? ENGINE_PROFILE.id : `${ENGINE_PROFILE.id}:exploratory-n${budget}`, canonicalEligible,
      profile, budget, fen: chess.fen(), initialFen, moves: [...moves], sideToMove: chess.turn(), exact: true };
    if (chess.isCheckmate()) return { ...evidence, ready: true, terminal: 'checkmate', mate: 0, winner: chess.turn() === 'w' ? 'b' : 'w', bestMove: null, pv: [], nodes: 0, depth: 0 };
    if (chess.isDraw()) return { ...evidence, ready: true, terminal: chess.isThreefoldRepetition() ? 'repetition' : 'draw', cp: 0, bestMove: null, pv: [], nodes: 0, depth: 0 };
    if (signal?.aborted) throw new Error('Analysis interrupted');
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '', stderr = '', last = null, settled = false, searching = false;
      const send = command => child.stdin.write(command + '\n');
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        child.kill();
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(new Error('Analysis interrupted'));
      const timer = setTimeout(() => finish(new Error('Engine analysis timed out')), this.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', error => finish(error));
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      child.on('exit', code => { if (!settled) finish(new Error(`Engine exited before completing analysis (${code}): ${stderr}`)); });
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          if (line === 'uciok') {
            send('setoption name Threads value 1'); send('setoption name Hash value 16');
            send('setoption name MultiPV value 1'); send('setoption name Skill Level value 20');
            send('setoption name UCI_LimitStrength value false'); send('ucinewgame');
            send('setoption name Clear Hash'); send('isready');
          } else if (line === 'readyok' && !searching) {
            searching = true;
            send(`position ${initialFen === DEFAULT_POSITION ? 'startpos' : 'fen ' + initialFen}${moves.length ? ' moves ' + moves.join(' ') : ''}`);
            send(`go nodes ${budget}${searchMoves.length ? ' searchmoves ' + searchMoves.join(' ') : ''}`);
          } else if (line.startsWith('info ') && / score (cp|mate) -?\d+/.test(line) && / pv /.test(line)) {
            const score = line.match(/ score (cp|mate) (-?\d+)(?: (upperbound|lowerbound))?/);
            const povSign = chess.turn() === 'w' ? 1 : -1;
            last = { [score[1]]: Number(score[2]) * povSign, exact: !score[3], bound: score[3] || null,
              depth: Number(line.match(/ depth (\d+)/)?.[1] || 0), nodes: Number(line.match(/ nodes (\d+)/)?.[1] || 0),
              pv: line.split(' pv ')[1].split(/\s+/) };
          } else if (line.startsWith('bestmove ')) {
            const bestMove = line.split(/\s+/)[1];
            if (!last || !legal.includes(bestMove)) { finish(new Error('Engine returned no usable legal evaluation')); continue; }
            try { replayPosition(initialFen, [...moves, ...last.pv]); }
            catch { finish(new Error('Engine returned an illegal continuation')); continue; }
            finish(null, { ...evidence, ...last, ready: last.exact, bestMove, elapsedMs: performance.now() - started });
          }
        }
      });
      send('uci');
    });
  }
}
