import test from 'node:test';
import assert from 'node:assert/strict';
import { whiteWinPercent, moveAccuracy, gameAccuracy, ordinaryGrade, scoreMove, retryAccepted } from '../src/scoring.mjs';
const evalCp = cp => ({ cp, ready: true, exact: true });
const evalW = w => evalCp(Math.log(w / (100 - w)) / 0.00368208);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
function score({ beforeW = 65, afterW = 64, legalMoveCount = 3, special = {}, ...rest } = {}) {
  return scoreMove({ before: evalW(beforeW), after: evalW(afterW), best: { ...evalW(beforeW), bestMove: 'e2e4' }, playedMove: 'd2d4', color: 'w', legalMoveCount, special, ...rest });
}
test('full Lichess conversion, mate zero winner, clipping, and uncertainty allowance', () => {
  close(whiteWinPercent(evalCp(0)), 50);
  close(whiteWinPercent(evalCp(100000)), whiteWinPercent(evalCp(1000)));
  close(whiteWinPercent({ mate: 7 }), whiteWinPercent(evalCp(1000)));
  close(whiteWinPercent({ mate: -7 }), whiteWinPercent(evalCp(-1000)));
  close(whiteWinPercent({ mate: 0, winner: 'w' }), whiteWinPercent(evalCp(1000)));
  assert.equal(whiteWinPercent({ mate: 0 }), null);
  assert.equal(moveAccuracy(50, 50), 100);
  close(moveAccuracy(60, 50), 64.57982845372067);
});
test('aggregation matches independent Python golden, including window weighting and harmonic floor', () => {
  const cps = [15,30,-70,10,300,-250,800,-1000,0,35,80,40,32,60,-5,-40,150,300,270,110,200,50,10,0,20,45,60,70,55,30,80,110,200,170,30,5,0,12,15,20,4,0,5,10,15,25,30,50,15,-300,600,-1000,1000];
  const result = gameAccuracy(cps.slice(1).map(evalCp));
  close(result.w, 38.891373588956036); close(result.b, 36.559060298232865);
  const blackStart = gameAccuracy(cps.slice(1).map(cp => evalCp(-cp)), { startColor: 'b', initial: evalCp(-15) });
  close(blackStart.b, result.w); close(blackStart.w, result.b);
  assert.equal(gameAccuracy([evalCp(10), { cp: 40, ready: false, exact: true }]), null);
  assert.equal(gameAccuracy([evalCp(10), { cp: 40, ready: true, exact: false, bound: 'lowerbound' }]), null);
  assert.equal(gameAccuracy([{ ...evalCp(10), canonicalEligible: false }]), null);
  assert.equal(gameAccuracy([]), null);
});
test('all half-open grade boundaries and no Best from clamping alone', () => {
  for (const [loss, label] of [[0,'Excellent'],[1.999,'Excellent'],[2,'Good'],[4.999,'Good'],[5,'Inaccuracy'],[9.999,'Inaccuracy'],[10,'Mistake'],[19.999,'Mistake'],[20,'Blunder']]) assert.equal(ordinaryGrade(loss), label);
  assert.equal(score({ beforeW: 60, afterW: 60 }).label, 'Excellent');
  assert.equal(score({ beforeW: 60, afterW: 60, bestStable: true }).label, 'Best');
  assert.equal(score({ after: { cp: 0, ready: true, exact: false } }).ready, false);
  assert.equal(score({ after: { ...evalCp(0), canonicalEligible: false } }).ready, false);
  assert.equal(score({ before: { ...evalCp(0), profileId: 'profile-a' }, after: { ...evalCp(0), profileId: 'profile-b' } }).ready, false);
});
test('Best needs stable checked evidence and preserves verified mates', () => {
  assert.equal(score({ playedMove: 'e2e4', bestStable: true }).label, 'Best');
  const mate = { mate: 3, ready: true, exact: true, bestMove: 'e2e4' };
  assert.equal(score({ before: mate, best: mate, after: evalCp(1000), playedMove: 'e2e4', bestStable: true }).label, 'Excellent');
  assert.equal(score({ before: mate, best: mate, after: { ...mate, mate: 5 }, playedMove: 'e2e4', bestStable: true }).label, 'Best');
});
test('Brilliant demands real net concession, every acceptance, stability, and multiple legal choices', () => {
  const evidence = { complete: true, legalMoveCount: 3, beforeW: 65, afterW: 64, offeredPiece: 'r', immediateLegalCaptures: 2,
    acceptances: [{ exact: true, netMaterialConcession: 2, afterW: 55, losingMate: false }, { exact: true, netMaterialConcession: 3, afterW: 50, losingMate: false }] };
  const special = { ordinary: { Brilliant: evidence }, refinement: { Brilliant: evidence } };
  assert.equal(score({ special }).label, 'Brilliant');
  for (const changed of [{ offeredPiece: 'p' },{ immediateLegalCaptures: 3 },{ complete: false },{ acceptances: [{ ...evidence.acceptances[0], netMaterialConcession: 0 }, evidence.acceptances[1]] },{ acceptances: [{ ...evidence.acceptances[0], afterW: 20 }, evidence.acceptances[1]] },{ acceptances: [{ ...evidence.acceptances[0], losingMate: true }, evidence.acceptances[1]] }]) {
    assert.equal(score({ special: { ...special, refinement: { Brilliant: { ...evidence, ...changed } } } }).label, 'Excellent');
  }
  assert.equal(score({ legalMoveCount: 1, special }).label, 'Excellent');
  assert.equal(score({ beforeW: 95, afterW: 95, special }).label, 'Excellent');
});
test('Great requires all root alternatives, rejects equivalent good choices and sampled top two', () => {
  const evidence = { complete: true, legalMoveCount: 3, beforeW: 50, afterW: 49, alternatives: [{ exact: true, afterW: 25 }, { exact: true, afterW: 28 }] };
  const special = { ordinary: { Great: evidence }, refinement: { Great: evidence } };
  assert.equal(score({ beforeW: 50, afterW: 49, special }).label, 'Great');
  assert.equal(score({ beforeW: 50, afterW: 49, special: { ...special, refinement: { Great: { ...evidence, alternatives: [{ exact: true, afterW: 49 }, evidence.alternatives[1]] } } } }).label, 'Excellent');
  assert.equal(score({ beforeW: 50, afterW: 49, special: { ...special, refinement: { Great: { ...evidence, alternatives: evidence.alternatives.slice(0,1) } } } }).label, 'Excellent');
});
test('Miss requires a new checked opponent gift, retains ordinary grade', () => {
  const evidence = { complete: true, legalMoveCount: 3, beforeW: 80, afterW: 50, previousAvailableW: 55, opponentGiftChecked: true, missedContinuation: ['e2e4'] };
  const special = { ordinary: { Miss: evidence }, refinement: { Miss: evidence } };
  const missed = score({ beforeW: 80, afterW: 50, special });
  assert.equal(missed.label, 'Miss'); assert.equal(missed.ordinaryGrade, 'Blunder');
  assert.equal(score({ beforeW: 80, afterW: 50, special: { ...special, ordinary: { Miss: { ...evidence, previousAvailableW: 75 } } } }).label, 'Blunder');
});
test('retry accepts comparable alternatives, rejects loss boundary and fake mate/draw preservation', () => {
  assert.equal(retryAccepted({ reference: evalW(50), attempt: evalW(49), color: 'w' }).accepted, true);
  assert.equal(retryAccepted({ reference: evalW(50), attempt: evalW(47.99), color: 'w' }).accepted, false);
  assert.equal(retryAccepted({ reference: evalW(50), attempt: evalW(51), color: 'b' }).accepted, true);
  assert.equal(retryAccepted({ reference: { mate: 2, ready: true, exact: true }, attempt: evalCp(1000), color: 'w', requiredOutcome: 'mate' }).accepted, false);
  assert.equal(retryAccepted({ reference: evalCp(0), attempt: evalCp(0), color: 'w', requiredOutcome: 'draw' }).accepted, false);
});
