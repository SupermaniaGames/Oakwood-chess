import { Chess } from "./vendor/chess.js";
import { Room } from "./multiplayer.js";
import { Clock, formatMs } from "./clock.js";
import {
  saveInProgressLocalGame,
  loadInProgressLocalGame,
  clearInProgressLocalGame,
  addHistoryEntry,
  getHistory,
  getProfile,
  saveProfile,
} from "./storage.js";

const PEER_PREFIX = "oakwood-chess-";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — easy to read aloud
const ELO_K = 32;

function generateRoomCode(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

function describeConnError(err) {
  const type = err?.type;
  if (type === "peer-unavailable")
    return "That code doesn't match an open room. Double-check it with your friend, or ask them to create a new one.";
  if (type === "network") return "Network problem — check your connection and try again.";
  if (type === "disconnected") return "Lost connection to the matchmaking server. Try again in a moment.";
  if (type === "browser-incompatible")
    return "This browser doesn't support the connection needed for online play.";
  return "Connection problem: " + (type || err?.message || "unknown error");
}

const PIECES = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

const el = (id) => document.getElementById(id);
const boardEl = el("board");
const statusEl = el("status");

const game = new Chess(); // the live game board
const replayGame = new Chess(); // a separate puppet used only for history replay

let viewState = "home"; // "home" | "room" | "game" | "replay"
let mode = null; // "local" | "online" | null
let myColor = "w"; // this browser's side, in online mode
let timeControlKey = "untimed";
let flipped = false;
let selected = null;
let legalTargets = [];
let lastMove = null;
let pendingPromotion = null;
let gameRecorded = false;
let room = null;
let clock = null;
let outgoingRequest = null; // "undo" | "rematch" | null — a request we sent, awaiting reply
let incomingRequestType = null; // "undo" | "rematch" | null — a request we're being asked about
let replayFens = [];
let replayIndex = 0;
let currentRoomCode = "";
let opponentName = "Friend";
let opponentRating = null;

// ---------- Screen management ----------

function showScreen(name) {
  viewState = name;
  ["home", "room", "game", "replay"].forEach((s) =>
    el(`screen-${s}`).classList.toggle("hidden", s !== name)
  );
  el("board-wrap").classList.toggle("hidden", !(name === "game" || name === "replay"));
}

// ---------- Rendering ----------

function activeGame() {
  return viewState === "replay" ? replayGame : game;
}

function render() {
  renderBoard();
  if (viewState === "replay") return;
  renderMoveList();
  renderStatus();
  finalizeIfOver();
}

function renderBoard() {
  const g = activeGame();
  boardEl.innerHTML = "";
  const boardState = g.board();

  const rowOrder = flipped ? [...boardState].reverse() : boardState;
  for (let r = 0; r < 8; r++) {
    const row = rowOrder[r];
    const cols = flipped ? [...row].reverse() : row;
    for (let c = 0; c < 8; c++) {
      const cell = cols[c];
      const rankIndex = flipped ? r : 7 - r;
      const fileIndex = flipped ? 7 - c : c;
      const square = "abcdefgh"[fileIndex] + (rankIndex + 1);

      const sq = document.createElement("div");
      sq.className = "sq " + ((rankIndex + fileIndex) % 2 === 0 ? "dark" : "light");
      sq.dataset.square = square;

      if (cell) {
        const span = document.createElement("span");
        span.className = "piece " + (cell.color === "w" ? "white" : "black");
        span.textContent = PIECES[cell.color][cell.type];
        sq.appendChild(span);
      }

      if (viewState === "game") {
        if (selected === square) sq.classList.add("selected");
        const legal = legalTargets.find((m) => m.to === square);
        if (legal) {
          sq.classList.add("legal");
          if (legal.captured || legal.flags?.includes("e")) sq.classList.add("capture");
        }
        sq.addEventListener("click", () => onSquareClick(square));
      }

      if (lastMove && (lastMove.from === square || lastMove.to === square)) {
        sq.classList.add("last-move");
      }
      if (cell && cell.type === "k" && cell.color === g.turn() && g.inCheck()) {
        sq.classList.add("in-check");
      }

      boardEl.appendChild(sq);
    }
  }
}

function renderMoveList() {
  const list = el("move-list");
  const history = game.history();
  list.innerHTML = "";
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement("li");
    const num = i / 2 + 1;
    li.innerHTML = `<b>${num}.</b> ${history[i] || ""} ${history[i + 1] || ""}`;
    list.appendChild(li);
  }
  list.scrollTop = list.scrollHeight;
}

function renderStatus() {
  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "Black" : "White";
    statusEl.textContent = `Checkmate — ${winner} wins.`;
  } else if (game.isStalemate()) {
    statusEl.textContent = "Stalemate — it's a draw.";
  } else if (game.isDraw()) {
    statusEl.textContent = "Draw.";
  } else if (game.inCheck()) {
    statusEl.textContent = `${game.turn() === "w" ? "White" : "Black"} is in check.`;
  } else if (mode === "online") {
    statusEl.textContent = game.turn() === myColor ? "Your move" : "Waiting for your friend";
  } else if (mode === "local") {
    statusEl.textContent = `${game.turn() === "w" ? "White" : "Black"} to move.`;
  } else {
    statusEl.textContent = "";
  }

  if (mode) {
    const youColor = mode === "local" ? "w" : myColor;
    const over = game.isGameOver();
    el("tag-you").classList.toggle("active", !over && game.turn() === youColor);
    el("tag-them").classList.toggle("active", !over && game.turn() !== youColor);
  }
}

function updateSideLabels() {
  const youLabel = document.querySelector("#tag-you .side-label");
  const themLabel = el("them-label");
  if (mode === "local") {
    youLabel.textContent = "White";
    themLabel.textContent = "Black";
  } else {
    youLabel.innerHTML = `You &middot; ${myColor === "w" ? "White" : "Black"}`;
    themLabel.textContent = `${opponentName} · ${myColor === "w" ? "Black" : "White"}`;
  }
}

function clearClockDisplay() {
  el("clock-you").textContent = "";
  el("clock-them").textContent = "";
}

function onClockTick(remaining) {
  if (!clock || !clock.enabled) return;
  const youColor = mode === "local" ? "w" : myColor;
  const themColor = youColor === "w" ? "b" : "w";
  el("clock-you").textContent = formatMs(remaining[youColor]);
  el("clock-them").textContent = formatMs(remaining[themColor]);
}

function onClockFlag(color) {
  if (gameRecorded) return;
  const winnerText = `${color === "w" ? "Black" : "White"} wins on time.`;
  if (mode === "online") room.send({ type: "flag", color });
  endGame(winnerText, mode === "online" ? (color === myColor ? "loss" : "win") : null);
  render();
}

// ---------- Interaction ----------

function onSquareClick(square) {
  if (viewState !== "game" || !mode) return;
  if (game.isGameOver()) return;
  if (mode === "online" && game.turn() !== myColor) return;

  if (selected) {
    const move = legalTargets.find((m) => m.to === square);
    if (move) {
      const piece = game.get(selected);
      const isPromotion = piece && piece.type === "p" && (square[1] === "8" || square[1] === "1");
      if (isPromotion) {
        pendingPromotion = { from: selected, to: square };
        selected = null;
        legalTargets = [];
        el("promo-modal").classList.remove("hidden");
        return;
      }
      applyMove({ from: selected, to: square });
      selected = null;
      legalTargets = [];
      render();
      return;
    }
  }

  const piece = game.get(square);
  if (piece && piece.color === game.turn()) {
    selected = square;
    legalTargets = game.moves({ square, verbose: true });
  } else {
    selected = null;
    legalTargets = [];
  }
  render();
}

function applyMove({ from, to, promotion }) {
  const move = game.move({ from, to, promotion });
  if (!move) return null;
  lastMove = { from, to };
  if (clock) clock.switchTo(game.turn());
  if (mode === "online") room.send({ type: "move", from, to, promotion });
  if (mode === "local") saveLocalProgress();
  return move;
}

el("promo-modal").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-piece]");
  if (!btn || !pendingPromotion) return;
  const { from, to } = pendingPromotion;
  pendingPromotion = null;
  el("promo-modal").classList.add("hidden");
  applyMove({ from, to, promotion: btn.dataset.piece });
  render();
});

function applyLocalUndo() {
  const undone = game.undo();
  if (!undone) return;
  const hist = game.history({ verbose: true });
  lastMove = hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null;
  selected = null;
  legalTargets = [];
  if (clock) clock.switchTo(game.turn());
  if (mode === "local") saveLocalProgress();
  render();
}

function applyRematch() {
  game.reset();
  gameRecorded = false;
  selected = null;
  legalTargets = [];
  lastMove = null;
  if (mode === "online") {
    myColor = myColor === "w" ? "b" : "w";
    flipped = myColor === "b";
  }
  clock = new Clock(timeControlKey, onClockTick, onClockFlag);
  clearClockDisplay();
  clock.start("w");
  updateSideLabels();
  el("btn-resign").classList.toggle("hidden", mode !== "online");
  el("btn-rematch").classList.toggle("hidden", mode === "online");
  el("request-banner").classList.add("hidden");
  render();
}

// ---------- Local / online setup ----------

function resetTransientState() {
  selected = null;
  legalTargets = [];
  lastMove = null;
  gameRecorded = false;
  outgoingRequest = null;
  incomingRequestType = null;
  el("request-banner").classList.add("hidden");
  el("btn-undo").disabled = false;
  el("btn-rematch").disabled = false;
}

function startLocal() {
  mode = "local";
  myColor = "w";
  game.reset();
  flipped = false;
  resetTransientState();
  clock = new Clock(timeControlKey, onClockTick, onClockFlag);
  clearClockDisplay();
  clock.start("w");
  updateSideLabels();
  el("btn-resign").classList.add("hidden");
  el("btn-rematch").classList.remove("hidden");
  el("btn-rematch").textContent = "New game";
  el("chat-card").classList.add("hidden");
  showScreen("game");
  render();
}

function resumeLocalGame() {
  const saved = loadInProgressLocalGame();
  if (!saved) return;
  mode = "local";
  myColor = "w";
  if (saved.pgn) {
    game.loadPgn(saved.pgn);
  } else {
    game.reset();
  }
  timeControlKey = saved.timeControl || "untimed";
  setActiveChip(timeControlKey);
  flipped = !!saved.flipped;
  resetTransientState();
  const hist = game.history({ verbose: true });
  lastMove = hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null;
  clock = new Clock(timeControlKey, onClockTick, onClockFlag);
  if (saved.remaining) clock.setRemaining(saved.remaining.w, saved.remaining.b);
  clearClockDisplay();
  clock.start(game.turn());
  updateSideLabels();
  el("btn-resign").classList.add("hidden");
  el("btn-rematch").classList.remove("hidden");
  el("btn-rematch").textContent = "New game";
  el("chat-card").classList.add("hidden");
  showScreen("game");
  render();
}

function saveLocalProgress() {
  if (mode !== "local" || game.isGameOver()) return;
  saveInProgressLocalGame({
    pgn: game.pgn(),
    timeControl: timeControlKey,
    remaining: clock ? clock.snapshot() : null,
    flipped,
  });
}

function startOnlineAsHost() {
  mode = "online";
  myColor = "w";
  game.reset();
  flipped = false;
  opponentName = "Friend";
  opponentRating = null;
  resetTransientState();
  showScreen("room");
  el("room-heading").textContent = "Room ready";
  el("room-sub").textContent = "Give your friend the code, or send the link — either one works.";
  el("room-code-block").classList.remove("hidden");
  el("room-link-row").classList.remove("hidden");
  el("conn-state").textContent = "Waiting for your friend to join…";
  el("conn-state").classList.remove("error");

  let attempts = 0;
  room = new Room({
    onOpen: () => {
      el("room-code").value = currentRoomCode;
      el("room-link").value = `${location.origin}${location.pathname}?join=${currentRoomCode}`;
    },
    onConnected: () => {
      const profile = getProfile();
      room.send({ type: "init", timeControl: timeControlKey, name: profile.name || "Friend", rating: profile.rating });
      beginOnlineGame();
    },
    onData: handlePeerData,
    onPeerLeft: () => {
      statusEl.textContent = "Your friend disconnected.";
      if (clock) clock.stop();
    },
    onError: (err) => {
      // A collision on the short code is routine (small ID space, shared
      // broker) — just mint a new one and try again, a few times.
      if (err?.type === "unavailable-id" && attempts < 6) {
        attempts += 1;
        currentRoomCode = generateRoomCode();
        room.host(PEER_PREFIX + currentRoomCode);
        return;
      }
      el("conn-state").textContent = describeConnError(err);
      el("conn-state").classList.add("error");
    },
  });
  currentRoomCode = generateRoomCode();
  room.host(PEER_PREFIX + currentRoomCode);
}

function startOnlineAsGuest(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  mode = "online";
  myColor = "b";
  game.reset();
  flipped = true;
  opponentName = "Friend";
  opponentRating = null;
  resetTransientState();
  showScreen("room");
  el("room-heading").textContent = "Joining room…";
  el("room-code-block").classList.add("hidden");
  el("room-link-row").classList.add("hidden");
  el("conn-state").textContent = "Connecting to your friend…";
  el("conn-state").classList.remove("error");

  room = new Room({
    onConnected: () => {
      el("conn-state").textContent = "Connected — waiting for game info…";
    },
    onData: (data) => {
      if (data.type === "init") {
        timeControlKey = data.timeControl;
        opponentName = data.name || "Friend";
        opponentRating = typeof data.rating === "number" ? data.rating : 1200;
        const profile = getProfile();
        room.send({ type: "init-ack", name: profile.name || "Friend", rating: profile.rating });
        beginOnlineGame();
        return;
      }
      handlePeerData(data);
    },
    onPeerLeft: () => {
      statusEl.textContent = "Your friend disconnected.";
      if (clock) clock.stop();
    },
    onError: (err) => {
      el("conn-state").textContent = describeConnError(err);
      el("conn-state").classList.add("error");
    },
  });
  room.join(PEER_PREFIX + code);
}

function beginOnlineGame() {
  clock = new Clock(timeControlKey, onClockTick, onClockFlag);
  clearClockDisplay();
  clock.start("w");
  updateSideLabels();
  el("btn-resign").classList.remove("hidden");
  el("btn-rematch").classList.add("hidden");
  el("btn-rematch").textContent = "Rematch";
  el("chat-card").classList.remove("hidden");
  el("chat-list").innerHTML = "";
  showScreen("game");
  render();
}

function handlePeerData(data) {
  switch (data.type) {
    case "move":
      game.move({ from: data.from, to: data.to, promotion: data.promotion });
      lastMove = { from: data.from, to: data.to };
      if (clock) clock.switchTo(game.turn());
      render();
      break;
    case "resign":
      endGame("Your friend resigned. You win!", "win");
      render();
      break;
    case "flag":
      endGame(`${data.color === "w" ? "Black" : "White"} wins on time.`, data.color === myColor ? "loss" : "win");
      render();
      break;
    case "init-ack":
      opponentName = data.name || "Friend";
      opponentRating = typeof data.rating === "number" ? data.rating : 1200;
      updateSideLabels();
      break;
    case "chat":
      appendChat(opponentName, data.text);
      break;
    case "undo-request":
      showRequestBanner("Your friend would like to undo the last move.", "undo");
      break;
    case "undo-accept":
      outgoingRequest = null;
      el("btn-undo").disabled = false;
      applyLocalUndo();
      break;
    case "undo-decline":
      outgoingRequest = null;
      el("btn-undo").disabled = false;
      statusEl.textContent = "Undo request declined.";
      break;
    case "rematch-request":
      showRequestBanner("Your friend would like a rematch.", "rematch");
      break;
    case "rematch-accept":
      outgoingRequest = null;
      applyRematch();
      break;
    case "rematch-decline":
      outgoingRequest = null;
      el("btn-rematch").disabled = false;
      statusEl.textContent = "Rematch declined.";
      break;
  }
}

function endGame(text, outcome = null) {
  if (gameRecorded) return;
  gameRecorded = true;
  if (clock) clock.stop();
  statusEl.textContent = text;

  let ratingInfo = null;
  if (mode === "online" && outcome && typeof opponentRating === "number") {
    const profile = getProfile();
    const before = profile.rating;
    const score = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
    const expected = 1 / (1 + Math.pow(10, (opponentRating - before) / 400));
    const after = Math.round(before + ELO_K * (score - expected));
    saveProfile({ ...profile, rating: after, games: profile.games + 1 });
    ratingInfo = { before, after };
    statusEl.textContent += ` (Rating ${before} → ${after}, ${after - before >= 0 ? "+" : ""}${after - before})`;
  }

  addHistoryEntry({
    mode,
    result: text,
    pgn: game.pgn(),
    timeControl: timeControlKey,
    playedAt: Date.now(),
    plyCount: game.history().length,
    rating: ratingInfo,
  });
  renderHistoryList();
  if (mode === "local") clearInProgressLocalGame();
  if (mode === "online") {
    el("btn-resign").classList.add("hidden");
    el("btn-rematch").classList.remove("hidden");
  }
}

function currentOutcomeForMe() {
  if (mode !== "online") return null;
  if (game.isCheckmate()) {
    const loser = game.turn(); // side to move is checkmated — that side loses
    return loser === myColor ? "loss" : "win";
  }
  if (game.isStalemate() || game.isDraw()) return "draw";
  return null;
}

function finalizeIfOver() {
  if (!mode || viewState !== "game") return;
  if (game.isGameOver() && !gameRecorded) {
    endGame(statusEl.textContent, currentOutcomeForMe());
  }
}

// ---------- Requests: undo & rematch ----------

function showRequestBanner(text, type) {
  incomingRequestType = type;
  el("request-text").textContent = text;
  el("request-banner").classList.remove("hidden");
}

function hideRequestBanner() {
  incomingRequestType = null;
  el("request-banner").classList.add("hidden");
}

el("btn-request-accept").addEventListener("click", () => {
  if (incomingRequestType === "undo") {
    applyLocalUndo();
    room.send({ type: "undo-accept" });
  } else if (incomingRequestType === "rematch") {
    room.send({ type: "rematch-accept" });
    applyRematch();
  }
  hideRequestBanner();
});

el("btn-request-decline").addEventListener("click", () => {
  if (incomingRequestType === "undo") room.send({ type: "undo-decline" });
  else if (incomingRequestType === "rematch") room.send({ type: "rematch-decline" });
  hideRequestBanner();
});

el("btn-undo").addEventListener("click", () => {
  if (!mode || viewState !== "game" || game.history().length === 0) return;
  if (mode === "local") {
    applyLocalUndo();
    return;
  }
  if (outgoingRequest) return;
  outgoingRequest = "undo";
  el("btn-undo").disabled = true;
  room.send({ type: "undo-request" });
  statusEl.textContent = "Undo requested — waiting for your friend…";
});

el("btn-rematch").addEventListener("click", () => {
  if (mode === "local") {
    startLocal();
    return;
  }
  if (mode === "online") {
    if (outgoingRequest) return;
    outgoingRequest = "rematch";
    el("btn-rematch").disabled = true;
    room.send({ type: "rematch-request" });
    statusEl.textContent = "Rematch requested — waiting for your friend…";
  }
});

el("btn-resign").addEventListener("click", () => {
  if (mode !== "online" || game.isGameOver()) return;
  room.send({ type: "resign" });
  endGame("You resigned.", "loss");
});

// ---------- Chat ----------

function appendChat(sender, text) {
  const li = document.createElement("li");
  const b = document.createElement("b");
  b.textContent = sender + ": ";
  li.appendChild(b);
  li.appendChild(document.createTextNode(text));
  el("chat-list").appendChild(li);
  el("chat-list").scrollTop = el("chat-list").scrollHeight;
}

el("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = el("chat-input");
  const text = input.value.trim();
  if (!text || mode !== "online" || !room) return;
  room.send({ type: "chat", text });
  appendChat(getProfile().name || "You", text);
  input.value = "";
});

// ---------- Home screen: time control, resume, history ----------

function setActiveChip(key) {
  timeControlKey = key;
  document.querySelectorAll("#time-control .chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.tc === key);
  });
}

document.querySelectorAll("#time-control .chip").forEach((c) => {
  c.addEventListener("click", () => setActiveChip(c.dataset.tc));
});
setActiveChip("untimed");

function renderProfile() {
  const profile = getProfile();
  el("profile-name").value = profile.name || "";
  el("rating-value").textContent = profile.rating;
  el("rating-record").textContent =
    profile.games > 0 ? `${profile.games} rated game${profile.games === 1 ? "" : "s"} played` : "No rated games yet.";
}

el("profile-name").addEventListener("change", () => {
  const profile = getProfile();
  profile.name = el("profile-name").value.trim().slice(0, 24);
  saveProfile(profile);
});

function showJoinError(msg) {
  el("join-error").textContent = msg;
  el("join-error").classList.remove("hidden");
}
function hideJoinError() {
  el("join-error").classList.add("hidden");
}

function joinByCode() {
  const val = el("join-code").value.trim();
  if (!val) {
    showJoinError("Enter a room code first.");
    return;
  }
  hideJoinError();
  startOnlineAsGuest(val);
}
el("btn-join-code").addEventListener("click", joinByCode);
el("join-code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinByCode();
});

function renderResumeBanner() {
  const saved = loadInProgressLocalGame();
  el("resume-card").classList.toggle("hidden", !saved);
}

el("btn-resume").addEventListener("click", resumeLocalGame);
el("btn-discard-resume").addEventListener("click", () => {
  clearInProgressLocalGame();
  renderResumeBanner();
});

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderHistoryList() {
  const list = getHistory();
  const listEl = el("history-list");
  listEl.innerHTML = "";
  el("history-empty").classList.toggle("hidden", list.length > 0);
  for (const entry of list) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "history-row";
    const resultSpan = document.createElement("span");
    resultSpan.className = "h-result";
    resultSpan.textContent = entry.result;
    const metaSpan = document.createElement("span");
    metaSpan.className = "h-meta";
    const modeLabel = entry.mode === "online" ? "Online" : "Local";
    const ratingText = entry.rating ? ` · ${entry.rating.before}→${entry.rating.after}` : "";
    metaSpan.textContent = `${modeLabel} · ${formatDate(entry.playedAt)} · ${entry.plyCount} ply${ratingText}`;
    btn.appendChild(resultSpan);
    btn.appendChild(metaSpan);
    btn.addEventListener("click", () => openReplay(entry));
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

// ---------- Replay ----------

function openReplay(entry) {
  const temp = new Chess();
  temp.loadPgn(entry.pgn);
  const moves = temp.history({ verbose: true });
  const stepper = new Chess();
  const fens = [stepper.fen()];
  for (const m of moves) {
    stepper.move({ from: m.from, to: m.to, promotion: m.promotion });
    fens.push(stepper.fen());
  }
  replayFens = fens;
  replayIndex = fens.length - 1;
  replayGame.load(fens[replayIndex]);
  const modeLabel = entry.mode === "online" ? "Online" : "Local";
  el("replay-summary").textContent = `${entry.result} — ${modeLabel} · ${formatDate(entry.playedAt)}`;
  showScreen("replay");
  render();
}

el("btn-replay-prev").addEventListener("click", () => {
  if (replayIndex <= 0) return;
  replayIndex -= 1;
  replayGame.load(replayFens[replayIndex]);
  render();
});
el("btn-replay-next").addEventListener("click", () => {
  if (replayIndex >= replayFens.length - 1) return;
  replayIndex += 1;
  replayGame.load(replayFens[replayIndex]);
  render();
});
el("btn-replay-back").addEventListener("click", goHome);

// ---------- Navigation ----------

function goHome() {
  if (mode === "local" && !game.isGameOver()) {
    if (clock) clock.stop();
    saveLocalProgress();
  }
  if (mode === "online") {
    if (room) room.close();
    if (clock) clock.stop();
  }
  mode = null;
  room = null;
  showScreen("home");
  renderResumeBanner();
  renderHistoryList();
  renderProfile();
}

el("btn-home").addEventListener("click", goHome);
el("btn-cancel-room").addEventListener("click", () => {
  if (room) room.close();
  room = null;
  mode = null;
  showScreen("home");
  renderResumeBanner();
  renderHistoryList();
  renderProfile();
});

el("btn-local").addEventListener("click", startLocal);
el("btn-create").addEventListener("click", startOnlineAsHost);

async function copyFromInput(inputEl, btnEl) {
  inputEl.select();
  try {
    await navigator.clipboard.writeText(inputEl.value);
    btnEl.textContent = "Copied";
    setTimeout(() => (btnEl.textContent = "Copy"), 1500);
  } catch {
    document.execCommand("copy");
  }
}
el("btn-copy").addEventListener("click", () => copyFromInput(el("room-link"), el("btn-copy")));
el("btn-copy-code").addEventListener("click", () => copyFromInput(el("room-code"), el("btn-copy-code")));

el("btn-flip").addEventListener("click", () => {
  flipped = !flipped;
  render();
});

// ---------- Install as an app ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!localStorage.getItem("oakwood.installDismissed")) {
    el("install-banner").classList.remove("hidden");
  }
});

window.addEventListener("appinstalled", () => {
  el("install-banner").classList.add("hidden");
});

el("btn-install").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  el("install-banner").classList.add("hidden");
});

el("btn-install-dismiss").addEventListener("click", () => {
  el("install-banner").classList.add("hidden");
  localStorage.setItem("oakwood.installDismissed", "1");
});

if (isIos() && !isStandalone() && !localStorage.getItem("oakwood.installDismissed")) {
  el("install-text").textContent = 'Install Oakwood Chess: tap the Share icon, then "Add to Home Screen".';
  el("btn-install").classList.add("hidden");
  el("install-banner").classList.remove("hidden");
}

// ---------- Boot ----------

const params = new URLSearchParams(location.search);
const joinId = params.get("join");
if (joinId) {
  startOnlineAsGuest(joinId);
} else {
  showScreen("home");
  renderResumeBanner();
  renderHistoryList();
  renderProfile();
}
render();
