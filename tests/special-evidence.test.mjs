import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSpecialEvidence } from '../src/special-evidence.mjs';
import { replayPosition } from '../src/engine.mjs';
import { scoreMove, winPercent } from '../src/scoring.mjs';
async function classify({ initialFen, moves = [], playedMove }) {
  const special = await collectSpecialEvidence({ initialFen, moves, playedMove, color: 'w' });
  const { before, after } = special.assessments.refinement;
  return { special, result: scoreMove({ before, after, best: before, playedMove, color: 'w', bestStable: true,
    legalMoveCount: replayPosition(initialFen, moves).moves().length, special }) };
}
test('actual Stockfish confirms a near-best Greek gift, king acceptance, checked Ng5 and net two-point sacrifice', async () => {
  // Authored legal teaching position, not an imported game or Brian's position.
  const { special, result } = await classify({ initialFen: 'r1bq1rk1/pppn1ppp/2n1p3/3pP3/1b1P4/2NB1N2/1PP2PPP/R1BQ1RK1 w - - 0 1', playedMove: 'd3h7' });
  assert.equal(result.label, 'Brilliant');
  for (const profile of ['ordinary', 'refinement']) {
    const offer = special[profile].Brilliant;
    assert.equal(offer.immediateLegalCaptures, 1); assert.equal(offer.acceptances[0].capture, 'g8h7');
    assert.equal(offer.acceptances[0].bestReply, 'f3g5'); assert.equal(offer.acceptances[0].netMaterialConcession, 2);
    assert.ok(offer.acceptances[0].afterW >= 45); assert.equal(offer.acceptances[0].losingMate, false);
  }
});
test('actual unsound bishop offer and equal exchange cannot earn Brilliant', async () => {
  const unsound = await classify({ initialFen: 'r1bq1rk1/pppnbppp/2n1p3/3pP3/3P4/2NB1N2/PPP2PPP/R1BQ1RK1 w - - 0 1', playedMove: 'd3h7' });
  assert.notEqual(unsound.result.label, 'Brilliant');
  const unsoundOrdinary = unsound.special.assessments.ordinary;
  assert.ok(winPercent(unsoundOrdinary.before, 'w') - winPercent(unsoundOrdinary.after, 'w') >= 20);
  assert.equal(unsound.special.ordinary.Brilliant, undefined);
  const exchange = await classify({ moves: ['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6'], playedMove: 'b5c6' });
  assert.notEqual(exchange.result.label, 'Brilliant');
  // Both b- and d-pawn captures must be checked whenever the near-best gate admits this offer.
  for (const profile of ['ordinary','refinement']) {
    const offer = exchange.special[profile].Brilliant;
    if (offer) {
      assert.equal(offer.immediateLegalCaptures, 2); assert.equal(offer.acceptances.length, 2);
      assert.ok(offer.acceptances.every(a => a.netMaterialConcession < 2));
    }
  }
});
test('actual unique winning rook capture earns Great after every remaining legal root is searched', async () => {
  const { special, result } = await classify({ initialFen: '6k1/5p2/8/8/8/8/5q2/5R1K w - - 0 1', playedMove: 'f1f2' });
  assert.equal(result.label, 'Great');
  for (const profile of ['ordinary','refinement']) {
    const evidence = special[profile].Great;
    assert.equal(evidence.remainingMoves.length, evidence.legalMoveCount - 1);
    assert.equal(evidence.remainingMoves.includes('f1f2'), false);
    assert.ok(evidence.alternativeSearch.afterW <= 60);
  }
});
test('actual missed new mate opportunity retains the checked strong response absent from the played line', async () => {
  const { special, result } = await classify({ moves: ['e2e4','e7e5','d1h5','b8c6','f1c4','g8f6'], playedMove: 'a2a3' });
  assert.equal(result.label, 'Miss'); assert.equal(result.ordinaryGrade, 'Blunder');
  for (const profile of ['ordinary','refinement']) {
    assert.equal(special[profile].Miss.opponentMove, 'g8f6');
    assert.deepEqual(special[profile].Miss.missedContinuation, ['h5f7']);
    assert.ok(special[profile].Miss.previousAvailableW <= 60);
  }
  assert.equal(special.assessments.refinement.after.bestMove, 'f6h5');
});
test('ordinary equivalent opening choices do not earn Great', async () => {
  const { result } = await classify({ playedMove: 'e2e4' });
  assert.notEqual(result.label, 'Great'); assert.notEqual(result.label, 'Brilliant');
});
