import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { Chessground } from '@lichess-org/chessground';
import { Chess } from 'chess.js';

const pieceNames = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const app = new App({ name: 'Chess Review', version: '0.1.0' });
const extensions = new OpenAIExtensions(app);
const mountId = crypto.randomUUID();
let state;
let launchReceived = false;
let launchArguments = {};
let launchInputError;
let launchTimer;
let launchRecoveryInFlight = false;
let connected = false;
let disposed = false;
let pollInFlight = false;
let pollTimer;
let pollDelay = 1500;
let displayedRevision;
let contextRevision;
let contextUpdateId;
let pendingContext;
let contextPublication;
let coachingRequest;
let acknowledgedCoachingRequest;
let contextRetryAfter = 0;
let contextRetryDelay = 1500;
let contextFailure;
let manualInFlight = false;
let navigationIntent;
let navigationRun;
const persistentChildren = new Map();
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let ground;
let canonicalSynced = false;
let catalog = { username: null, games: [] };
let catalogInFlight = false;
let catalogRequest = 0;
let catalogInitialized = false;
let pendingPromotion;
let engineEnabled = true;
let positionEvidence;
let evidenceRequest = 0;
let evidencePending;
let evidenceAttempted;
let evidenceError;
let activeDrawer;
let reviewStarted = false;
let reviewMode = 'review';
let comparisonAnchor;
let explainInFlight = false;
let lastExplained;
let visualLesson;
let visualNavigation;
let dismissedVisual;
const guideExposures = new Set();

document.body.innerHTML = `<main class="review" aria-label="Chess review">
  <header class="workspace-header"><h1>Chess Review</h1><button class="btn btn-secondary" id="game-picker-title" type="button" aria-expanded="false" aria-controls="game-picker">Games</button></header>
  <section id="game-picker" class="drawer game-picker" aria-label="Game selection" hidden><div class="picker-content"><label class="form-label" for="game">Completed games</label><select id="game" class="form-control" disabled><option>Loading games…</option></select><form id="import-form"><label class="form-label" for="username">Chess.com username</label><div class="import-row"><input id="username" class="form-control" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Your public username"/><button id="refresh-games" class="btn btn-primary" type="submit" disabled>Import games</button></div></form><p id="catalog-status" class="muted" aria-live="polite"></p></div></section>
  <section class="game-identity" aria-label="Current game"><h2 id="game-title">Review game</h2><span id="game-meta" class="muted" hidden></span><span id="game-source" class="source-note" hidden></span></section>
  <div class="workspace-content" id="workspace-content">
    <section class="board-workspace" aria-label="Selected position">
      <div class="board-cluster"><div class="player-bar" id="opponent-bar"><span class="player-piece" id="opponent-piece" aria-hidden="true"></span><div class="player-identity"><strong id="opponent-name"></strong><span id="opponent-rating" class="muted"></span></div><span id="opponent-accuracy" class="player-score" hidden></span><span id="opponent-turn" class="sr-only" hidden>To move</span></div>
      <div class="board-slot"><div class="board-shell"><div id="board" class="board cg-wrap" role="img" aria-label="Chess position" aria-describedby="accessible-position board-instruction"></div></div></div>
      <fieldset id="promotion-panel" class="promotion-panel" hidden><legend>Choose promotion</legend><div id="promotion-choices" class="promotion-choices"></div><button id="cancel-promotion" class="btn btn-secondary" type="button">Cancel</button></fieldset>
      <div class="player-bar" id="player-bar"><span class="player-piece" id="player-piece" aria-hidden="true"></span><div class="player-identity"><strong id="player-name"></strong><span id="player-rating" class="muted"></span></div><span id="accuracy-assessment" class="player-score" hidden><span>Accuracy </span><strong id="accuracy"></strong></span><span id="player-turn" class="sr-only" hidden>To move</span></div>
      </div><nav class="move-navigation" aria-label="Played line navigation"><button id="previous" class="btn btn-secondary" type="button" aria-label="Previous move" disabled>Previous</button><span id="position" tabindex="-1" aria-live="polite">Start position</span><button id="next" class="btn btn-secondary" type="button" aria-label="Next move" disabled>Next</button></nav>
      <p id="board-instruction" class="sr-only">Move a piece to explore</p>
    </section>
    <aside class="workbench" aria-label="Review tools">
      <nav id="review-modes" class="review-modes" aria-label="Review mode"><button id="review-mode" class="btn btn-secondary" aria-pressed="true" type="button">Review</button><button id="engine-mode" class="btn btn-secondary" aria-pressed="false" type="button">Engine</button><button id="overview-toggle" class="btn btn-secondary" type="button">Overview</button></nav>
      <section id="review-overview" class="review-overview" aria-label="Review overview" hidden><h2>Your game at a glance</h2><p id="overview-summary" class="muted"></p><div id="classification-counts" class="classification-counts"></div><button id="start-review" class="btn btn-primary" type="button" disabled>Start review</button></section>
      <section id="coach-panel" class="coach-panel" aria-label="Move review"><h2 id="coach-title">Choose a move</h2><div class="assessment" id="assessment" hidden><div class="metric" id="move-assessment"><strong id="classification" class="classification"></strong></div><div class="metric" id="position-assessment"><strong id="evaluation"></strong></div></div><p id="coach-facts" class="sr-only"></p><p id="coach-next-action" class="sr-only"></p><p id="coaching-note" class="sr-only" hidden></p><section id="visual-coach" aria-label="Visual coaching" hidden><h3 id="visual-title"></h3><div id="visual-step-picture" class="visual-step-picture cg-wrap" aria-hidden="true"></div><p id="visual-label" class="sr-only" aria-live="polite"></p><div id="visual-steps" class="visual-steps" aria-label="Coaching steps"></div><nav class="visual-controls" aria-label="Visual coaching controls"><button id="visual-back" class="btn btn-secondary" type="button" aria-label="Previous coaching step" disabled>←</button><button id="visual-play" class="btn btn-primary" type="button" disabled>Play</button><button id="visual-close" class="btn btn-secondary" type="button" aria-label="Close coaching and restore position">×</button></nav></section><div class="coach-actions"><button id="show-better" class="btn btn-primary" type="button" hidden disabled>Show better move</button><button id="resume-played" class="btn btn-primary" type="button" hidden disabled>Resume played move</button><button id="coach-return" class="btn btn-secondary" type="button" hidden disabled>Return to game</button><button id="explain-move" class="btn btn-secondary" type="button" disabled>Explain this move</button></div><p id="coach-message" class="sr-only" role="status" hidden></p></section>
      <section id="evaluation-chart" class="evaluation-chart" aria-label="Game evaluation" hidden><div class="chart-heading sr-only"><span>White advantage</span><span>Black advantage</span></div><div id="evaluation-graph" class="evaluation-graph" aria-label="Select a move on the evaluation graph"></div></section>
      <div id="engine-mode-panel" hidden>
      <section id="engine-guide" class="engine-guide" aria-label="Engine guide"><div class="engine-actions"><button id="engine-toggle" class="btn btn-secondary" type="button" aria-pressed="true">Engine on</button><button id="engine-play" class="btn btn-primary" type="button" disabled>Play best move</button><button id="return" class="btn btn-secondary" type="button" disabled hidden>Return to game</button></div><p id="engine-status" class="sr-only" aria-live="polite"></p><div id="engine-line" class="line-trail" aria-label="Checked engine continuation"></div></section>
      </div>
      <div id="variation-trail" class="line-trail" aria-label="Explored moves" hidden></div>
      <section class="review-results" aria-label="Game analysis"><div class="review-actions" id="review-actions"><button id="analyze" class="btn btn-primary" type="button" disabled>Analyze game</button><div class="analysis-progress" id="analysis-progress" hidden><p id="analysis-status" aria-live="polite"></p><progress id="analysis-meter" aria-label="Game analysis progress" hidden></progress></div><button id="start-retry" class="btn btn-secondary" type="button" disabled hidden>Retry this move</button></div></section>
      <section id="key-moments-panel" aria-label="Key moments" hidden><div class="moment-heading"><h2>Key moments</h2><button id="next-moment" class="btn btn-secondary" type="button" disabled>Next key moment</button></div><div id="key-moments" class="moment-list"></div></section>
      <section id="retry-panel" class="retry-panel" aria-label="Retry decision" hidden><h2 id="retry-title">Retry this decision</h2><p id="retry-instruction"></p><p id="retry-feedback" class="retry-feedback" aria-live="polite" hidden></p><p id="retry-answer" class="checked-answer" hidden></p><div class="retry-actions"><button id="retry-hint" class="btn btn-secondary" type="button" disabled>Hint</button><button id="end-retry" class="btn btn-secondary" type="button" disabled>Back to review</button></div></section>
      <p id="error" role="alert" hidden></p><button id="retry-launch" class="btn btn-primary review-launch-retry" type="button" hidden>Retry opening review</button>
    </aside>
  </div>
  <footer class="secondary-tools"><details id="moves-panel"><summary id="moves-toggle">Moves</summary><div class="drawer drawer-content"><h2>Played moves</h2><div id="move-list" class="move-list" aria-label="Played moves"></div></div></details><details id="variation-panel"><summary id="keyboard-toggle">Keyboard moves</summary><div class="drawer drawer-content"><form id="variation-form"><label class="form-label" for="variation">Moves from this position</label><div class="variation-input"><input class="form-control" id="variation" autocomplete="off" aria-label="Variation moves in SAN or from-to notation" placeholder="Nf3 Nc6 or g1f3 b8c6"/><button id="show-variation" class="btn btn-secondary" type="submit" disabled>Show</button></div></form><form id="retry-form" hidden><label class="form-label" for="retry-move">Your move</label><div class="variation-input"><input id="retry-move" class="form-control" autocomplete="off" spellcheck="false" aria-describedby="retry-format" placeholder="Nf3 or g1f3"/><button id="submit-retry" class="btn btn-primary" type="submit" disabled>Check move</button></div><span id="retry-format" class="sr-only">Use chess notation, such as Nf3, or from-to notation, such as g1f3.</span><details class="retry-record"><summary>Attempt record</summary><p id="retry-history" class="muted"></p></details></form><details id="position-details" class="position-details"><summary>Piece locations</summary><p id="accessible-position"></p></details></div></details><details id="learning-panel" class="learning-panel"><summary id="learning-title">History</summary><div class="drawer drawer-content"><div id="saved-mistakes" class="moment-list"></div><p id="progress" class="muted"></p></div></details></footer>
  <p id="summary" class="sr-only"></p><p id="side" class="sr-only"></p><p id="status" class="sr-only" aria-live="polite">Connecting to native chat…</p>
  <p id="drawer-error" class="drawer-error" role="alert" hidden></p>
</main>`;
const el = id => document.getElementById(id);
for (const id of ['previous', 'next', 'return', 'show-variation', 'analyze', 'start-retry', 'submit-retry', 'retry-hint', 'end-retry', 'refresh-games', 'game', 'start-review', 'show-better', 'resume-played', 'coach-return', 'explain-move', 'next-moment', 'visual-back', 'visual-play', 'visual-close']) el(id).disabled = true;

function reportError(error) {
  el('error').hidden = false;
  el('error').textContent = error?.message || String(error);
  el('drawer-error').hidden = !activeDrawer;
  el('drawer-error').textContent = activeDrawer ? el('error').textContent : '';
}

function clearError() { el('error').hidden = true; el('error').textContent = ''; el('drawer-error').hidden = true; el('drawer-error').textContent = ''; }
function setGamePicker(open) {
  el('game-picker').hidden = !open; el('game-picker-title').setAttribute('aria-expanded', String(Boolean(open)));
  if (open) { el('variation-panel').open = false; el('learning-panel').open = false; el('moves-panel').open = false; activeDrawer = 'game-picker-title'; }
  else if (activeDrawer === 'game-picker-title') activeDrawer = undefined;
  el('workspace-content').inert = Boolean(activeDrawer);
  if (state) render(state, { publish: false });
}
function closeDrawers() { const focus = activeDrawer; activeDrawer = undefined; el('variation-panel').open = false; el('learning-panel').open = false; el('moves-panel').open = false; el('drawer-error').hidden = true; setGamePicker(false); if (focus) el(focus).focus(); }

function applyHostContext(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}

function unpack(result) {
  if (result?.isError) {
    const message = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
    throw new Error(message || 'The chess tool could not complete this action.');
  }
  if (!result?.structuredContent) throw new Error('The chess tool did not return review state.');
  return result.structuredContent;
}

function redrawStatus() {
  if (!state) return;
  const contextStatus = contextRevision === state.revision ? 'context accepted' : extensions.modelContext ? 'publishing context' : 'context unavailable';
  if (state) renderGuidedReview();
  el('status').textContent = contextRevision === state.revision ? 'Selected position connected to chat.' : contextStatus === 'context unavailable' ? 'Position context unavailable. Reopen the board to reconnect.' : 'Connecting selected position to chat…';
}

function moveLabel(ply, san = '') { return `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '...'} ${san}`.trim(); }
function timeControlLabel(value = '') {
  const parts = String(value).match(/^(\d+)(?:\+(\d+))?$/);
  if (!parts) return value;
  const seconds = Number(parts[1]);
  return `${seconds >= 60 ? `${seconds / 60} min` : `${seconds}s`}${parts[2] ? ` + ${parts[2]}s` : ''}`;
}
function retryHidden() { return Boolean(state?.retry && !state.retry.answerExposed); }
function readyAnalysis() { return state?.analysis?.readiness === 'ready'; }
function retryChecking() { const attempt = state?.retry?.attempts?.at(-1); return attempt?.ready === false && attempt.status === 'pending'; }
function boardCanMove() { return canonicalSynced && !manualInFlight && !pendingPromotion && !activeDrawer && !retryChecking() && Boolean(state?.legalMoves?.length); }
function evidenceKey() { return `${state.sessionId}:${state.revision}:${state.fen}`; }
function checkedGuide() {
  if (!canonicalSynced || !engineEnabled || retryHidden()) return;
  const canonical = state.analysis?.readiness === 'ready' ? state.analysis.currentPosition : undefined;
  const evidence = canonical?.fen === state.fen ? canonical : positionEvidence?.key === evidenceKey() ? positionEvidence.evidence : undefined;
  if (!evidence?.ready || !evidence.exact || evidence.bound || evidence.fen !== state.fen) return;
  const pv = evidence.pv?.length ? evidence.pv : evidence.bestMove ? [evidence.bestMove] : [];
  if (evidence.bestMove && pv.length && evidence.bestMove !== pv[0]) return;
  try {
    const chess = new Chess(state.fen);
    const line = pv.map(uci => { if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Invalid engine move'); const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); return { uci, san: move.san, fen: chess.fen(), piece: move.piece, color: move.color, from: move.from, to: move.to }; });
    const first = line[0];
    if (first && !state.legalMoves?.some(move => `${move.from}${move.to}${move.promotion || ''}` === first.uci)) return;
    return { evidence, line };
  } catch { return; }
}

async function recordDisplayedGuide() {
  if (!canonicalSynced || !engineEnabled || retryHidden() || !readyAnalysis() || state.variation?.length || state.sideToMove !== state.playerColor || !checkedGuide()?.line.length) return;
  const key = evidenceKey();
  if (guideExposures.has(key)) return;
  guideExposures.add(key);
  if (guideExposures.size > 200) guideExposures.delete(guideExposures.values().next().value);
  const snapshot = { sessionId: state.sessionId, expectedRevision: state.revision };
  try { unpack(await app.callServerTool({ name: 'get_position_evidence', arguments: snapshot }, { timeout: 10000 })); }
  catch (error) { if (state?.sessionId === snapshot.sessionId && state.revision === snapshot.expectedRevision && !retryHidden() && engineEnabled) reportError(error); }
}

async function fetchVariationEvidence() {
  if (!canonicalSynced || !connected || !engineEnabled || retryHidden() || !readyAnalysis() || !state.variation?.length || manualInFlight || pendingPromotion || checkedGuide()) return;
  const key = evidenceKey();
  if (evidencePending === key || evidenceAttempted === key) return;
  const request = ++evidenceRequest;
  const snapshot = { sessionId: state.sessionId, expectedRevision: state.revision, fen: state.fen };
  evidencePending = key; evidenceAttempted = key; evidenceError = undefined;
  render(state, { publish: false });
  try {
    const result = unpack(await app.callServerTool({ name: 'get_position_evidence', arguments: { sessionId: snapshot.sessionId, expectedRevision: snapshot.expectedRevision } }, { timeout: 45000 }));
    if (request !== evidenceRequest || retryHidden() || state.sessionId !== snapshot.sessionId || state.revision !== snapshot.expectedRevision || state.fen !== snapshot.fen || result.sessionId !== snapshot.sessionId || result.revision !== snapshot.expectedRevision || result.fen !== snapshot.fen) return;
    positionEvidence = { key, evidence: { ...result.evidence, fen: result.fen } };
  } catch (error) { if (request === evidenceRequest && state && evidenceKey() === key && !retryHidden()) evidenceError = error.message || String(error); }
  finally { if (request === evidenceRequest) { evidencePending = undefined; if (state) render(state, { publish: false }); } }
}

function renderEngineGuide() {
  const hidden = retryHidden(), guide = checkedGuide();
  el('engine-guide').hidden = hidden;
  el('engine-toggle').setAttribute('aria-pressed', String(engineEnabled && !hidden));
  el('engine-toggle').textContent = engineEnabled ? 'Engine on' : 'Engine off';
  el('engine-play').hidden = !engineEnabled;
  el('engine-play').disabled = !guide?.line.length || !boardCanMove() || Boolean(state.retry);
  el('engine-play').textContent = state.variation?.length ? 'Play next' : 'Play best move';
  el('engine-status').textContent = hidden || !engineEnabled || state.analysis?.readiness === 'analyzing' ? '' : evidencePending === evidenceKey() ? 'Checking this position…' : evidenceError && evidenceAttempted === evidenceKey() ? 'Engine guide unavailable. Try another position.' : guide ? guide.line.length ? `Best: ${guide.line[0].san}` : 'No legal continuation' : readyAnalysis() ? 'No checked engine line for this position' : 'Waiting for checked analysis';
  el('engine-status').hidden = !el('engine-status').textContent;
  el('engine-line').hidden = !engineEnabled || !guide?.line.length || hidden;
  const line = !hidden && engineEnabled && guide ? guide.line.slice(0,8) : [];
  retainChildren('engine-line',[state.fen,line],() => line.map((move,index) => pieceButton(move,index+1,() => void mutate('show_variation',{moves:[...(state.variation || []),...line.slice(0,index+1).map(item=>item.uci)]}))),button=>{button.disabled=!boardCanMove() || Boolean(state.retry);});
  const branch = !hidden && !state.retry ? state.variation || [] : [];
  el('variation-trail').hidden = !branch.length;
  retainChildren('variation-trail',[state.selectedPly,branch],() => {
    try {
      const chess = new Chess(state.initialFen);
      for (const san of (state.playedMoves || []).slice(0,state.selectedPly)) chess.move(san);
      return branch.map((san,index) => pieceButton(chess.move(san),index+1,()=>void mutate('show_variation',{moves:branch.slice(0,index+1)})));
    } catch { return []; }
  },button=>{button.disabled=manualInFlight || !canonicalSynced || Boolean(pendingPromotion);});
}
function pieceIcon(move) {
  const piece = document.createElement('piece');
  piece.className = `coach-piece ${move.color === 'b' ? 'black' : 'white'} ${pieceNames[move.piece] || 'pawn'}`;
  piece.setAttribute('aria-hidden','true');
  return piece;
}
function pieceButton(move,number,action) {
  const button = momentButton('',action); button.className = 'moment cg-wrap piece-chip';
  button.setAttribute('aria-label',`${move.color === 'b' ? 'Black' : 'White'} ${pieceNames[move.piece]} · step ${number}`);
  button.append(pieceIcon(move)); return button;
}
function visualPosition(lesson,step) {
  return {fen:step ? lesson.steps[step-1].fen : lesson.fen, variation:[...lesson.variation,...lesson.steps.slice(0,step).map(move=>move.san)]};
}
function updateVisualLesson() {
  if (!canonicalSynced || state.retry || !readyAnalysis()) { visualLesson = undefined; return; }
  if (visualLesson) {
    if (visualNavigation?.lesson === visualLesson && state.sessionId === visualLesson.sessionId && state.gameId === visualLesson.gameId && state.selectedPly === visualLesson.selectedPly && state.revision === visualLesson.revision + 1 && state.fen === visualNavigation.fen && JSON.stringify(state.variation || []) === JSON.stringify(visualNavigation.variation)) {
      visualLesson.step = visualNavigation.step;
      visualLesson.revision = state.revision;
    }
    const expected = visualPosition(visualLesson,visualLesson.step);
    if (state.sessionId !== visualLesson.sessionId || state.gameId !== visualLesson.gameId || state.revision !== visualLesson.revision || state.selectedPly !== visualLesson.selectedPly || state.fen !== expected.fen || JSON.stringify(state.variation || []) !== JSON.stringify(expected.variation)) visualLesson = undefined;
  }
  const note = state.coachingNote;
  if (!note?.visual || note.sessionId !== state.sessionId || note.gameId !== state.gameId || note.revision !== state.revision || note.fen !== state.fen) return;
  const id = `${note.sessionId}:${note.revision}:${note.createdAt}`;
  if (id === dismissedVisual || visualLesson?.id === id) return;
  try {
    const chess = new Chess(state.fen), steps = note.visual.steps;
    if (!Array.isArray(steps) || !steps.length || steps.length > 4) return;
    for (const step of steps) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(step.uci)) return;
      const move = chess.move({from:step.uci.slice(0,2),to:step.uci.slice(2,4),promotion:step.uci[4]});
      if (chess.fen() !== step.fen || move.san !== step.san) return;
    }
    visualLesson = {id, sessionId:state.sessionId,gameId:state.gameId,revision:state.revision,selectedPly:state.selectedPly,fen:state.fen,variation:[...(state.variation || [])],title:note.visual.title,steps,step:0,source:'AI coach'};
  } catch { /* Ignore malformed derived lessons; never render an unchecked position. */ }
}
function startEngineLesson() {
  const line = checkedGuide()?.line.slice(0,4);
  if (!line?.length) return;
  visualLesson = {id:`engine:${evidenceKey()}`,sessionId:state.sessionId,gameId:state.gameId,revision:state.revision,selectedPly:state.selectedPly,fen:state.fen,variation:[...(state.variation || [])],title:'Checked continuation',steps:line.map(move=>({...move,label:`${move.color === 'b' ? 'Black' : 'White'} ${pieceNames[move.piece]}`,focus:[]})),step:0,source:'Engine line'};
  render(state,{publish:false});
}
function renderVisualCoach() {
  const lesson = !retryHidden() && !state.retry && readyAnalysis() ? visualLesson : undefined;
  el('visual-coach').hidden = !lesson;
  if (!lesson) return;
  el('coach-title').textContent = lesson.source;
  el('assessment').hidden = true;
  el('explain-move').hidden = true;
  for (const id of ['show-better','resume-played','coach-return']) el(id).hidden = true;
  const current = lesson.steps[Math.max(0,lesson.step-1)];
  el('visual-title').textContent = lesson.step ? current.label : lesson.title;
  el('visual-label').textContent = `Step ${lesson.step} of ${lesson.steps.length}. ${el('visual-title').textContent}`;
  const pictured = current;
  retainChildren('visual-step-picture',[pictured.uci,lesson.step],()=>{
    const arrow = document.createElement('span'); arrow.textContent = lesson.step === lesson.steps.length ? '✓' : '→';
    const target = document.createElement('span'); target.className = `visual-target${(pictured.to.charCodeAt(0)+Number(pictured.to[1]))%2===0 ? ' dark' : ''}`; target.append(pieceIcon(pictured));
    return [pieceIcon(pictured),arrow,target];
  });
  retainChildren('visual-steps',[lesson.id,lesson.steps.length],()=>Array.from({length:lesson.steps.length+1},(_,index)=>{
    const button = momentButton(String(index),()=>void moveVisualStep(index)); button.className='step-dot'; button.setAttribute('aria-label',index ? `Coaching step ${index}: ${lesson.steps[index-1].label}` : 'Start of coaching'); return button;
  }), (button,index)=>{button.disabled=!canonicalSynced || manualInFlight || Boolean(pendingPromotion) || Boolean(activeDrawer); button.setAttribute('aria-current',String(index===lesson.step));});
  el('visual-back').disabled = manualInFlight || !canonicalSynced || Boolean(pendingPromotion) || Boolean(activeDrawer) || lesson.step === 0;
  el('visual-play').disabled = manualInFlight || !canonicalSynced || Boolean(pendingPromotion) || Boolean(activeDrawer);
  el('visual-close').disabled = el('visual-play').disabled;
  el('visual-play').textContent = lesson.step === lesson.steps.length ? 'Replay' : lesson.step ? 'Next' : 'Play';
}
async function moveVisualStep(step) {
  const lesson = visualLesson;
  if (!lesson || manualInFlight || !canonicalSynced || state.retry || pendingPromotion || activeDrawer || step < 0 || step > lesson.steps.length) return;
  const expected = visualPosition(lesson,step);
  visualNavigation = {lesson,step,...expected};
  try { return await mutate('show_variation',{moves:[...lesson.variation,...lesson.steps.slice(0,step).map(move=>move.uci)]}); }
  finally { visualNavigation = undefined; }
}
function evalLabel(evidence) {
  if (!evidence?.ready || !evidence.exact || evidence.bound) return '';
  if (Number.isFinite(evidence.mate)) {
    const winner = evidence.mate === 0 ? evidence.winner : evidence.mate > 0 ? 'w' : 'b';
    return `${winner === 'w' ? 'White' : 'Black'} mate${evidence.mate === 0 ? '' : ` in ${Math.abs(evidence.mate)}`}`;
  }
  if (!Number.isFinite(evidence.cp)) return '';
  return `White ${evidence.cp >= 0 ? '+' : ''}${(evidence.cp / 100).toFixed(2)}`;
}
function momentButton(label, action, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'moment cursor-interaction'; button.textContent = label;
  button.disabled = disabled; button.addEventListener('click', action); return button;
}
function retainChildren(id, content, create, update = () => {}) {
  const key = JSON.stringify([state.sessionId,state.gameId,content]);
  let cached = persistentChildren.get(id);
  if (cached?.key !== key) {
    cached = {key,nodes:create()}; persistentChildren.set(id,cached); el(id).replaceChildren(...cached.nodes);
  }
  cached.nodes.forEach(update);
}
function lastMoveSquares() {
  try {
    const chess = state.initialFen ? new Chess(state.initialFen) : new Chess();
    let last;
    for (const san of state.moveHistory || []) last = chess.move(san);
    return last && chess.fen() === state.fen ? [last.from,last.to] : undefined;
  } catch { return; }
}
function navigationPly() { return navigationIntent?.sessionId === state?.sessionId && navigationIntent.gameId === state.gameId ? navigationIntent.ply : state?.selectedPly; }
function navigationBlocked() { return !canonicalSynced || Boolean(pendingPromotion) || retryHidden() || manualInFlight && !navigationIntent; }

function renderGameIdentity() {
  const game = state.game || {};
  const selectedGame = catalog.games.find(item => item.id === state.gameId);
  const playerColor = state.playerColor === 'black' ? 'black' : 'white';
  const opponentColor = playerColor === 'white' ? 'black' : 'white';
  for (const [role, color] of [['player', playerColor], ['opponent', opponentColor]]) {
    const person = game[color] || selectedGame?.[color] || {};
    el(`${role}-name`).textContent = person.username || (color === 'white' ? 'White' : 'Black');
    el(`${role}-rating`).textContent = Number.isFinite(person.rating) ? String(person.rating) : '';
    el(`${role}-rating`).hidden = !Number.isFinite(person.rating);
    el(`${role}-piece`).dataset.color = color;
    el(`${role}-turn`).hidden = state.sideToMove !== color;
    const score = !retryHidden() && readyAnalysis() ? state.analysis.accuracy?.[color === 'white' ? 'w' : 'b'] : undefined;
    if (role === 'opponent') { el('opponent-accuracy').textContent = Number.isFinite(score) ? `Accuracy ${score.toFixed(1)}` : ''; el('opponent-accuracy').hidden = !Number.isFinite(score); }
    else { const value = Number.isFinite(score) ? score : !retryHidden() && readyAnalysis() ? state.analysis.playerAccuracy : undefined; el('accuracy').textContent = Number.isFinite(value) ? value.toFixed(1) : ''; el('accuracy-assessment').hidden = !Number.isFinite(value); }
  }
  const timeClass = game.timeClass || selectedGame?.timeClass;
  const control = timeControlLabel(game.timeControl || selectedGame?.timeControl || '');
  const fixture = selectedGame?.fixture || /verification fixture/i.test(state.sourceLabel || '');
  el('game-title').textContent = fixture ? 'Sample game' : timeClass ? `${timeClass[0].toUpperCase()}${timeClass.slice(1)}${control ? ` · ${control}` : ''}` : 'Game review';
  const date = selectedGame?.endTime > 0 ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(selectedGame.endTime * 1000) : '';
  el('game-meta').textContent = date;
  el('game-meta').hidden = true;
  el('game-source').textContent = fixture ? state.sourceLabel || selectedGame.sourceLabel || 'Verification fixture' : '';
  el('game-source').title = el('game-source').textContent;
  el('game-source').hidden = !fixture;
}

function renderReviewControls() {
  const analysis = state.analysis || {};
  const hidden = retryHidden(), retry = state.retry;
  const ready = readyAnalysis(), selected = analysis.selectedMove;
  const busy = manualInFlight || !canonicalSynced || Boolean(pendingPromotion);
  el('assessment').hidden = hidden || !ready;
  const evidence = checkedGuide()?.evidence;
  el('evaluation').textContent = hidden ? '' : evalLabel(evidence);
  const grade = !hidden && ready ? retry?.answerExposed ? retry.originalClassification?.label || '' : state.variation?.length ? '' : selected?.classification?.label || '' : '';
  el('classification').textContent = grade ? `${retry ? 'Original: ' : ''}${grade}` : '';
  el('classification').dataset.grade = grade || '';
  el('move-assessment').hidden = !grade;
  el('position-assessment').hidden = !el('evaluation').textContent;
  const busyAnalysis = ['analyzing'].includes(analysis.readiness);
  el('analyze').disabled = busy || Boolean(retry) || busyAnalysis || ready;
  el('analyze').hidden = ready || Boolean(retry) || busyAnalysis;
  el('analyze').textContent = ['failed', 'interrupted'].includes(analysis.readiness) ? 'Resume analysis' : 'Analyze game';
  const total = analysis.totalPositions, completed = analysis.completedPositions || 0;
  const grading = analysis.phase === 'moves' && Number.isInteger(analysis.currentMove) && Number.isInteger(analysis.totalMoves) && analysis.totalMoves > 0;
  el('analysis-status').textContent = hidden || retry ? '' : analysis.error || (busyAnalysis ? grading ? `Checking move ${Math.ceil(analysis.currentMove / 2)} of ${Math.ceil(analysis.totalMoves / 2)} · ${analysis.currentMove % 2 ? 'White' : 'Black'}` : `Analyzing game${Number.isInteger(total) && total > 0 ? ` · ${completed} of ${total} positions` : '…'}` : '');
  el('analysis-progress').hidden = !el('analysis-status').textContent;
  el('analysis-meter').hidden = !busyAnalysis || (!grading && (!Number.isInteger(total) || total <= 0)) || Boolean(retry);
  if (grading) { el('analysis-meter').max = analysis.totalMoves; el('analysis-meter').value = Math.min(analysis.currentMove, analysis.totalMoves); }
  else if (Number.isInteger(total) && total > 0) { el('analysis-meter').max = total; el('analysis-meter').value = Math.min(completed, total); }
  const mover = selected?.color || selected?.before?.sideToMove || selected?.best?.sideToMove;
  const player = state.playerColor === 'black' ? 'b' : 'w';
  el('start-retry').disabled = busy || Boolean(retry) || !ready || !selected || mover !== player;
  el('start-retry').hidden = Boolean(retry) || !ready || !selected || mover !== player;
  el('review-actions').hidden = el('analyze').hidden && el('start-retry').hidden && el('analysis-progress').hidden;
  el('variation-form').hidden = Boolean(retry);
  el('variation-panel').hidden = false;
  el('retry-form').hidden = !retry;
  el('return').hidden = !state.variation?.length || Boolean(retry);
  el('previous').disabled ||= hidden || navigationBlocked();
  el('next').disabled ||= hidden || navigationBlocked();
  el('return').disabled ||= hidden || busy;
  el('show-variation').disabled ||= busy;
  el('game').disabled = busy || Boolean(retry) || !catalog.games.length;
  el('refresh-games').disabled = catalogInFlight || busy || Boolean(retry);
  el('username').disabled = catalogInFlight || Boolean(retry) || Boolean(pendingPromotion);
  el('game').value = state.gameId;
  const moments = !hidden && ready ? (analysis.keyMoments || []) : [];
  el('key-moments-panel').hidden = !moments.length || Boolean(retry);
  retainChildren('key-moments',moments,()=>moments.map(moment => {
    const ply = typeof moment === 'number' ? moment : moment.ply;
    const button = momentButton(`Move ${Math.ceil(ply / 2)}${moment.label ? ` · ${moment.label}` : ''}`, () => void mutate('go_to_move', { ply }), busy);
    button.dataset.grade = moment.label || '';
    button.setAttribute('aria-current', ply === state.selectedPly ? 'true' : 'false');
    return button;
  }), (button,index)=>{button.disabled=busy;button.setAttribute('aria-current',String((typeof moments[index]==='number'?moments[index]:moments[index].ply)===state.selectedPly));});
  renderRetry(retry);
  renderLearning(hidden);
  renderEngineGuide();
  renderGuidedReview();
}

function assessedMoves() { return !retryHidden() && readyAnalysis() ? state.analysis.moveAssessments || [] : []; }
function reviewMoments() { return !retryHidden() && readyAnalysis() ? (state.analysis.keyMoments || []).map(item => typeof item === 'number' ? { ply: item } : item).sort((a, b) => a.ply - b.ply) : []; }
function renderGuidedReview() {
  if (!state) return;
  const hidden = retryHidden(), ready = readyAnalysis(), retry = Boolean(state.retry);
  const busy = manualInFlight || !canonicalSynced || Boolean(pendingPromotion);
  const overview = !hidden && !retry && ready && !reviewStarted && !state.variation?.length;
  const selected = state.analysis?.selectedMove;
  const moves = assessedMoves();
  const comparison = comparisonAnchor && comparisonAnchor.gameId === state.gameId && comparisonAnchor.sessionId === state.sessionId && state.selectedPly === comparisonAnchor.ply - 1 && state.variation?.[0] === comparisonAnchor.firstMove;
  if (comparisonAnchor && !comparison) comparisonAnchor = undefined;
  el('review-overview').hidden = !overview;
  el('coach-panel').hidden = hidden || !ready || retry || overview || reviewMode === 'engine';
  el('engine-mode-panel').hidden = hidden || retry || overview || reviewMode !== 'engine';
  el('review-modes').hidden = retry;
  el('review-mode').setAttribute('aria-pressed', String(reviewMode === 'review'));
  el('engine-mode').setAttribute('aria-pressed', String(reviewMode === 'engine'));
  el('overview-toggle').disabled = busy || !ready || retry;
  el('start-review').disabled = busy || !ready;
  const own = state.playerColor === 'black' ? 'b' : 'w';
  const counts = ['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder', ...['Brilliant', 'Great', 'Miss'].filter(label => moves.some(move => move.label === label))];
  retainChildren('classification-counts',[own,moves],()=>counts.map(label => {
    const row = document.createElement('div'); row.className = 'count-row'; row.dataset.grade = label;
    const name = document.createElement('span'); name.textContent = label;
    const values = document.createElement('strong'); values.textContent = `${moves.filter(move => move.color === own && move.label === label).length} / ${moves.filter(move => move.color !== own && move.label === label).length}`;
    values.setAttribute('aria-label', `${label}: ${moves.filter(move => move.color === own && move.label === label).length} yours, ${moves.filter(move => move.color !== own && move.label === label).length} opponent`);
    row.append(name, values); return row;
  }));
  el('overview-summary').textContent = '';
  el('overview-summary').hidden = true;
  const note = state.coachingNote;
  const checkedNote = !hidden && ready && !retry && note?.sessionId === state.sessionId && note.gameId === state.gameId && note.revision === state.revision && note.fen === state.fen && typeof note.text === 'string';
  el('coaching-note').hidden = !checkedNote;
  el('coaching-note').textContent = checkedNote ? `AI coach: ${note.text}` : '';
  el('coaching-note').title = checkedNote ? note.text : '';
  el('coach-facts').hidden = checkedNote;
  const branch = Boolean(state.variation?.length);
  const grade = !hidden && ready && !branch ? selected?.classification?.label : undefined;
  const loss = selected?.classification?.loss;
  el('coach-title').textContent = comparison ? 'Compare the better move' : branch ? 'Exploring a continuation' : selected ? `${selected.color === own ? 'Your' : 'Opponent’s'} move` : 'Start your review';
  el('coach-facts').textContent = hidden || !ready ? '' : comparison ? `The checked move replaces ${comparisonAnchor.san || 'the played move'}.` : branch ? 'Explored line · game score unchanged.' : selected ? Number.isFinite(loss) && loss > 0 ? `Winning chances −${loss.toFixed(1)} points` : '' : 'Step through your game.';
  el('coach-facts').hidden = checkedNote || !el('coach-facts').textContent;
  const better = !hidden && ready && !retry && !branch && selected && Number.isInteger(selected.ply) && selected.ply > 0 && ['Inaccuracy', 'Mistake', 'Blunder', 'Miss'].includes(grade);
  el('coach-next-action').hidden = hidden || !ready || retry || checkedNote;
  el('coach-next-action').textContent = comparison ? 'Resume to compare with your game.' : branch ? 'Move a piece to continue exploring.' : better ? 'See the better move on the board.' : 'Move a piece to explore.';
  el('show-better').hidden = !better; el('show-better').disabled = busy || !better;
  el('resume-played').hidden = !comparison; el('resume-played').disabled = busy || !comparison;
  el('coach-return').hidden = hidden || retry || !branch || Boolean(comparison);
  el('coach-return').disabled = busy || el('coach-return').hidden;
  const canExplain = !hidden && ready && !retry && (selected || branch) && canonicalSynced;
  el('explain-move').hidden = !canExplain;
  el('explain-move').disabled = busy || !canExplain || explainInFlight || contextRevision !== state.revision;
  el('explain-move').textContent = explainInFlight ? 'Thinking…' : 'Explain visually';
  renderVisualCoach();
  if (hidden || lastExplained !== evidenceKey()) { el('coach-message').hidden = true; el('coach-message').textContent = ''; }
  el('evaluation-chart').hidden = hidden || retry || !ready || !moves.length;
  retainChildren('evaluation-graph',moves,()=>moves.map(move => {
    const score = Number.isFinite(move.mate) ? move.mate > 0 ? 8 : move.mate < 0 ? -8 : 0 : Number.isFinite(move.cp) ? Math.max(-8, Math.min(8, move.cp / 100)) : 0;
    const button = momentButton('', () => { reviewStarted = true; void mutate('go_to_move', { ply: move.ply }); }, busy);
    button.className = 'evaluation-point'; button.setAttribute('style', `--advantage:${score};`);
    button.setAttribute('aria-label', `${moveLabel(move.ply, move.san)} · ${move.label || ''} · ${Number.isFinite(move.mate) ? `mate ${move.mate}` : Number.isFinite(move.cp) ? `White ${(move.cp / 100).toFixed(2)}` : 'Evaluation unavailable'}`);
    button.setAttribute('aria-current', String(!branch && move.ply === state.selectedPly));
    return button;
  }), (button,index)=>{button.disabled=busy;button.setAttribute('aria-current',String(!branch && moves[index].ply===state.selectedPly));});
  el('moves-panel').hidden = hidden || retry;
  const played = !hidden && !retry ? state.playedMoves || [] : [];
  retainChildren('move-list',[played,moves],()=>played.map((san, index) => {
    const assessment = moves.find(move => move.ply === index + 1);
    const button = momentButton(`${moveLabel(index + 1, san)}${assessment?.label ? ` · ${assessment.label}` : ''}`, () => { reviewStarted = true; void mutate('go_to_move', { ply: index + 1 }); }, busy);
    button.dataset.grade = assessment?.label || ''; button.setAttribute('aria-current', String(!branch && state.selectedPly === index + 1)); return button;
  }), (button,index)=>{button.disabled=busy;button.setAttribute('aria-current',String(!branch && state.selectedPly===index+1));});
  const moments = reviewMoments();
  el('next-moment').disabled = busy || retry || !moments.length;
  el('next-moment').textContent = moments.some(move => move.ply > state.selectedPly) ? 'Next key moment' : 'First key moment';
}

async function explainMove() {
  if (!state || explainInFlight || manualInFlight || !canonicalSynced || retryHidden() || state.retry || !readyAnalysis()) return;
  const snapshot = { sessionId: state.sessionId, revision: state.revision, gameId: state.gameId, selectedPly: state.selectedPly, fen: state.fen, variation: [...(state.variation || [])] };
  const identity = JSON.stringify(snapshot);
  explainInFlight = true; clearError(); renderGuidedReview();
  try {
    const nativeMessage = extensions.message;
    const sendMessage = nativeMessage?.send ? nativeMessage.send.bind(nativeMessage) : app.getHostCapabilities?.()?.message?.text && typeof app.sendMessage === 'function' ? app.sendMessage.bind(app) : undefined;
    if (!sendMessage) throw new Error('This host cannot send coaching requests from the board. Ask “explain this move” in the native chat, or reopen the board in a supported Codex host.');
    if (contextRevision !== snapshot.revision) throw new Error('The selected position is still connecting to chat. Try Explain this move again when connected.');
    const request={...snapshot,requestId:crypto.randomUUID(),mountId,requestedAt:Date.now()};
    coachingRequest=request;acknowledgedCoachingRequest=undefined;
    queueContext(state); await publishContext();
    const current = { sessionId: state.sessionId, revision: state.revision, gameId: state.gameId, selectedPly: state.selectedPly, fen: state.fen, variation: [...(state.variation || [])] };
    if (JSON.stringify(current) !== identity || retryHidden() || state.retry || !canonicalSynced) throw new Error('The position changed. Choose Explain this move again.');
    if (contextRevision !== snapshot.revision || acknowledgedCoachingRequest!==request.requestId) throw new Error('The selected position is still connecting to chat. Try Explain this move again when connected.');
    const result = await sendMessage({ role: 'user', ...(nativeMessage ? { _meta: { 'openai/message': { target: 'active', send: true } } } : {}), content: [{ type: 'text', text: 'Explain this move visually on my review board, with arrows and playable steps.' }] }, { timeout: 10000 });
    if (result?.isError) throw new Error('The host rejected the coaching request. Ask “explain this move” in the native chat.');
    if (state.sessionId === snapshot.sessionId && state.revision === snapshot.revision && !retryHidden()) { lastExplained = evidenceKey(); if (!visualLesson) startEngineLesson(); el('coach-message').textContent = 'Explanation requested in chat.'; el('coach-message').hidden = false; }
  } catch (error) { reportError(error); }
  finally { explainInFlight = false; if (state) renderGuidedReview(); }
}

function renderRetry(retry) {
  el('retry-panel').hidden = !retry;
  if (!retry) return;
  el('retry-title').textContent = `Retry move ${Math.ceil(retry.ply / 2)}`;
  el('retry-instruction').textContent = retry.requiredOutcome === 'mate' ? 'Choose a move that keeps the checked mating result.' : retry.requiredOutcome === 'draw' ? 'Find a move that preserves the checked drawing result.' : `Choose a sound move for ${state.sideToMove === 'black' ? 'Black' : 'White'}.`;
  const lastAttempt = retry.attempts?.at(-1);
  const checking = lastAttempt?.ready === false && lastAttempt.status === 'pending';
  el('submit-retry').disabled = manualInFlight || !canonicalSynced || checking || Boolean(pendingPromotion);
  el('submit-retry').textContent = checking ? 'Checking…' : 'Check move';
  el('retry-hint').disabled = manualInFlight || !canonicalSynced || Boolean(pendingPromotion);
  el('end-retry').disabled = manualInFlight || !canonicalSynced || Boolean(pendingPromotion);
  el('retry-hint').textContent = retry.hintLevel >= 1 ? 'Reveal checked move' : 'Hint';
  el('retry-hint').hidden = Boolean(retry.answerExposed);
  el('retry-feedback').textContent = lastAttempt ? lastAttempt.ready !== true || lastAttempt.accepted == null ? `${lastAttempt.san}: ${checking ? 'checking the move…' : 'analysis interrupted; try again'}.${lastAttempt.error ? ` ${lastAttempt.error}` : ''}` : `${lastAttempt.san}: ${lastAttempt.accepted ? 'accepted as a sound move' : 'not within the retry tolerance'}. ${retry.hint || ''}` : retry.hint || '';
  el('retry-feedback').hidden = !el('retry-feedback').textContent;
  el('retry-feedback').dataset.outcome = checking ? 'pending' : lastAttempt?.ready !== true || lastAttempt.accepted == null ? 'neutral' : lastAttempt.accepted ? 'accepted' : 'try-again';
  el('retry-answer').hidden = !retry.answerExposed;
  el('retry-answer').textContent = retry.answerExposed && retry.checkedAnswer?.move ? `Checked move: ${retry.checkedAnswer.move}${retry.checkedAnswer.line?.length ? `. Line: ${retry.checkedAnswer.line.join(' ')}` : ''}.` : '';
  el('retry-history').textContent = retry.firstAttempt ? `First attempt: ${retry.firstAttempt.assisted ? 'assisted' : 'unassisted'} · ${retry.attempts.length} attempt${retry.attempts.length === 1 ? '' : 's'} · ${retry.hintsUsed} hint${retry.hintsUsed === 1 ? '' : 's'}. Original score unchanged.` : retry.answerPreviouslyShown ? 'The answer was viewed before this retry.' : 'Your first attempt and hints are recorded separately.';
}

function renderLearning(hidden) {
  const learning = state.learning || {};
  const saved = hidden || state.retry ? [] : learning.savedMistakes || [];
  el('learning-panel').hidden = hidden || Boolean(state.retry);
  el('learning-title').textContent = 'History';
  const mistakes = saved.slice(0,5);
  retainChildren('saved-mistakes',[mistakes,catalog.games],()=>mistakes.map(item => {
    const game = catalog.games.find(game => game.id === item.gameId);
    const opponent = game && (game.playerColor === 'black' ? game.white?.username : game.black?.username);
    return momentButton(`${opponent ? `${opponent} · ` : ''}${moveLabel(item.ply)} · ${item.classification?.label || 'Mistake'}`, () => void openSavedMistake(item), manualInFlight || !canonicalSynced || Boolean(pendingPromotion));
  }),button=>{button.disabled=manualInFlight || !canonicalSynced || Boolean(pendingPromotion);});
  const groups = learning.progress?.groups || [];
  const group = groups.find(item => item.timeClass === state.game?.timeClass && item.timeControl === state.game?.timeControl);
  el('progress').textContent = hidden || state.retry ? '' : group ? `${group.statement}${group.evidenceStatus === 'insufficient_history' ? ' More reviewed games are needed to compare progress.' : ''}` : 'Review imported games to build comparable history.';
}

function renderCatalog(next) {
  if (!Array.isArray(next?.games)) throw new Error('The game catalog is unavailable.');
  const oldUsername = catalog.username;
  catalog = next;
  if (!catalogInitialized) { setGamePicker(!catalog.username && !state?.retry && !catalog.games.length); catalogInitialized = true; }
  if (!el('username').value || el('username').value === oldUsername) el('username').value = catalog.username || '';
  const options = catalog.games.map(game => {
    const option = document.createElement('option'); option.value = game.id;
    const opponent = game.playerColor === 'black' ? game.white?.username : game.black?.username;
    let date = '';
    if (Number.isFinite(game.endTime) && game.endTime > 0) date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(game.endTime * 1000);
    option.textContent = game.fixture ? game.sourceLabel || 'Verification fixture' : `${date ? `${date} · ` : ''}${opponent || 'Opponent'} · ${game.timeClass || ''} ${timeControlLabel(game.timeControl)}`.trim();
    return option;
  });
  if (!options.length) { const option = document.createElement('option'); option.textContent = 'No completed games yet'; options.push(option); }
  el('game').replaceChildren(...options);
  const count = catalog.games.filter(game => !game.fixture).length;
  el('catalog-status').textContent = catalogInFlight ? 'Refreshing games…' : count ? `${count} completed game${count === 1 ? '' : 's'} available.` : catalog.username ? 'No public completed games yet. Recent games may appear later.' : 'Enter your public Chess.com username to import games.';
  if (state) { renderGameIdentity(); renderReviewControls(); }
}

async function loadCatalog({ refresh = false, username = el('username').value.trim(), selectImported = false } = {}) {
  if (!connected || catalogInFlight || (refresh && !username)) return;
  catalogInFlight = true;
  const importSelection = selectImported && state ? { sessionId: state.sessionId, gameId: state.gameId, sample: catalog.games.find(game => game.id === state.gameId)?.fixture || /verification fixture/i.test(state.sourceLabel || '') } : undefined;
  const request = ++catalogRequest;
  el('refresh-games').disabled = true; el('username').disabled = true;
  el('game').disabled = !catalog.games.length || manualInFlight || Boolean(state?.retry);
  el('catalog-status').textContent = refresh ? 'Refreshing games…' : 'Loading games…';
  if (refresh) clearError();
  try {
    const result = unpack(await app.callServerTool({ name: refresh ? 'refresh_games' : 'list_games', arguments: refresh ? { username } : {} }, { timeout: 45000 }));
    if (request === catalogRequest && !disposed) {
      renderCatalog(result);
      if (result.import?.status === 'error') { setGamePicker(true); reportError(new Error(result.import.error?.message || 'Refresh failed. Saved games remain available.')); }
      else if (importSelection?.sample && state?.sessionId === importSelection.sessionId && state.gameId === importSelection.gameId && !state.retry) {
        const game = result.games.filter(game => !game.fixture).sort((a, b) => (b.endTime || 0) - (a.endTime || 0))[0];
        if (game && await mutate('select_game', { gameId: game.id })) { setGamePicker(false); el('game-picker-title').focus(); }
      }
    }
  } catch (error) { reportError(error); }
  finally {
    if (request === catalogRequest) { catalogInFlight = false; renderCatalog(catalog); }
  }
}

async function openSavedMistake(item) {
  if (!state || manualInFlight || state.retry) return;
  if (state.gameId !== item.gameId && !await mutate('select_game', { gameId: item.gameId })) return;
  if (state.gameId !== item.gameId || state.retry) return;
  await mutate('go_to_move', { ply: item.ply });
}

function fenBoard(fen) {
  const ranks = fen.split(' ')[0].split('/');
  if (ranks.length !== 8) throw new Error('Invalid position received.');
  const cells = ranks.flatMap(rank => [...rank].flatMap(char => /[1-8]/.test(char) ? Array(Number(char)).fill(null) : [char]));
  if (cells.length !== 64) throw new Error('Invalid position received.');
  return cells;
}

function renderPromotion() {
  el('promotion-panel').hidden = !pendingPromotion;
  el('promotion-choices').replaceChildren(...(pendingPromotion?.choices || []).map(move => {
    const labels = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
    const choice = pendingPromotion;
    const button = momentButton(labels[move.promotion], () => {
      if (pendingPromotion !== choice || state?.sessionId !== choice.sessionId || state.revision !== choice.revision) return;
      pendingPromotion = undefined;
      render(state, { publish: false });
      void commitBoardMove(move);
    });
    button.setAttribute('aria-label', `Promote to ${labels[move.promotion].toLowerCase()}`);
    return button;
  }));
}

async function commitBoardMove(move) {
  const uci = `${move.from}${move.to}${move.promotion || ''}`;
  const retry = state.retry;
  return retry ? mutate('submit_retry', { retryId: retry.retryId, attemptRevision: retry.attemptRevision, move: uci }) : mutate('show_variation', { moves: [...(state.variation || []), uci] });
}

function onBoardMove(from, to, snapshot) {
  const active = boardCanMove() && state.sessionId === snapshot.sessionId && state.revision === snapshot.revision;
  const candidates = active ? state.legalMoves.filter(move => move.from === from && move.to === to) : [];
  // Chessground draws a drop locally. Replace it immediately with the canonical
  // position; only a successful semantic tool response can display a new FEN.
  if (state) { ground?.cancelMove?.(); render(state, { publish: false }); }
  if (!active) return;
  if (!candidates.length) { reportError(new Error('That move is not legal in this position.')); return; }
  if (candidates.some(move => move.promotion)) {
    const choices = ['q', 'r', 'b', 'n'].flatMap(piece => candidates.filter(move => move.promotion === piece));
    pendingPromotion = { ...snapshot, from, to, choices };
    render(state, { publish: false });
    el('promotion-choices').children[0]?.focus();
    return;
  }
  void commitBoardMove(candidates[0]);
}

function render(next, { publish = true } = {}) {
  if (!next?.sessionId || !Number.isInteger(next.revision)) throw new Error('The review has no valid session or revision.');
  if (state && next.sessionId !== state.sessionId) throw new Error('This view received a different review session.');
  if (state && next.revision < state.revision) return false;
  if (coachingRequest && !requestMatches(coachingRequest,next)) { coachingRequest=undefined;acknowledgedCoachingRequest=undefined; }
  const boardPosition = value => JSON.stringify({ gameId: value.gameId, selectedPly: value.selectedPly, fen: value.fen, variation: value.variation || [], retryId: value.retry?.retryId });
  if (state && boardPosition(state) !== boardPosition(next)) ground?.cancelMove?.();
  if (pendingPromotion && (next.sessionId !== pendingPromotion.sessionId || next.revision !== pendingPromotion.revision)) pendingPromotion = undefined;
  if (state && state.gameId !== next.gameId) { reviewStarted = false; reviewMode = 'review'; comparisonAnchor = undefined; }
  if (next.selectedPly > 0 || next.variation?.length || next.retry) reviewStarted = true;
  state = next;
  updateVisualLesson();
  if (retryHidden()) { positionEvidence = undefined; evidencePending = undefined; evidenceAttempted = undefined; evidenceError = undefined; evidenceRequest++; }
  const cells = fenBoard(state.fen);
  const turnColor = state.sideToMove === 'black' || state.sideToMove === 'b' ? 'black' : 'white';
  const interactive = boardCanMove();
  const dests = new Map();
  if (interactive) for (const move of state.legalMoves) { const destinations = dests.get(move.from) || []; if (!destinations.includes(move.to)) destinations.push(move.to); dests.set(move.from, destinations); }
  const snapshot = { sessionId: state.sessionId, revision: state.revision };
  const best = checkedGuide()?.line[0]?.uci;
  const visualStep = visualLesson?.steps[Math.max(0,visualLesson.step-1)];
  const arrow = visualLesson ? visualStep?.uci : best;
  const autoShapes = arrow ? [{ orig: arrow.slice(0, 2), dest: arrow.slice(2, 4), brush: 'green' }] : [];
  if (visualLesson?.step) for (const square of visualLesson.steps[visualLesson.step-1].focus || []) autoShapes.push({orig:square,brush:'yellow'});
  const boardConfig = {
    fen: state.fen, orientation: state.playerColor === 'black' ? 'black' : 'white', turnColor,
    // viewOnly cannot be changed through Chessground.set. Bind once, and gate
    // movement with canonical legal destinations and movable color instead.
    viewOnly: false, coordinates: true, coordinatesOnSquares: false, ranksPosition: 'left',
    animation: { enabled: !reducedMotion?.matches, duration: 180 }, drawable: { enabled: false, visible: true, autoShapes },
    movable: { free: false, color: interactive ? turnColor : undefined, dests, showDests: true, rookCastle: false, events: { after: (from, to) => onBoardMove(from, to, snapshot) } },
    premovable: { enabled: false }, draggable: { enabled: interactive }, lastMove: lastMoveSquares(),
  };
  if (ground) ground.set(boardConfig);
  else ground = Chessground(el('board'), boardConfig);
  const placement = cells.flatMap((piece, index) => piece ? [`${piece === piece.toUpperCase() ? 'White' : 'Black'} ${pieceNames[piece.toLowerCase()]} ${String.fromCharCode(97 + index % 8)}${8 - Math.floor(index / 8)}`] : []);
  el('accessible-position').textContent = `${turnColor === 'black' ? 'Black' : 'White'} to move. ${placement.join(', ')}.`;
  el('board').setAttribute('aria-label', `${turnColor === 'black' ? 'Black' : 'White'} to move, played ply ${state.selectedPly}${state.variation?.length ? ', variation' : ''}. Move a piece to ${state.retry ? 'retry this decision' : 'explore a variation'}. Use Keyboard moves to enter a move or read piece locations.`);
  el('side').textContent = `${turnColor === 'black' ? 'Black' : 'White'} to move`;
  el('board-instruction').textContent = state.retry ? 'Move a piece to try again' : 'Move a piece to explore';
  el('position').textContent = state.retry ? `Retry ${Math.ceil(state.retry.ply / 2)}` : state.variation?.length ? 'Exploring' : state.selectedPly ? `Move ${Math.ceil(state.selectedPly / 2)}` : 'Start';
  el('position').title = state.variation?.length ? `Variation from played ply ${state.selectedPly}: ${state.variation.join(' ')}` : '';
  el('previous').disabled = !state.variation?.length && navigationPly() === 0 || navigationBlocked();
  const totalPlies = state.totalPlies ?? state.playedMoves?.length;
  el('next').disabled = navigationBlocked() || (Number.isInteger(totalPlies) && navigationPly() >= totalPlies);
  el('return').disabled = manualInFlight;
  el('show-variation').disabled = manualInFlight;
  el('summary').textContent = retryHidden() ? '' : state.sourceLabel || '';
  renderGameIdentity();
  renderReviewControls();
  renderPromotion();
  displayedRevision = state.revision;
  redrawStatus();
  if (publish) queueContext(state);
  void fetchVariationEvidence();
  void recordDisplayedGuide();
  return true;
}

function requestMatches(request,snapshot) {
  return request.sessionId===snapshot.sessionId && request.gameId===snapshot.gameId && request.revision===snapshot.revision && request.selectedPly===snapshot.selectedPly && request.fen===snapshot.fen && JSON.stringify(request.variation)===JSON.stringify(snapshot.variation || []);
}
function queueContext(snapshot) {
  if (!canonicalSynced) return;
  pendingContext = snapshot;
  void publishContext();
}

function publishContext() {
  if (contextPublication) return contextPublication;
  if (!connected || !canonicalSynced || !pendingContext || disposed || Date.now() < contextRetryAfter) return;
  if (!extensions.modelContext) { redrawStatus(); return; }
  contextPublication=(async () => {
  try {
    while (pendingContext && !disposed) {
      const snapshot = pendingContext;
      pendingContext = undefined;
      const request=coachingRequest && requestMatches(coachingRequest,snapshot) ? coachingRequest : undefined;
      const instructions=request ? `\nVisual coaching request from this mount: ${request.requestId}, requested at ${request.requestedAt}. The next brief Explain message refers to this exact request. Resolve this explicit request; stop if concurrent requests are ambiguous. Read get_review_context for session ${request.sessionId}; require revision ${request.revision} and FEN ${request.fen}. If it changed, stop. Read get_position_evidence and use its checkedContinuation. Call publish_coaching_visual with this sessionId and expectedRevision, a short title, and 1 to 4 steps whose moves are an exact prefix of checkedContinuation. Each label is at most 48 characters: a plain-language idea such as "Protect the pawn" or "Attack the queen". No chess notation, square names, or paragraphs in titles or labels. focus may highlight up to 4 occupied squares after that step. Cover the opponent's checked response and the useful consequence when available. Do not invent engine facts, change the board, start a retry, or change scores. The user controls playback. Do not publish a text coaching note. Keep the chat response to a brief confirmation that the visual steps are on the board; no notation lecture.` : '';
      const acknowledgement = await extensions.modelContext.update({
        content: [{ type: 'text', text: `Current chess review ${snapshot.sessionId}, revision ${snapshot.revision}, selected ply ${snapshot.selectedPly}. ${snapshot.summary || ''}\nFEN: ${snapshot.fen}\nUse semantic chess tools with this explicit session and revision.${instructions}` }],
        structuredContent: { ...snapshot, mountId,...(request ? {coachingRequest:request} : {}) },
      }, { timeout: 10000 });
      if (acknowledgement?.updateId && state?.sessionId === snapshot.sessionId && state.revision === snapshot.revision) {
        contextRevision = snapshot.revision;
        contextUpdateId = acknowledgement.updateId;
        if (request && coachingRequest===request && requestMatches(request,state)) acknowledgedCoachingRequest=request.requestId;
      } else if (!acknowledgement?.updateId) {
        throw new Error('The host did not acknowledge the selected-position context.');
      }
      contextRetryAfter = 0;
      contextRetryDelay = 1500;
      if (contextFailure && el('error').textContent === contextFailure) clearError();
      contextFailure = undefined;
      redrawStatus();
    }
  } catch (error) {
    // Retry the latest rendered state, including navigation that happened while
    // the failed host request was in flight. The normal sync loop bounds retries.
    if (state && (contextRevision !== state.revision || coachingRequest && acknowledgedCoachingRequest!==coachingRequest.requestId)) pendingContext = state;
    contextRetryAfter = Date.now() + contextRetryDelay;
    contextRetryDelay = Math.min(contextRetryDelay * 2, 15000);
    contextFailure = error?.message || String(error);
    reportError(error);
  } finally { contextPublication=undefined; }
  })();
  return contextPublication;
}

async function sync() {
  if (!connected || !state || pollInFlight || disposed || document.hidden) return;
  pollInFlight = true;
  try {
    const requestedSession = state.sessionId;
    const response = unpack(await app.callServerTool({ name: 'sync_review_view', arguments: {
      sessionId: requestedSession, mountId, knownRevision: state.revision,
      displayedRevision,
      ...(contextRevision == null ? {} : { contextRevision, contextUpdateId }),
    } }, { timeout: 10000 }));
    if (state.sessionId !== requestedSession) return;
    if (!canonicalSynced) {
      if (!response.state) throw new Error('The canonical review state is unavailable. Reopen the board to reconnect.');
      if (!render(response.state, { publish: false })) throw new Error('The canonical review revision is older than this cached view. Reopen the board to reconnect.');
      canonicalSynced = true;
      render(state, { publish: false });
      queueContext(state);
    } else if (response.state && (response.changed || response.state.revision > state.revision || JSON.stringify(response.state.coachingNote) !== JSON.stringify(state.coachingNote))) render(response.state);
    await publishContext();
    pollDelay = 1500;
  } catch (error) {
    reportError(error);
    pollDelay = Math.min(pollDelay * 2, 15000);
  } finally { pollInFlight = false; }
}

function scheduleSync() {
  clearTimeout(pollTimer);
  if (!disposed) pollTimer = setTimeout(async () => { await sync(); scheduleSync(); }, pollDelay);
}

async function navigateTo(ply) {
  if (!state || navigationBlocked() || !Number.isInteger(ply)) return;
  const total = state.totalPlies ?? state.playedMoves?.length;
  const target = Math.max(0,Number.isInteger(total) ? Math.min(ply,total) : ply);
  if (!navigationIntent) navigationIntent = {sessionId:state.sessionId,gameId:state.gameId,ply:target};
  else navigationIntent.ply = target;
  if (navigationRun) { render(state,{publish:false}); return navigationRun; }
  // One outstanding guarded commit plus one replaceable destination. The board
  // continues displaying committed state while repeated clicks update intent.
  navigationRun = (async () => {
    let committed;
    try {
      while (navigationIntent && !disposed) {
        const intent = {...navigationIntent};
        if (state.sessionId !== intent.sessionId || state.gameId !== intent.gameId || retryHidden()) break;
        committed = await mutate('go_to_move',{ply:intent.ply},true);
        if (!committed || state.sessionId !== intent.sessionId || state.gameId !== intent.gameId ||
            state.selectedPly !== committed.selectedPly || state.fen !== committed.fen || JSON.stringify(state.variation) !== JSON.stringify(committed.variation)) break;
        if (navigationIntent.ply === intent.ply) return committed;
      }
    } finally { navigationIntent=undefined;navigationRun=undefined;if(state)render(state,{publish:false}); }
  })();
  return navigationRun;
}
async function mutate(name, args = {}, navigationCommit = false) {
  if (name === 'go_to_move' && !navigationCommit) return navigateTo(args.ply);
  if (!state || !canonicalSynced || manualInFlight || pendingPromotion) return;
  const fingerprint = value => JSON.stringify({ sessionId: value.sessionId, gameId: value.gameId, selectedPly: value.selectedPly, fen: value.fen, variation: value.variation || [], retryId: value.retry?.retryId, attemptRevision: value.retry?.attemptRevision });
  const intentPosition = fingerprint(state), intentRevision = state.revision;
  const intentDrawer = activeDrawer;
  manualInFlight = true;
  clearError();
  render(state, { publish: false });
  let committed;
  try {
    const sessionId = state.sessionId;
    const issue = async () => unpack(await app.callServerTool({ name, arguments: { sessionId, expectedRevision: state.revision, ...args } }, { timeout: name === 'submit_retry' ? 45000 : 10000 }));
    let result;
    try { result = await issue(); }
    catch (error) {
      if (name === 'submit_retry' || !/^Stale revision\b/i.test(error.message || '')) throw error;
      const refreshed = unpack(await app.callServerTool({ name: 'get_review_context', arguments: { sessionId } }, { timeout: 10000 }));
      render(refreshed.state || refreshed);
      if (state.revision <= intentRevision || fingerprint(state) !== intentPosition) throw new Error('The position changed. Choose your move again.');
      clearError();
      result = await issue();
    }
    const returned = result.state || result;
    if (state.sessionId === sessionId && render(returned)) { committed = state; if (intentDrawer && intentDrawer !== 'game-picker-title' && activeDrawer === intentDrawer) { closeDrawers(); el('position').focus(); } }
  } catch (error) { reportError(error); await sync(); }
  finally { manualInFlight = false; if (state) render(state, { publish: false }); }
  return committed;
}

el('previous').addEventListener('click', () => { if (state) void (state.variation?.length ? state.variation.length === 1 ? mutate('return_to_game') : mutate('show_variation', { moves: state.variation.slice(0, -1) }) : mutate('go_to_move', { ply: Math.max(0, navigationPly() - 1) })); });
el('next').addEventListener('click', () => { if (state) void mutate('go_to_move', { ply: navigationPly() + 1 }); });
el('return').addEventListener('click', () => { const ply = comparisonAnchor?.ply; comparisonAnchor = undefined; void (ply ? mutate('go_to_move', { ply }) : mutate('return_to_game')); });
el('import-form').addEventListener('submit', event => { event.preventDefault(); void loadCatalog({ refresh: true, selectImported: true }); });
el('game-picker-title').addEventListener('click', () => setGamePicker(el('game-picker').hidden));
for (const [id, focus] of [['variation-panel', 'keyboard-toggle'], ['learning-panel', 'learning-title'], ['moves-panel', 'moves-toggle']]) {
  el(id).addEventListener('toggle', () => {
    if (el(id).open) { setGamePicker(false); for (const other of ['variation-panel', 'learning-panel', 'moves-panel']) if (other !== id) el(other).open = false; activeDrawer = focus; }
    else if (activeDrawer === focus) activeDrawer = undefined;
    el('workspace-content').inert = Boolean(activeDrawer);
    if (state) render(state, { publish: false });
  });
}
el('game').addEventListener('change', () => { if (state && el('game').value && el('game').value !== state.gameId) void mutate('select_game', { gameId: el('game').value }).then(committed => { if (committed) { setGamePicker(false); el('game-picker-title').focus(); } }); });
el('review-mode').addEventListener('click', () => { if (!state) return; reviewMode = 'review'; render(state, { publish: false }); });
el('engine-mode').addEventListener('click', () => { if (!state) return; reviewMode = 'engine'; reviewStarted = true; render(state, { publish: false }); });
el('overview-toggle').addEventListener('click', () => { if (state && readyAnalysis() && !state.retry) void mutate('go_to_move', { ply: 0 }).then(committed => { if (committed) { reviewStarted = false; reviewMode = 'review'; render(state, { publish: false }); } }); });
el('start-review').addEventListener('click', () => { reviewStarted = true; reviewMode = 'review'; void mutate('go_to_move', { ply: 1 }); });
el('next-moment').addEventListener('click', () => { const moments = reviewMoments(); const moment = moments.find(move => move.ply > state.selectedPly) || moments[0]; if (moment) { reviewStarted = true; void mutate('go_to_move', { ply: moment.ply }); } });
el('show-better').addEventListener('click', () => {
  const selected = state?.analysis?.selectedMove;
  if (!selected || retryHidden() || state.retry || state.variation?.length || !readyAnalysis()) return;
  const anchor = { sessionId: state.sessionId, gameId: state.gameId, ply: selected.ply, san: selected.san };
  void mutate('show_best_move', { ply: selected.ply }).then(committed => {
    if (committed && committed.gameId === anchor.gameId && committed.selectedPly === anchor.ply - 1 && committed.variation?.length) { comparisonAnchor = { ...anchor, firstMove: committed.variation[0] }; render(state, { publish: false }); }
  });
});
el('resume-played').addEventListener('click', () => { const ply = comparisonAnchor?.ply; comparisonAnchor = undefined; if (ply) void mutate('go_to_move', { ply }); });
el('coach-return').addEventListener('click', () => { if (state?.variation?.length && !state.retry) void mutate('return_to_game'); });
el('explain-move').addEventListener('click', () => void explainMove());
el('visual-back').addEventListener('click',()=>void moveVisualStep(visualLesson.step-1));
el('visual-play').addEventListener('click',()=>void moveVisualStep(visualLesson.step === visualLesson.steps.length ? 0 : visualLesson.step+1));
el('visual-close').addEventListener('click',async()=>{
  const lesson=visualLesson;
  if (!lesson) return;
  const committed=await moveVisualStep(0),anchor=visualPosition(lesson,0);
  if (committed && visualLesson===lesson && committed.fen===anchor.fen && JSON.stringify(committed.variation)===JSON.stringify(anchor.variation)) {
    dismissedVisual=lesson.id;visualLesson=undefined;render(state,{publish:false});
  }
});
el('engine-toggle').addEventListener('click', () => { engineEnabled = !engineEnabled; if (state) render(state, { publish: false }); });
el('engine-play').addEventListener('click', () => { const move = checkedGuide()?.line[0]?.uci; if (move && !state.retry) void mutate('show_variation', { moves: [...(state.variation || []), move] }); });
el('analyze').addEventListener('click', () => void mutate('analyze_game'));
el('start-retry').addEventListener('click', () => { if (state?.analysis?.selectedMove) { el('retry-move').value = ''; void mutate('start_retry', { ply: state.analysis.selectedMove.ply, answerPreviouslyShown: true }).then(committed => { if (committed?.retry) el('position').focus(); }); } });
el('retry-form').addEventListener('submit', event => {
  event.preventDefault();
  const retry = state?.retry, move = el('retry-move').value.trim();
  if (retry && move) void mutate('submit_retry', { retryId: retry.retryId, attemptRevision: retry.attemptRevision, move });
});
el('retry-hint').addEventListener('click', () => { const retry = state?.retry; if (retry) void mutate('retry_hint', { retryId: retry.retryId, attemptRevision: retry.attemptRevision }); });
el('end-retry').addEventListener('click', () => void mutate('end_retry').then(committed => { if (committed && !committed.retry) el('position').focus(); }));
function cancelPromotion() { pendingPromotion = undefined; if (state) render(state, { publish: false }); el('position').focus(); }
el('cancel-promotion').addEventListener('click', cancelPromotion);
el('variation-form').addEventListener('submit', event => {
  event.preventDefault();
  const moves = el('variation').value.trim().split(/\s+/).filter(Boolean);
  if (moves.length) void mutate('show_variation', { moves: [...(state?.variation || []), ...moves] });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && pendingPromotion) { event.preventDefault(); cancelPromotion(); return; }
  if (event.key === 'Escape' && activeDrawer) { event.preventDefault(); closeDrawers(); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); el('previous').click(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); el('next').click(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void sync(); scheduleSync(); } });
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(pollTimer);clearTimeout(launchTimer);ground?.destroy(); });
app.addEventListener('hostcontextchanged', applyHostContext);
app.ontoolinput = params => {
  if (launchReceived || state) return;
  try {
    const input = params.arguments || {}, next = {};
    for (const key of ['sessionId','gameId']) if (key in input) {
      if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`The launch ${key} is invalid. Reopen the review with its saved session or game.`);
      next[key] = input[key];
    }
    launchArguments = next;launchInputError=undefined;
  } catch(error) { launchInputError=error;reportError(error); }
};
app.ontoolresult = result => {
  if (launchReceived || state || disposed) return;
  try {
    const payload = unpack(result);
    if (render(payload.state || payload, { publish: false })) {
      launchReceived = true;clearTimeout(launchTimer);el('retry-launch').hidden=true;
      if (connected) void sync();
    }
  } catch (error) { reportError(error); }
};
async function recoverLaunch() {
  if (!connected || disposed || launchRecoveryInFlight || canonicalSynced) return;
  launchRecoveryInFlight=true;el('retry-launch').disabled=true;clearError();
  try {
    if (!state && !launchReceived) {
      if (launchInputError) throw launchInputError;
      const args={...launchArguments}, identity=JSON.stringify(args);
      el('status').textContent='Opening this review…';
      // {} is open_review's declared verification-fixture default. Never infer
      // a session from another mount, the catalog, or neighboring global view.
      const result=unpack(await app.callServerTool({name:'open_review',arguments:args},{timeout:10000}));
      if (disposed || launchReceived || state) return;
      if (identity!==JSON.stringify(launchArguments)) throw new Error('The launch arguments changed. Retry opening this review.');
      const next=result.state || result;
      if (args.sessionId && next.sessionId!==args.sessionId || args.gameId && next.gameId!==args.gameId) throw new Error('The returned review does not match the requested saved session or game.');
      render(next,{publish:false});launchReceived=true;clearTimeout(launchTimer);
    }
    await sync();
    if (!canonicalSynced) throw new Error('The saved review could not be confirmed with its backend.');
    el('retry-launch').hidden=true;clearError();
  } catch(error) {
    if (!canonicalSynced) { reportError(new Error(`Could not open this review. Retry opening review. ${error.message || error}`));el('retry-launch').hidden=false;el('status').textContent='Review launch failed. Retry opening review.'; }
  } finally { launchRecoveryInFlight=false;el('retry-launch').disabled=false; }
}
el('retry-launch').addEventListener('click',()=>void recoverLaunch());

async function start() {
try {
  await app.connect();
  connected = true;
  applyHostContext(app.getHostContext());
  const host = app.getHostContext();
  if (host?.displayMode !== 'fullscreen' && host?.availableDisplayModes?.includes('fullscreen')) {
    await app.requestDisplayMode({ mode: 'fullscreen' });
  }
  await sync();
  scheduleSync();
  await loadCatalog();
  if (catalog.username) void loadCatalog({ refresh: true, username: catalog.username });
  if (!state) { el('status').textContent = 'Waiting for the review launch state…';launchTimer=setTimeout(()=>recoverLaunch(),2500); }
} catch (error) { reportError(error); el('status').textContent = 'Native connection unavailable.'; }
}
void start();
