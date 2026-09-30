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

document.body.innerHTML = `<main class="review" aria-label="Chess review">
  <header><h1>Review Board</h1><span id="side" class="muted"></span></header>
  <div class="board-shell"><div id="board" class="board cg-wrap" role="img" aria-label="Chess position" aria-describedby="accessible-position"></div></div>
  <nav aria-label="Played line navigation"><button id="previous" class="btn btn-secondary cursor-interaction" type="button" disabled>Previous</button><span id="position" aria-live="polite"></span><button id="next" class="btn btn-secondary cursor-interaction" type="button" disabled>Next</button><button id="return" class="btn btn-secondary cursor-interaction" type="button" disabled>Played line</button></nav>
  <form id="variation-form"><label class="form-label" for="variation">Variation</label><div class="variation-input"><input class="form-control" id="variation" autocomplete="off" aria-label="Variation moves in SAN or from-to notation" placeholder="Nf3 Nc6 or g1f3 b8c6"/><button id="show-variation" class="btn btn-secondary cursor-interaction" type="submit" disabled>Show</button></div></form>
  <p id="summary"></p><p id="status" class="muted" aria-live="polite">Connecting to native chat…</p><p id="error" role="alert" hidden></p><details class="position-details"><summary>Position details</summary><p id="accessible-position"></p></details>
</main>`;
const el = id => document.getElementById(id);
for (const id of ['previous', 'next', 'return', 'show-variation']) el(id).disabled = true;

function reportError(error) {
  el('error').hidden = false;
  el('error').textContent = error?.message || String(error);
}

function clearError() { el('error').hidden = true; el('error').textContent = ''; }

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
  el('status').textContent = `Revision ${state.revision} · ${contextStatus} · Analysis ${state.analysis?.readiness || 'pending'}`;
}

function fenBoard(fen) {
  const ranks = fen.split(' ')[0].split('/');
  if (ranks.length !== 8) throw new Error('Invalid position received.');
  const cells = ranks.flatMap(rank => [...rank].flatMap(char => /[1-8]/.test(char) ? Array(Number(char)).fill(null) : [char]));
  if (cells.length !== 64) throw new Error('Invalid position received.');
  return cells;
}

function render(next, { publish = true } = {}) {
  if (!next?.sessionId || !Number.isInteger(next.revision)) throw new Error('The review has no valid session or revision.');
  if (state && next.sessionId !== state.sessionId) throw new Error('This view received a different review session.');
  if (state && next.revision < state.revision) return false;
  state = next;
  const cells = fenBoard(state.fen);
  const turnColor = state.sideToMove === 'black' || state.sideToMove === 'b' ? 'black' : 'white';
  const boardConfig = {
    fen: state.fen, orientation: state.playerColor === 'black' ? 'black' : 'white', turnColor,
    viewOnly: true, coordinates: true, coordinatesOnSquares: false, ranksPosition: 'left',
    animation: { enabled: false }, drawable: { enabled: false, visible: false },
    movable: { free: false }, premovable: { enabled: false }, draggable: { enabled: false },
  };
  if (ground) ground.set(boardConfig);
  else ground = Chessground(el('board'), boardConfig);
  const placement = cells.flatMap((piece, index) => piece ? [`${piece === piece.toUpperCase() ? 'White' : 'Black'} ${pieceNames[piece.toLowerCase()]} ${String.fromCharCode(97 + index % 8)}${8 - Math.floor(index / 8)}`] : []);
  el('accessible-position').textContent = `${turnColor === 'black' ? 'Black' : 'White'} to move. ${placement.join(', ')}.`;
  el('board').setAttribute('aria-label', `${turnColor === 'black' ? 'Black' : 'White'} to move, played ply ${state.selectedPly}${state.variation?.length ? ', variation' : ''}. Use Position details for piece locations and the Variation input to show legal moves.`);
  el('side').textContent = `${turnColor === 'black' ? 'Black' : 'White'} to move`;
  el('position').textContent = `Ply ${state.selectedPly}${state.variation?.length ? ' · Variation' : ''}`;
  el('previous').disabled = state.selectedPly === 0 || manualInFlight;
  const totalPlies = state.totalPlies ?? state.playedMoves?.length;
  el('next').disabled = manualInFlight || (Number.isInteger(totalPlies) && state.selectedPly >= totalPlies);
  el('return').disabled = manualInFlight;
  el('show-variation').disabled = manualInFlight;
  el('summary').textContent = state.summary || '';
  displayedRevision = state.revision;
  redrawStatus();
  if (publish) queueContext(state);
  return true;
}

function queueContext(snapshot) {
  pendingContext = snapshot;
  void publishContext();
}

async function publishContext() {
  if (!connected || contextInFlight || !pendingContext || disposed || Date.now() < contextRetryAfter) return;
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
    if (response.state && (response.changed || response.state.revision > state.revision)) render(response.state);
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
  if (!state || manualInFlight) return;
  manualInFlight = true;
  clearError();
  try {
    const sessionId = state.sessionId;
    const result = unpack(await app.callServerTool({ name, arguments: { sessionId, expectedRevision: state.revision, ...args } }, { timeout: 10000 }));
    if (state.sessionId === sessionId) render(result.state || result);
  } catch (error) { reportError(error); await sync(); }
  finally { manualInFlight = false; if (state) render(state, { publish: false }); }
}

el('previous').addEventListener('click', () => { if (state) void mutate('go_to_move', { ply: Math.max(0, state.selectedPly - 1) }); });
el('next').addEventListener('click', () => { if (state) void mutate('go_to_move', { ply: state.selectedPly + 1 }); });
el('return').addEventListener('click', () => void mutate('return_to_game'));
el('variation-form').addEventListener('submit', event => {
  event.preventDefault();
  const moves = el('variation').value.trim().split(/\s+/).filter(Boolean);
  if (moves.length) void mutate('show_variation', { moves });
});
document.addEventListener('keydown', event => {
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
    if (!launchReceived) { launchReceived = true; render(payload.state || payload); }
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
  await publishContext();
  await sync();
  scheduleSync();
  if (!state) el('status').textContent = 'Waiting for the review launch state…';
} catch (error) { reportError(error); el('status').textContent = 'Native connection unavailable.'; }
}
void start();
