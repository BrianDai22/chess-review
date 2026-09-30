import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { Chessground } from '@lichess-org/chessground';

const pieceNames = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const app = new App({ name: 'Chess Review', version: '0.1.0' });
const extensions = new OpenAIExtensions(app);
const mountId = crypto.randomUUID();
let state;
let launchReceived = false;
let connected = false;
let disposed = false;
let pollInFlight = false;
let pollTimer;
let pollDelay = 1500;
let displayedRevision;
let contextRevision;
let contextUpdateId;
let pendingContext;
let contextInFlight = false;
let contextRetryAfter = 0;
let contextRetryDelay = 1500;
let contextFailure;
let manualInFlight = false;
let ground;
let canonicalSynced = false;
let catalog = { username: null, games: [] };
let catalogInFlight = false;
let catalogRequest = 0;
let catalogInitialized = false;
let pendingPromotion;

document.body.innerHTML = `<main class="review" aria-label="Chess review">
  <header class="workspace-header"><h1>Chess Review</h1><button class="btn btn-secondary" id="game-picker-title" type="button" aria-expanded="false" aria-controls="game-picker">Games</button></header>
  <section id="game-picker" class="game-picker" aria-label="Game selection" hidden>
    <div class="picker-content"><label class="form-label" for="game">Completed games</label><select id="game" class="form-control" disabled><option>Loading games…</option></select>
    <form id="import-form"><label class="form-label" for="username">Chess.com username</label><div class="import-row"><input id="username" class="form-control" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Your public username"/><button id="refresh-games" class="btn btn-primary cursor-interaction" type="submit" disabled>Import games</button></div></form>
    <p id="catalog-status" class="muted" aria-live="polite"></p></div>
  </section>
  <section class="game-identity" aria-label="Current game"><h2 id="game-title">Review game</h2><p id="game-meta" class="muted" hidden></p><p id="game-source" class="source-note" hidden></p></section>
  <section class="board-workspace" aria-label="Selected position">
    <div class="player-bar" id="opponent-bar"><span class="player-piece" id="opponent-piece" aria-hidden="true"></span><div class="player-identity"><strong id="opponent-name"></strong><span id="opponent-rating" class="muted"></span></div><span id="opponent-turn" class="turn-indicator" hidden>To move</span></div>
    <div class="board-shell"><div id="board" class="board cg-wrap" role="img" aria-label="Chess position" aria-describedby="accessible-position"></div></div>
    <fieldset id="promotion-panel" class="promotion-panel" hidden><legend>Choose promotion</legend><div id="promotion-choices" class="promotion-choices"></div><button id="cancel-promotion" class="btn btn-secondary" type="button">Cancel</button></fieldset>
    <div class="player-bar" id="player-bar"><span class="player-piece" id="player-piece" aria-hidden="true"></span><div class="player-identity"><strong id="player-name"></strong><span id="player-rating" class="muted"></span></div><span id="player-turn" class="turn-indicator" hidden>To move</span></div>
    <nav class="move-navigation" aria-label="Played line navigation"><button id="previous" class="btn btn-secondary cursor-interaction" type="button" aria-label="Previous move" disabled>Previous</button><span id="position" tabindex="-1" aria-live="polite">Start position</span><button id="next" class="btn btn-secondary cursor-interaction" type="button" aria-label="Next move" disabled>Next</button></nav>
    <button id="return" class="btn btn-secondary return-action cursor-interaction" type="button" disabled hidden>Return to played line</button>
  </section>
  <section class="review-results" aria-label="Game analysis"><div class="assessment" id="assessment" hidden><div class="metric accuracy-metric" id="accuracy-assessment"><span class="metric-label">Your accuracy</span><strong id="accuracy"></strong></div><div class="metric" id="move-assessment"><span class="metric-label">Selected move</span><strong id="classification" class="classification"></strong></div><div class="metric" id="position-assessment"><span class="metric-label">Position</span><strong id="evaluation"></strong></div></div>
    <div class="review-actions" id="review-actions"><button id="analyze" class="btn btn-primary cursor-interaction" type="button" disabled>Analyze game</button><div class="analysis-progress" id="analysis-progress" hidden><p id="analysis-status" aria-live="polite"></p><progress id="analysis-meter" aria-label="Game analysis progress" hidden></progress></div><button id="start-retry" class="btn btn-secondary cursor-interaction" type="button" disabled hidden>Retry this move</button></div>
    <section id="key-moments-panel" aria-label="Key moments" hidden><h2>Key moments</h2><div id="key-moments" class="moment-list"></div></section>
  </section>
  <section id="retry-panel" class="retry-panel" aria-label="Retry decision" hidden><h2 id="retry-title">Retry this decision</h2><p id="retry-instruction"></p><form id="retry-form"><label class="form-label" for="retry-move">Your move</label><div class="variation-input"><input id="retry-move" class="form-control" autocomplete="off" spellcheck="false" aria-describedby="retry-format" placeholder="Nf3 or g1f3"/><button id="submit-retry" class="btn btn-primary cursor-interaction" type="submit" disabled>Check move</button></div><span id="retry-format" class="sr-only">Use chess notation, such as Nf3, or from-to notation, such as g1f3.</span></form><p id="retry-feedback" class="retry-feedback" aria-live="polite" hidden></p><p id="retry-answer" class="checked-answer" hidden></p><div class="retry-actions"><button id="retry-hint" class="btn btn-secondary cursor-interaction" type="button" disabled>Hint</button><button id="end-retry" class="btn btn-secondary cursor-interaction" type="button" disabled>Back to review</button></div><details class="retry-record"><summary>Attempt record</summary><p id="retry-history" class="muted"></p></details></section>
  <div class="secondary-tools"><details id="variation-panel"><summary>Explore a variation</summary><form id="variation-form"><label class="form-label" for="variation">Moves from this position</label><div class="variation-input"><input class="form-control" id="variation" autocomplete="off" aria-label="Variation moves in SAN or from-to notation" placeholder="Nf3 Nc6 or g1f3 b8c6"/><button id="show-variation" class="btn btn-secondary cursor-interaction" type="submit" disabled>Show</button></div></form></details>
    <details id="learning-panel" class="learning-panel"><summary id="learning-title">Saved mistakes & progress</summary><div id="saved-mistakes" class="moment-list"></div><p id="progress" class="muted"></p></details>
    <details id="position-details" class="position-details"><summary>Piece locations</summary><p id="accessible-position"></p></details>
  </div>
  <p id="summary" class="sr-only"></p><p id="side" class="sr-only"></p><p id="status" class="sr-only" aria-live="polite">Connecting to native chat…</p><p id="error" role="alert" hidden></p>
</main>`;
const el = id => document.getElementById(id);
for (const id of ['previous', 'next', 'return', 'show-variation', 'analyze', 'start-retry', 'submit-retry', 'retry-hint', 'end-retry', 'refresh-games', 'game']) el(id).disabled = true;

function reportError(error) {
  el('error').hidden = false;
  el('error').textContent = error?.message || String(error);
}

function clearError() { el('error').hidden = true; el('error').textContent = ''; }
function setGamePicker(open) { el('game-picker').hidden = !open; el('game-picker-title').setAttribute('aria-expanded', String(Boolean(open))); }

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
function boardCanMove() { return canonicalSynced && !manualInFlight && !pendingPromotion && !retryChecking() && Boolean(state?.legalMoves?.length); }
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
  }
  const timeClass = game.timeClass || selectedGame?.timeClass;
  const control = timeControlLabel(game.timeControl || selectedGame?.timeControl || '');
  const fixture = selectedGame?.fixture || /verification fixture/i.test(state.sourceLabel || '');
  el('game-title').textContent = fixture ? 'Sample game' : timeClass ? `${timeClass[0].toUpperCase()}${timeClass.slice(1)}${control ? ` · ${control}` : ''}` : 'Game review';
  const date = selectedGame?.endTime > 0 ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(selectedGame.endTime * 1000) : '';
  el('game-meta').textContent = date;
  el('game-meta').hidden = !date;
  el('game-source').textContent = fixture ? state.sourceLabel || selectedGame.sourceLabel || 'Verification fixture' : '';
  el('game-source').hidden = !fixture;
}

function renderReviewControls() {
  const analysis = state.analysis || {};
  const hidden = retryHidden(), retry = state.retry;
  const ready = readyAnalysis(), selected = analysis.selectedMove;
  const busy = manualInFlight || !canonicalSynced || Boolean(pendingPromotion);
  el('assessment').hidden = hidden || !ready;
  el('accuracy').textContent = hidden ? '' : ready && Number.isFinite(analysis.playerAccuracy) ? analysis.playerAccuracy.toFixed(1) : '';
  el('accuracy-assessment').hidden = !el('accuracy').textContent;
  const evidence = analysis.currentPosition;
  el('evaluation').textContent = hidden || !ready || (state.variation?.length && evidence?.fen !== state.fen) ? '' : evalLabel(evidence);
  const grade = !hidden && ready ? retry?.answerExposed ? retry.originalClassification?.label || '' : selected?.classification?.label || '' : '';
  el('classification').textContent = grade ? `${retry ? 'Original: ' : selected?.san ? `${selected.san} · ` : ''}${grade}` : '';
  el('classification').dataset.grade = grade || '';
  el('move-assessment').hidden = !grade;
  el('position-assessment').hidden = !el('evaluation').textContent;
  const busyAnalysis = ['analyzing'].includes(analysis.readiness);
  el('analyze').disabled = busy || Boolean(retry) || busyAnalysis || ready;
  el('analyze').hidden = ready || Boolean(retry) || busyAnalysis;
  el('analyze').textContent = ['failed', 'interrupted'].includes(analysis.readiness) ? 'Resume analysis' : 'Analyze game';
  const total = analysis.totalPositions, completed = analysis.completedPositions || 0;
  el('analysis-status').textContent = hidden || retry ? '' : analysis.error || (busyAnalysis ? `Analyzing game${Number.isInteger(total) && total > 0 ? ` · ${completed} of ${total} positions` : '…'}` : '');
  el('analysis-progress').hidden = !el('analysis-status').textContent;
  el('analysis-meter').hidden = !busyAnalysis || !Number.isInteger(total) || total <= 0 || Boolean(retry);
  if (Number.isInteger(total) && total > 0) { el('analysis-meter').max = total; el('analysis-meter').value = Math.min(completed, total); }
  const mover = selected?.color || selected?.before?.sideToMove || selected?.best?.sideToMove;
  const player = state.playerColor === 'black' ? 'b' : 'w';
  el('start-retry').disabled = busy || Boolean(retry) || !ready || !selected || mover !== player;
  el('start-retry').hidden = Boolean(retry) || !ready || !selected || mover !== player;
  el('review-actions').hidden = el('analyze').hidden && el('start-retry').hidden && el('analysis-progress').hidden;
  el('variation-form').hidden = Boolean(retry);
  el('variation-panel').hidden = Boolean(retry);
  el('return').hidden = !state.variation?.length || Boolean(retry);
  el('previous').disabled ||= hidden || busy;
  el('next').disabled ||= hidden || busy;
  el('return').disabled ||= hidden || busy;
  el('show-variation').disabled ||= busy;
  el('game').disabled = busy || Boolean(retry) || !catalog.games.length;
  el('refresh-games').disabled = catalogInFlight || busy || Boolean(retry);
  el('username').disabled = catalogInFlight || Boolean(retry) || Boolean(pendingPromotion);
  el('game').value = state.gameId;
  const moments = !hidden && ready ? (analysis.keyMoments || []) : [];
  el('key-moments-panel').hidden = !moments.length || Boolean(retry);
  el('key-moments').replaceChildren(...moments.map(moment => {
    const ply = typeof moment === 'number' ? moment : moment.ply;
    const button = momentButton(`${moveLabel(ply, moment.san || '')}${moment.label ? ` · ${moment.label}` : ''}`, () => void mutate('go_to_move', { ply }), busy);
    button.dataset.grade = moment.label || '';
    button.setAttribute('aria-current', ply === state.selectedPly ? 'true' : 'false');
    return button;
  }));
  renderRetry(retry);
  renderLearning(hidden);
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
  el('learning-title').textContent = 'Saved mistakes & progress';
  el('saved-mistakes').replaceChildren(...saved.slice(0, 5).map(item => {
    const game = catalog.games.find(game => game.id === item.gameId);
    const opponent = game && (game.playerColor === 'black' ? game.white?.username : game.black?.username);
    return momentButton(`${opponent ? `${opponent} · ` : ''}${moveLabel(item.ply)} · ${item.classification?.label || 'Mistake'}`, () => void openSavedMistake(item), manualInFlight || !canonicalSynced || Boolean(pendingPromotion));
  }));
  const groups = learning.progress?.groups || [];
  const group = groups.find(item => item.timeClass === state.game?.timeClass && item.timeControl === state.game?.timeControl);
  el('progress').textContent = hidden || state.retry ? '' : group ? `${group.statement}${group.evidenceStatus === 'insufficient_history' ? ' More reviewed games are needed to compare progress.' : ''}` : 'Review imported games to build comparable history.';
}

function renderCatalog(next) {
  if (!Array.isArray(next?.games)) throw new Error('The game catalog is unavailable.');
  const oldUsername = catalog.username;
  catalog = next;
  if (!catalogInitialized) { setGamePicker(!catalog.username && !state?.retry); catalogInitialized = true; }
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

async function loadCatalog({ refresh = false, username = el('username').value.trim() } = {}) {
  if (!connected || catalogInFlight || (refresh && !username)) return;
  catalogInFlight = true;
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
  if (pendingPromotion && (next.sessionId !== pendingPromotion.sessionId || next.revision !== pendingPromotion.revision)) pendingPromotion = undefined;
  state = next;
  const cells = fenBoard(state.fen);
  const turnColor = state.sideToMove === 'black' || state.sideToMove === 'b' ? 'black' : 'white';
  const interactive = boardCanMove();
  const dests = new Map();
  if (interactive) for (const move of state.legalMoves) { const destinations = dests.get(move.from) || []; if (!destinations.includes(move.to)) destinations.push(move.to); dests.set(move.from, destinations); }
  const snapshot = { sessionId: state.sessionId, revision: state.revision };
  const boardConfig = {
    fen: state.fen, orientation: state.playerColor === 'black' ? 'black' : 'white', turnColor,
    // viewOnly cannot be changed through Chessground.set. Bind once, and gate
    // movement with canonical legal destinations and movable color instead.
    viewOnly: false, coordinates: true, coordinatesOnSquares: false, ranksPosition: 'left',
    animation: { enabled: false }, drawable: { enabled: false, visible: false },
    movable: { free: false, color: interactive ? turnColor : undefined, dests, showDests: true, rookCastle: false, events: { after: (from, to) => onBoardMove(from, to, snapshot) } },
    premovable: { enabled: false }, draggable: { enabled: interactive }, lastMove: undefined,
  };
  if (ground) ground.set(boardConfig);
  else ground = Chessground(el('board'), boardConfig);
  const placement = cells.flatMap((piece, index) => piece ? [`${piece === piece.toUpperCase() ? 'White' : 'Black'} ${pieceNames[piece.toLowerCase()]} ${String.fromCharCode(97 + index % 8)}${8 - Math.floor(index / 8)}`] : []);
  el('accessible-position').textContent = `${turnColor === 'black' ? 'Black' : 'White'} to move. ${placement.join(', ')}.`;
  el('board').setAttribute('aria-label', `${turnColor === 'black' ? 'Black' : 'White'} to move, played ply ${state.selectedPly}${state.variation?.length ? ', variation' : ''}. Move a piece to ${state.retry ? 'retry this decision' : 'explore a variation'}. Use Piece locations for the accessible position or ${state.retry ? 'Your move' : 'Explore a variation'} for keyboard move entry.`);
  el('side').textContent = `${turnColor === 'black' ? 'Black' : 'White'} to move`;
  el('position').textContent = state.retry ? `Retry move ${Math.ceil(state.retry.ply / 2)}` : state.variation?.length ? state.variation.join(' ') : state.selectedPly ? moveLabel(state.selectedPly, state.playedMoves?.[state.selectedPly - 1] || '') : 'Start position';
  el('position').title = state.variation?.length ? `Variation from played ply ${state.selectedPly}: ${state.variation.join(' ')}` : '';
  el('previous').disabled = state.selectedPly === 0 || manualInFlight;
  const totalPlies = state.totalPlies ?? state.playedMoves?.length;
  el('next').disabled = manualInFlight || (Number.isInteger(totalPlies) && state.selectedPly >= totalPlies);
  el('return').disabled = manualInFlight;
  el('show-variation').disabled = manualInFlight;
  el('summary').textContent = retryHidden() ? '' : state.sourceLabel || '';
  renderGameIdentity();
  renderReviewControls();
  renderPromotion();
  displayedRevision = state.revision;
  redrawStatus();
  if (publish) queueContext(state);
  return true;
}

function queueContext(snapshot) {
  if (!canonicalSynced) return;
  pendingContext = snapshot;
  void publishContext();
}

async function publishContext() {
  if (!connected || !canonicalSynced || contextInFlight || !pendingContext || disposed || Date.now() < contextRetryAfter) return;
  if (!extensions.modelContext) { redrawStatus(); return; }
  contextInFlight = true;
  try {
    while (pendingContext && !disposed) {
      const snapshot = pendingContext;
      pendingContext = undefined;
      const acknowledgement = await extensions.modelContext.update({
        content: [{ type: 'text', text: `Current chess review ${snapshot.sessionId}, revision ${snapshot.revision}, selected ply ${snapshot.selectedPly}. ${snapshot.summary || ''}\nFEN: ${snapshot.fen}\nUse semantic chess tools with this explicit session and revision.` }],
        structuredContent: { ...snapshot, mountId },
      }, { timeout: 10000 });
      if (acknowledgement?.updateId && state?.sessionId === snapshot.sessionId && state.revision === snapshot.revision) {
        contextRevision = snapshot.revision;
        contextUpdateId = acknowledgement.updateId;
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
    if (state && contextRevision !== state.revision) pendingContext = state;
    contextRetryAfter = Date.now() + contextRetryDelay;
    contextRetryDelay = Math.min(contextRetryDelay * 2, 15000);
    contextFailure = error?.message || String(error);
    reportError(error);
  } finally { contextInFlight = false; }
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
    } else if (response.state && (response.changed || response.state.revision > state.revision)) render(response.state);
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

async function mutate(name, args = {}) {
  if (!state || !canonicalSynced || manualInFlight || pendingPromotion) return;
  manualInFlight = true;
  clearError();
  render(state, { publish: false });
  let committed;
  try {
    const sessionId = state.sessionId;
    const result = unpack(await app.callServerTool({ name, arguments: { sessionId, expectedRevision: state.revision, ...args } }, { timeout: name === 'submit_retry' ? 45000 : 10000 }));
    if (state.sessionId === sessionId) { render(result.state || result); committed = state; }
  } catch (error) { reportError(error); await sync(); }
  finally { manualInFlight = false; if (state) render(state, { publish: false }); }
  return committed;
}

el('previous').addEventListener('click', () => { if (state) void mutate('go_to_move', { ply: Math.max(0, state.selectedPly - 1) }); });
el('next').addEventListener('click', () => { if (state) void mutate('go_to_move', { ply: state.selectedPly + 1 }); });
el('return').addEventListener('click', () => void mutate('return_to_game'));
el('import-form').addEventListener('submit', event => { event.preventDefault(); void loadCatalog({ refresh: true }); });
el('game-picker-title').addEventListener('click', () => setGamePicker(el('game-picker').hidden));
el('game').addEventListener('change', () => { if (state && el('game').value && el('game').value !== state.gameId) void mutate('select_game', { gameId: el('game').value }).then(committed => { if (committed) { setGamePicker(false); el('game-picker-title').focus(); } }); });
el('game').addEventListener('focus', () => { if (catalog.username && !state?.retry) void loadCatalog({ refresh: true, username: catalog.username }); });
el('analyze').addEventListener('click', () => void mutate('analyze_game'));
el('start-retry').addEventListener('click', () => { if (state?.analysis?.selectedMove) { el('retry-move').value = ''; void mutate('start_retry', { ply: state.analysis.selectedMove.ply, answerPreviouslyShown: true }).then(committed => { if (committed?.retry) el('retry-move').focus(); }); } });
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
  if (moves.length) void mutate('show_variation', { moves });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && pendingPromotion) { event.preventDefault(); cancelPromotion(); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); el('previous').click(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); el('next').click(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void sync(); scheduleSync(); } });
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(pollTimer); ground?.destroy(); });
app.addEventListener('hostcontextchanged', applyHostContext);
app.ontoolresult = result => {
  try {
    const payload = unpack(result);
    if (!launchReceived) { launchReceived = true; render(payload.state || payload, { publish: false }); }
  } catch (error) { reportError(error); }
};

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
  if (!state) el('status').textContent = 'Waiting for the review launch state…';
} catch (error) { reportError(error); el('status').textContent = 'Native connection unavailable.'; }
}
void start();
