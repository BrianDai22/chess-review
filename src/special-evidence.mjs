import { DEFAULT_POSITION } from 'chess.js';
import { Engine, ENGINE_PROFILE, replayPosition } from './engine.mjs';
import { winPercent } from './scoring.mjs';

const uci = move => move.from + move.to + (move.promotion || '');
const usable = e => e?.ready === true && e.exact === true && !e.bound;
const matchesOrdinary = (e, initialFen, moves) => e?.profile === 'ordinary' && e.profileId === ENGINE_PROFILE.id
  && e.initialFen === initialFen && JSON.stringify(e.moves) === JSON.stringify(moves) && e.canonicalEligible !== false;
const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export function materialBalance(chess, color) {
  return chess.board().flat().filter(Boolean).reduce((sum, piece) => sum + values[piece.type] * (piece.color === color ? 1 : -1), 0);
}
const losingMate = (assessment, color) => Number.isFinite(assessment.mate)
  && (assessment.mate === 0 ? assessment.winner !== color : (assessment.mate > 0 ? 'w' : 'b') !== color);

// Only backend-computed finite engine evidence; this collector never assigns labels.
export async function collectSpecialEvidence({ engine = new Engine(), initialFen = DEFAULT_POSITION, moves = [], playedMove, color, before, after, signal } = {}) {
  const position = replayPosition(initialFen, moves);
  if (position.turn() !== color) throw new Error('Special evidence color must match the mover');
  const legal = position.moves({ verbose: true });
  const played = legal.find(move => uci(move) === playedMove);
  if (!played) throw new Error('Special evidence needs a legal played move');
  const nextMoves = [...moves, playedMove];
  const afterPosition = replayPosition(initialFen, nextMoves);
  const captures = afterPosition.moves({ verbose: true }).filter(move => move.to === played.to && move.captured === (played.promotion || played.piece));
  const remainingMoves = legal.map(uci).filter(move => move !== playedMove);
  const initialMaterial = materialBalance(position, color);
  const result = { ordinary: {}, refinement: {}, assessments: {} };
  for (const profile of ['ordinary', 'refinement']) {
    const beforeAssessment = profile === 'ordinary' && matchesOrdinary(before, initialFen, moves) ? before : await engine.analyze({ initialFen, moves, profile, signal });
    const afterAssessment = profile === 'ordinary' && matchesOrdinary(after, initialFen, nextMoves) ? after : await engine.analyze({ initialFen, moves: nextMoves, profile, signal });
    result.assessments[profile] = { before: beforeAssessment, after: afterAssessment };
    if (!usable(beforeAssessment) || !usable(afterAssessment)) continue;
    const beforeW = winPercent(beforeAssessment, color), afterW = winPercent(afterAssessment, color);
    const loss = Math.max(0, beforeW - afterW);
    const common = { complete: true, legalMoveCount: legal.length, beforeW, afterW, profileId: beforeAssessment.profileId, profile };
    if (loss < 2 && afterW >= 45 && beforeW < 90 && legal.length >= 2 && ['n', 'b', 'r', 'q'].includes(played.piece) && captures.length) {
      const acceptances = [];
      for (const capture of captures) {
        const acceptedMoves = [...nextMoves, uci(capture)];
        const reply = await engine.analyze({ initialFen, moves: acceptedMoves, profile, signal });
        if (!usable(reply) || !reply.bestMove) { common.complete = false; break; }
        const resultingMoves = [...acceptedMoves, reply.bestMove];
        const resultingPosition = replayPosition(initialFen, resultingMoves);
        const resultingAssessment = await engine.analyze({ initialFen, moves: resultingMoves, profile, signal });
        acceptances.push({ capture: uci(capture), bestReply: reply.bestMove, resultingFen: resultingPosition.fen(),
          exact: usable(resultingAssessment), netMaterialConcession: initialMaterial - materialBalance(resultingPosition, color),
          afterW: winPercent(resultingAssessment, color), losingMate: losingMate(resultingAssessment, color),
          assessment: resultingAssessment });
      }
      result[profile].Brilliant = { ...common, offeredPiece: played.piece, immediateLegalCaptures: captures.length, acceptances };
    }
    if (loss < 2 && legal.length >= 2 && afterW >= 45) {
      const alternative = await engine.analyze({ initialFen, moves, profile, searchMoves: remainingMoves, signal });
      // One search enumerates the entire remaining legal root pool, not a sampled MultiPV pair.
      result[profile].Great = { ...common, complete: usable(alternative), remainingMoves,
        alternativeSearch: { exact: usable(alternative), afterW: winPercent(alternative, color), bestMove: alternative.bestMove, assessment: alternative } };
    }
    if (moves.length && beforeW >= 75 && afterW <= 60 && loss >= 15) {
      const previous = await engine.analyze({ initialFen, moves: moves.slice(0, -1), profile, signal });
      result[profile].Miss = { ...common, complete: usable(previous), previousAvailableW: winPercent(previous, color),
        opponentGiftChecked: usable(previous), opponentMove: moves.at(-1),
        missedContinuation: [...beforeAssessment.pv], previousAssessment: previous };
    }
  }
  return result;
}
