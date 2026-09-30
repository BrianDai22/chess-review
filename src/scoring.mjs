// Accuracy calculation adapted from Lichess lila, AGPL-3.0-or-later.
// See docs/third-party-notices.md for precise upstream revisions and licenses.
export const SCORING_VERSION = 'independent-lichess-v1';
export const SCORING_SOURCES = Object.freeze({
  lila: 'fbecdb9b1a81553ee254f5a41de98eeba56bf405',
  scalachess: '57d3483869abde8a7dbd867520fe78f8f7e87d79',
  scalalib: 'ea1aae727b3b9bdc2f506f12d4991fe3ed8e8b44',
});
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
const exact = e => e?.ready === true && e.exact === true && !e.bound && e.canonicalEligible !== false && (Number.isFinite(e.cp) || Number.isFinite(e.mate));

export function whiteWinPercent(evaluation) {
  if (!evaluation || (!Number.isFinite(evaluation.cp) && !Number.isFinite(evaluation.mate))) return null;
  let cp = evaluation.cp;
  if (!Number.isFinite(cp)) {
    if (evaluation.mate === 0 && !['w', 'b'].includes(evaluation.winner)) return null;
    cp = evaluation.mate === 0 ? (evaluation.winner === 'w' ? 1000 : -1000) : (evaluation.mate > 0 ? 1000 : -1000);
  }
  return 100 / (1 + Math.exp(-0.00368208 * clamp(cp, -1000, 1000)));
}
export function winPercent(evaluation, color = 'w') {
  if (!['w', 'b'].includes(color)) throw new Error('Invalid player color');
  const white = whiteWinPercent(evaluation);
  return white === null ? null : color === 'w' ? white : 100 - white;
}
export function moveAccuracy(beforeW, afterW) {
  if (![beforeW, afterW].every(x => Number.isFinite(x) && x >= 0 && x <= 100)) return null;
  return afterW >= beforeW ? 100 : clamp(103.1668100711649 * Math.exp(-0.04354415386753951 * (beforeW - afterW)) - 3.166924740191411 + 1, 0, 100);
}

// evals are white-oriented assessments AFTER each played ply. No partial aggregate.
export function gameAccuracy(evals, { startColor = 'w', initial = { cp: 15, ready: true, exact: true } } = {}) {
  if (!['w', 'b'].includes(startColor)) throw new Error('Invalid starting color');
  if (!evals.length || !exact(initial) || evals.some(e => !exact(e))) return null;
  const all = [initial, ...evals].map(whiteWinPercent);
  if (all.includes(null)) return null;
  const windowSize = clamp(Math.floor(evals.length / 10), 2, 8);
  const windows = Array.from({ length: Math.min(windowSize, all.length) - 2 }, () => all.slice(0, windowSize));
  for (let i = 0; i <= all.length - windowSize; i++) windows.push(all.slice(i, i + windowSize));
  const weights = windows.map(window => {
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    return clamp(Math.sqrt(window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length), 0.5, 12);
  });
  const byColor = { w: [], b: [] };
  for (let i = 0; i < evals.length; i++) {
    const color = i % 2 === 0 ? startColor : (startColor === 'w' ? 'b' : 'w');
    const before = color === 'w' ? all[i] : 100 - all[i];
    const after = color === 'w' ? all[i + 1] : 100 - all[i + 1];
    byColor[color].push([moveAccuracy(before, after), weights[i]]);
  }
  return Object.fromEntries(Object.entries(byColor).map(([color, values]) => {
    if (!values.length) return [color, null];
    const weighted = values.reduce((s, [a, w]) => s + a * w, 0) / values.reduce((s, [, w]) => s + w, 0);
    const harmonic = values.length / values.reduce((s, [a]) => s + 1 / Math.max(1, a), 0);
    return [color, (weighted + harmonic) / 2];
  }));
}
export function ordinaryGrade(loss) {
  if (!Number.isFinite(loss) || loss < 0) throw new Error('Invalid evaluation loss');
  return loss < 2 ? 'Excellent' : loss < 5 ? 'Good' : loss < 10 ? 'Inaccuracy' : loss < 20 ? 'Mistake' : 'Blunder';
}
function mateWinner(e) { return e.mate === 0 ? e.winner : e.mate > 0 ? 'w' : 'b'; }
function sameVerifiedOutcome(reference, candidate) {
  if (Number.isFinite(reference.mate)) return Number.isFinite(candidate.mate) && mateWinner(reference) === mateWinner(candidate);
  return !Number.isFinite(candidate.mate);
}
function specialPass(kind, evidence, { beforeW, afterW, loss, legalMoveCount }) {
  if (!evidence || evidence.complete !== true || evidence.legalMoveCount !== legalMoveCount) return false;
  if (![evidence.beforeW, evidence.afterW].every(w => Number.isFinite(w) && w >= 0 && w <= 100)) return false;
  beforeW = evidence.beforeW;
  afterW = evidence.afterW;
  loss = Math.max(0, beforeW - afterW);
  if (kind === 'Brilliant') return loss < 2 && afterW >= 45 && beforeW < 90 && legalMoveCount >= 2
    && ['n', 'b', 'r', 'q'].includes(evidence.offeredPiece)
    && evidence.immediateLegalCaptures > 0 && evidence.acceptances?.length === evidence.immediateLegalCaptures
    && evidence.acceptances.every(a => a.exact === true && a.netMaterialConcession >= 2 && a.afterW >= 45 && a.losingMate === false);
  if (kind === 'Great') {
    const alternatives = evidence.alternatives;
    if (loss >= 2 || legalMoveCount < 2) return false;
    let strongest;
    if (evidence.alternativeSearch) {
      const search = evidence.alternativeSearch;
      if (evidence.remainingMoves?.length !== legalMoveCount - 1 || new Set(evidence.remainingMoves).size !== legalMoveCount - 1
        || search.exact !== true || !Number.isFinite(search.afterW) || !evidence.remainingMoves.includes(search.bestMove)) return false;
      strongest = search.afterW;
    } else {
      if (alternatives?.length !== legalMoveCount - 1 || alternatives.some(a => a.exact !== true || !Number.isFinite(a.afterW))) return false;
      strongest = Math.max(...alternatives.map(a => a.afterW));
    }
    return afterW - strongest >= 15 && ((afterW >= 45 && strongest <= 30) || (afterW >= 75 && strongest <= 60));
  }
  return kind === 'Miss' && evidence.previousAvailableW <= 60 && beforeW >= 75 && afterW <= 60 && loss >= 15
    && evidence.opponentGiftChecked === true && evidence.missedContinuation?.length > 0;
}
export function scoreMove({ before, after, best, playedMove, color, bestStable = false, legalMoveCount, special = {} }) {
  if (!exact(before) || !exact(after) || !exact(best) || !Number.isInteger(legalMoveCount) || legalMoveCount < 1) return { ready: false, scoringVersion: SCORING_VERSION, label: null, accuracy: null };
  const profileIds = [before.profileId, after.profileId, best.profileId].filter(Boolean);
  if (new Set(profileIds).size > 1) return { ready: false, scoringVersion: SCORING_VERSION, label: null, accuracy: null };
  const beforeW = winPercent(before, color), afterW = winPercent(after, color), bestW = winPercent(best, color);
  if ([beforeW, afterW, bestW].includes(null)) return { ready: false, scoringVersion: SCORING_VERSION, label: null, accuracy: null };
  const loss = Math.max(0, beforeW - afterW);
  let grade = ordinaryGrade(loss);
  const matePosition = Number.isFinite(best.mate) || Number.isFinite(before.mate);
  const checkedNearBest = !matePosition && Number.isFinite(best.cp) && Number.isFinite(after.cp)
    && Math.abs(best.cp - after.cp) <= 10 && Math.abs(bestW - afterW) <= 0.5;
  if (bestStable && sameVerifiedOutcome(best, after) && (playedMove === best.bestMove || checkedNearBest)) grade = 'Best';
  let label = grade;
  const details = { beforeW, afterW, loss, legalMoveCount };
  for (const kind of ['Brilliant', 'Great', 'Miss']) {
    const ordinary = special.ordinary?.[kind], refinement = special.refinement?.[kind];
    if (specialPass(kind, ordinary, details) && specialPass(kind, refinement, details)
      && specialPass(kind, { ...ordinary, beforeW, afterW }, details)) { label = kind; break; }
  }
  return { ready: true, scoringVersion: SCORING_VERSION, ordinaryGrade: grade, label, loss, beforeW, afterW, accuracy: moveAccuracy(beforeW, afterW) };
}
export function retryAccepted({ reference, attempt, color, requiredOutcome }) {
  if (!exact(reference) || !exact(attempt)) return { ready: false, accepted: false };
  const beforeW = winPercent(reference, color), afterW = winPercent(attempt, color);
  if (beforeW === null || afterW === null) return { ready: false, accepted: false };
  const loss = Math.max(0, beforeW - afterW);
  let preservesOutcome = true;
  if (requiredOutcome === 'mate') preservesOutcome = Number.isFinite(reference.mate) && sameVerifiedOutcome(reference, attempt);
  else if (requiredOutcome === 'draw') preservesOutcome = attempt.terminal === 'draw' || attempt.terminal === 'repetition' || attempt.verifiedOutcome === 'draw';
  return { ready: true, accepted: loss < 2 && preservesOutcome, loss, preservesOutcome };
}
