import { Chess } from "./vendor/chess.js";
import { Room } from "./multiplayer.js";
import { Clock, formatMs, TIME_CONTROLS } from "./clock.js";
import {
  saveInProgressLocalGame,
  loadInProgressLocalGame,
  clearInProgressLocalGame,
  addHistoryEntry,
  getHistory,
  getProfile,
  saveProfile,
} from "./storage.js";
import {
  isConfigured,
  pushProfile,
  fetchLeaderboard,
  onAuthChange,
  getCurrentUser,
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  signOutUser,
  claimUsername,
  fetchMyProfile,
  checkUsernameAvailable,
  registerLiveGame,
  unregisterLiveGame,
  fetchLiveGames,
  registerOpenGame,
  unregisterOpenGame,
  fetchOpenGames,
  getFirestoreErrorCode,
} from "./leaderboard.js";
import { chooseBotMove, TIERS } from "./bot.js";
import { playSound, isSoundEnabled, setSoundEnabled } from "./sound.js";

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

function pieceElement(color, type) {
  const svgns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("class", "piece-svg");
  const use = document.createElementNS(svgns, "use");
  use.setAttributeNS("http://www.w3.org/1999/xlink", "href", `#${color}${type}`);
  use.setAttribute("href", `#${color}${type}`);
  svg.appendChild(use);
  return svg;
}

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
let endText = null; // final result text, so later re-renders can't overwrite it
let room = null;
let clock = null;
let outgoingRequest = null; // "undo" | "rematch" | null — a request we sent, awaiting reply
let incomingRequestType = null; // "undo" | "rematch" | null — a request we're being asked about
let replayFens = [];
let replayIndex = 0;
let currentRoomCode = "";
let opponentName = "Friend";
let opponentRating = null;
let botElo = 1000;
let botColorChoice = "w";
let spectateHostName = "Host";
let spectateGuestName = "Guest";
let customStartFen = null; // FEN both players started from (null = standard)
let spectateHostIsWhite = true;
let liveListed = false; // host only: is this game in the Watch directory?
let lobbyListed = false; // host only: is this room listed in the Online lobby?
let homeMode = localStorage.getItem("oakwood.homeMode") || "bot"; // "online" | "bot" | "local"
let reviewPly = null; // null = the live position; a number = browsing earlier moves
let reviewLastMove = null;
let guardActive = false; // is our extra browser-history entry in place?
let ignorePop = false;
const reviewGame = new Chess(); // scratch board used while browsing history

// ---------- Screen management ----------

function setRematchLabel(text) {
  el("rematch-label").textContent = text;
}

function showScreen(name) {
  viewState = name;
  document.body.dataset.screen = name; // lets CSS adapt the layout per screen
  if (name !== "game") exitReview();
  ["home", "room", "setup", "game", "replay", "learn", "account", "watch"].forEach((s) =>
    el(`screen-${s}`).classList.toggle("hidden", s !== name)
  );
  const boardVisible = name === "game" || name === "replay" || name === "setup";
  el("board-wrap").classList.toggle("hidden", !boardVisible);
  el("bottom-nav").classList.toggle("hidden", name === "game");
  // Credits and the "runs in your browser" note belong on the home page
  // only — during play they just take up space.
  el("app-footer").classList.toggle("hidden", name !== "home");
  syncHistoryGuard(name);
}

// ---------- Rendering ----------

function activeGame() {
  if (viewState === "replay") return replayGame;
  if (viewState === "game" && reviewPly !== null) return reviewGame;
  return game;
}

// --- Browsing earlier moves (the ‹ › arrows / tapping a move) ---

function exitReview() {
  reviewPly = null;
  reviewLastMove = null;
}

function goToPly(ply) {
  const history = game.history({ verbose: true });
  if (ply >= history.length) {
    exitReview();
    render();
    return;
  }
  ply = Math.max(0, ply);
  const startFen = game.header().FEN; // set when the game began from a custom position
  if (startFen) reviewGame.load(startFen);
  else reviewGame.reset();
  for (let i = 0; i < ply; i++) {
    reviewGame.move({ from: history[i].from, to: history[i].to, promotion: history[i].promotion });
  }
  reviewPly = ply;
  reviewLastMove = ply > 0 ? { from: history[ply - 1].from, to: history[ply - 1].to } : null;
  selected = null;
  legalTargets = [];
  render();
}

function render() {
  renderBoard();
  if (viewState === "replay") return;
  renderMoveList();
  renderCapturedTray();
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
        sq.appendChild(pieceElement(cell.color, cell.type));
      }
      // Rank numbers down the left edge, file letters along the bottom,
      // drawn inside the squares in small type (chess.com / lichess style).
      if (c === 0) {
        const rk = document.createElement("span");
        rk.className = "coord rank";
        rk.textContent = String(rankIndex + 1);
        sq.appendChild(rk);
      }
      if (r === 7) {
        const fl = document.createElement("span");
        fl.className = "coord file";
        fl.textContent = "abcdefgh"[fileIndex];
        sq.appendChild(fl);
      }

      if (viewState === "game") {
        if (selected === square) sq.classList.add("selected");
        const legal = legalTargets.find((m) => m.to === square);
        if (legal) {
          sq.classList.add("legal");
          if (legal.captured || legal.flags?.includes("e")) sq.classList.add("capture");
        }
        sq.addEventListener("click", () => onSquareClick(square));
      } else if (viewState === "setup") {
        sq.addEventListener("click", () => onSetupSquareClick(square));
      }

      const lm = viewState === "game" && reviewPly !== null ? reviewLastMove : lastMove;
      if (lm && (lm.from === square || lm.to === square)) {
        sq.classList.add("last-move");
      }
      if (cell && cell.type === "k" && cell.color === g.turn() && g.inCheck()) {
        sq.classList.add("in-check");
      }

      boardEl.appendChild(sq);
    }
  }
}

// A small piece icon (same SVG sprite as the board) for use in the move
// list and the captured-pieces tray.
function svgIcon(color, type, className) {
  const svg = pieceElement(color, type);
  svg.setAttribute("class", className);
  return svg;
}

function renderMoveList() {
  const list = el("move-list");
  const history = game.history({ verbose: true });
  const shownPly = reviewPly !== null ? reviewPly : history.length; // ply currently on the board
  list.innerHTML = "";

  // One <span class="mv"> per half-move: piece icon + the rest of the SAN
  // ("Nf6" -> [knight icon] "f6"). Pawn moves and castling have no piece
  // letter to swap out, so they stay plain text.
  const moveSpan = (m, ply) => {
    const span = document.createElement("span");
    span.className = "mv" + (ply === shownPly ? " current" : "");
    span.dataset.ply = String(ply);
    const isCastle = m.san.startsWith("O-O");
    if (m.piece !== "p" && !isCastle) {
      span.appendChild(svgIcon(m.color, m.piece, "mv-icon"));
      span.appendChild(document.createTextNode(m.san.slice(1)));
    } else {
      span.textContent = m.san;
    }
    return span;
  };

  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement("li");
    const num = document.createElement("b");
    num.textContent = `${i / 2 + 1}.`;
    li.appendChild(num);
    li.appendChild(document.createTextNode(" "));
    li.appendChild(moveSpan(history[i], i + 1));
    if (history[i + 1]) li.appendChild(moveSpan(history[i + 1], i + 2));
    list.appendChild(li);
  }

  // Keep the current move in view (sideways on a phone, down on desktop).
  const cur = list.querySelector(".mv.current");
  if (cur) {
    list.scrollLeft = cur.offsetLeft - list.clientWidth / 2 + cur.offsetWidth / 2;
    list.scrollTop = cur.offsetTop - list.clientHeight / 2 + cur.offsetHeight / 2;
  } else {
    list.scrollLeft = 0;
    list.scrollTop = 0;
  }
  el("btn-mv-prev").disabled = shownPly <= 0;
  el("btn-mv-next").disabled = reviewPly === null;
}

el("move-list").addEventListener("click", (e) => {
  const mv = e.target.closest(".mv");
  if (mv && viewState === "game") goToPly(Number(mv.dataset.ply));
});
el("btn-mv-prev").addEventListener("click", () => {
  const n = game.history().length;
  if (n) goToPly((reviewPly === null ? n : reviewPly) - 1);
});
el("btn-mv-next").addEventListener("click", () => {
  const n = game.history().length;
  if (n && reviewPly !== null) goToPly(reviewPly + 1);
});

// Pieces each side has captured, plus a material-advantage number next to
// whoever is ahead (standard chess UI). Derived from move history, so it
// stays correct through undo and resuming a saved game.
const CAPTURE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function renderCapturedTray() {
  const youColor = mode === "local" || mode === "spectate" ? "w" : myColor;
  const themColor = youColor === "w" ? "b" : "w";
  const captured = { w: [], b: [] }; // keyed by who *captured* them
  for (const m of game.history({ verbose: true })) {
    if (m.captured) captured[m.color].push(m.captured);
  }
  const score = (color) => captured[color].reduce((sum, t) => sum + CAPTURE_VALUES[t], 0);
  const diff = score(youColor) - score(themColor);

  const fill = (trayId, byColor, advantage) => {
    const tray = el(trayId);
    tray.innerHTML = "";
    const victimColor = byColor === "w" ? "b" : "w";
    [...captured[byColor]]
      .sort((a, b) => CAPTURE_VALUES[b] - CAPTURE_VALUES[a])
      .forEach((type) => tray.appendChild(svgIcon(victimColor, type, "cap-piece")));
    if (advantage > 0) {
      const adv = document.createElement("span");
      adv.className = "cap-adv";
      adv.textContent = `+${advantage}`;
      tray.appendChild(adv);
    }
  };
  fill("captured-you", youColor, Math.max(diff, 0));
  fill("captured-them", themColor, Math.max(-diff, 0));
}

function renderStatus() {
  if (viewState === "setup") {
    statusEl.textContent = "Tap a piece to remove it.";
    return;
  }
  if (viewState === "game" && reviewPly !== null) {
    statusEl.textContent = "Browsing moves — tap › to return to the live game";
    return;
  }
  if (gameRecorded && endText) {
    // The game ended (possibly by resignation or timeout, which chess.js
    // knows nothing about) — keep showing the result rather than letting a
    // re-render replace it with "Your move".
    statusEl.textContent = endText;
    el("tag-you").classList.remove("active");
    el("tag-them").classList.remove("active");
    return;
  }
  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "Black" : "White";
    statusEl.textContent = `Checkmate — ${winner} wins.`;
  } else if (game.isStalemate()) {
    statusEl.textContent = "Stalemate — it's a draw.";
  } else if (game.isDraw()) {
    statusEl.textContent = "Draw.";
  } else if (game.inCheck()) {
    statusEl.textContent = `${game.turn() === "w" ? "White" : "Black"} is in check.`;
  } else if (mode === "spectate") {
    const { white, black } = spectateNames();
    statusEl.textContent = `${game.turn() === "w" ? white : black} to move`;
  } else if (mode === "bot") {
    statusEl.textContent = game.turn() === myColor ? "Your move" : "Bot is thinking…";
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
  } else if (mode === "bot") {
    youLabel.innerHTML = `You &middot; ${myColor === "w" ? "White" : "Black"}`;
    themLabel.textContent = `Bot (${botElo} Elo) · ${myColor === "w" ? "Black" : "White"}`;
  } else if (mode === "spectate") {
    const { white, black } = spectateNames();
    youLabel.textContent = `${white} · White`;
    themLabel.textContent = `${black} · Black`;
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
  if (viewState !== "game" || !mode || mode === "spectate") return;
  if (game.isGameOver() || gameRecorded || reviewPly !== null) return;
  if ((mode === "online" || mode === "bot") && game.turn() !== myColor) return;

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

function playMoveSound(move) {
  if (game.isGameOver()) {
    playSound("gameEnd");
  } else if (game.inCheck()) {
    playSound("check");
  } else if (move && (move.captured || (move.flags && move.flags.includes("e")))) {
    playSound("capture");
  } else {
    playSound("move");
  }
}

function applyMove({ from, to, promotion }) {
  const move = game.move({ from, to, promotion });
  if (!move) return null;
  exitReview();
  lastMove = { from, to };
  playMoveSound(move);
  if (clock) clock.switchTo(game.turn());
  if (mode === "online") room.send({ type: "move", from, to, promotion });
  if (mode === "local") saveLocalProgress();
  if (mode === "bot") maybeTriggerBotMove();
  return move;
}

function maybeTriggerBotMove() {
  if (mode !== "bot" || viewState !== "game") return;
  if (game.isGameOver() || gameRecorded) return;
  if (game.turn() === myColor) return;
  statusEl.textContent = "Bot is thinking…";
  el("btn-undo").disabled = true;
  const thinkingDelay = 300 + Math.random() * 300;
  setTimeout(() => {
    el("btn-undo").disabled = false;
    if (mode !== "bot" || game.isGameOver() || gameRecorded) return;
    const botMove = chooseBotMove(game, botElo);
    if (!botMove) return;
    const applied = game.move(botMove);
    if (applied) {
      exitReview();
      lastMove = { from: applied.from, to: applied.to };
      playMoveSound(applied);
      if (clock) clock.switchTo(game.turn());
    }
    render();
  }, thinkingDelay);
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
  exitReview();
  const hist = game.history({ verbose: true });
  lastMove = hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null;
  selected = null;
  legalTargets = [];
  if (clock) clock.switchTo(game.turn(), { increment: false }); // taking a move back shouldn't pay an increment
  if (mode === "local") saveLocalProgress();
  render();
}

function applyRematch() {
  exitReview();
  if (customStartFen) game.load(customStartFen);
  else game.reset();
  gameRecorded = false;
  endText = null;
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
  if (mode === "online" && room && room.isHost && room.allowSpectators) listLiveGame();
}

// ---------- Local / online setup ----------

function resetTransientState() {
  selected = null;
  legalTargets = [];
  lastMove = null;
  exitReview();
  gameRecorded = false;
  endText = null;
  outgoingRequest = null;
  incomingRequestType = null;
  el("request-banner").classList.add("hidden");
  el("btn-undo").disabled = false;
  el("btn-rematch").disabled = false;
  // Undo the spectator-specific UI tweaks so the next game starts clean.
  el("btn-undo").classList.remove("hidden");
  el("spectator-banner").classList.add("hidden");
  el("chat-form").classList.remove("hidden");
  el("watchers-note").classList.add("hidden");
  el("btn-copy-watch-game").classList.add("hidden");
  el("listing-warning").classList.add("hidden");
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
  setRematchLabel("New game");
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
  setRematchLabel("New game");
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

function startOnlineAsHost(customFen = null, { listInLobby = false } = {}) {
  mode = "online";
  myColor = "w";
  customStartFen = customFen;
  if (customFen) {
    try {
      game.load(customFen);
    } catch {
      customStartFen = null;
      game.reset();
    }
  } else {
    game.reset();
  }
  flipped = false;
  opponentName = "Friend";
  opponentRating = null;
  resetTransientState();
  showScreen("room");
  el("room-heading").textContent = "Room ready";
  const tcLabel = TIME_CONTROLS[timeControlKey]?.label || "Untimed";
  el("room-sub").textContent = `${tcLabel} game. Give your friend the code, or send the link — either one works.`;
  el("room-code-block").classList.remove("hidden");
  el("room-link-row").classList.remove("hidden");
  el("conn-state").textContent = "Waiting for your friend to join…";
  el("conn-state").classList.remove("error");

  let attempts = 0;
  room = new Room({
    onOpen: () => {
      el("room-code").value = currentRoomCode;
      el("room-link").value = `${location.origin}${location.pathname}?join=${currentRoomCode}`;
      if (listInLobby) {
        el("room-sub").textContent = "You're listed under Online → Open games. The game starts as soon as someone joins.";
        registerOpenGame(currentRoomCode, {
          hostName: getProfile().name || "Player",
          rating: getProfile().rating,
          timeControl: timeControlKey,
        }).then((ok) => {
          lobbyListed = ok;
          if (!ok) {
            el("conn-state").textContent = "Couldn't list this room in the lobby — share the code or link instead.";
          }
        });
      }
    },
    onConnected: () => {
      delistOpenGame(); // someone joined: it's no longer an open game
      const profile = getProfile();
      room.send({
        type: "init",
        timeControl: timeControlKey,
        name: profile.name || "Friend",
        rating: profile.rating,
        fen: customStartFen,
      });
      beginOnlineGame();
    },
    onData: handlePeerData,
    onPeerLeft: () => {
      statusEl.textContent = "Your friend disconnected.";
      if (clock) clock.stop();
      delistLiveGame();
    },
    onSpectatorCountChange: (n) => {
      el("watchers-count").textContent = n;
      el("watchers-note").classList.toggle("hidden", n === 0);
    },
    // A spectator joining mid-game needs the current position, not just
    // future moves — so send them a snapshot the moment they connect.
    onSpectatorJoin: (sendTo) => {
      sendTo({
        type: "spectate-sync",
        pgn: game.pgn(),
        fen: game.fen(),
        startFen: customStartFen,
        hostName: getProfile().name || "Host",
        guestName: opponentName,
        hostIsWhite: myColor === "w",
        timeControl: timeControlKey,
      });
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
  room.allowSpectators = el("allow-spectators-toggle").checked;
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
      if (data.type === "spectate-denied") {
        el("conn-state").textContent = "This room already has two players.";
        el("conn-state").classList.add("error");
        return;
      }
      if (data.type === "init") {
        timeControlKey = data.timeControl;
        customStartFen = data.fen || null;
        if (customStartFen) {
          try {
            game.load(customStartFen);
          } catch {
            customStartFen = null;
            game.reset();
          }
        }
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

function spectateNames() {
  return spectateHostIsWhite
    ? { white: spectateHostName, black: spectateGuestName }
    : { white: spectateGuestName, black: spectateHostName };
}

// --- Live-game directory (host side, only when they opted in) ---

function listLiveGame() {
  registerLiveGame(currentRoomCode, {
    hostName: getProfile().name || "Host",
    guestName: opponentName,
    timeControl: timeControlKey,
  }).then((ok) => {
    liveListed = ok;
    const warn = el("listing-warning");
    if (ok) {
      warn.classList.add("hidden");
      return;
    }
    warn.textContent =
      getFirestoreErrorCode("liveWrite") === "permission-denied"
        ? "⚠ This game couldn't be listed in the Watch tab: your Firestore rules don't allow the liveGames collection yet (see README). Your watch link still works."
        : "⚠ This game couldn't be listed in the Watch tab right now. Your watch link still works.";
    warn.classList.remove("hidden");
  });
}

function delistLiveGame() {
  if (!liveListed) return;
  liveListed = false;
  unregisterLiveGame(currentRoomCode);
}

// --- Spectating someone else's game (read-only) ---

function startSpectating(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  mode = "spectate";
  myColor = "w";
  flipped = false;
  customStartFen = null;
  game.reset();
  resetTransientState();
  spectateHostName = "Host";
  spectateGuestName = "Guest";
  spectateHostIsWhite = true;
  showScreen("room");
  el("room-heading").textContent = "Joining as a spectator…";
  el("room-code-block").classList.add("hidden");
  el("room-link-row").classList.add("hidden");
  el("conn-state").textContent = "Connecting to the game…";
  el("conn-state").classList.remove("error");

  room = new Room({
    onConnected: () => {
      el("conn-state").textContent = "Connected — loading the game…";
    },
    onData: handleSpectatorData,
    onPeerLeft: () => {
      statusEl.textContent = "The game has ended — the host left.";
    },
    onError: (err) => {
      el("conn-state").textContent =
        err?.type === "peer-unavailable" ? "That game isn't live any more." : describeConnError(err);
      el("conn-state").classList.add("error");
    },
  });
  room.joinAsSpectator(PEER_PREFIX + code);
}

function beginSpectating() {
  clock = new Clock("untimed", onClockTick, onClockFlag);
  clearClockDisplay();
  updateSideLabels();
  el("btn-resign").classList.add("hidden");
  el("btn-rematch").classList.add("hidden");
  el("btn-undo").classList.add("hidden");
  el("spectator-banner").classList.remove("hidden");
  el("chat-card").classList.remove("hidden");
  el("chat-form").classList.add("hidden"); // spectators can read chat, not send
  el("chat-list").innerHTML = "";
  showScreen("game");
  render();
}

// Only a whitelist of message types is honored here: the host mirrors
// everything it sees, including things meant for the opponent alone
// (undo/rematch *requests*), which would be confusing to act on.
function handleSpectatorData(data) {
  switch (data.type) {
    case "spectate-denied":
      el("conn-state").textContent = "This game isn't open to spectators.";
      el("conn-state").classList.add("error");
      break;
    case "spectate-sync": {
      spectateHostName = data.hostName || "Host";
      spectateGuestName = data.guestName || "Guest";
      spectateHostIsWhite = data.hostIsWhite !== false;
      timeControlKey = data.timeControl || "untimed";
      customStartFen = data.startFen || null;
      try {
        game.loadPgn(data.pgn);
      } catch {
        try {
          game.load(data.fen);
        } catch {
          game.reset();
        }
      }
      const hist = game.history({ verbose: true });
      lastMove = hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null;
      exitReview();
      beginSpectating();
      break;
    }
    case "move":
    case "undo-accept":
      handlePeerData(data);
      break;
    case "resign": {
      const who = data._from === "host" ? spectateHostName : spectateGuestName;
      endGame(`${who} resigned.`);
      render();
      break;
    }
    case "flag": {
      const { white, black } = spectateNames();
      endGame(`${data.color === "w" ? black : white} wins on time.`);
      render();
      break;
    }
    case "chat":
      appendChat(data._from === "host" ? spectateHostName : spectateGuestName, data.text);
      break;
    case "rematch-accept":
      spectateHostIsWhite = !spectateHostIsWhite; // players swap colors each rematch
      if (customStartFen) game.load(customStartFen);
      else game.reset();
      gameRecorded = false;
      endText = null;
      selected = null;
      legalTargets = [];
      lastMove = null;
      updateSideLabels();
      render();
      break;
  }
}

function beginOnlineGame() {
  clock = new Clock(timeControlKey, onClockTick, onClockFlag);
  clearClockDisplay();
  clock.start("w");
  updateSideLabels();
  el("btn-resign").classList.remove("hidden");
  el("btn-rematch").classList.add("hidden");
  setRematchLabel("Rematch");
  el("chat-card").classList.remove("hidden");
  el("chat-list").innerHTML = "";
  el("btn-copy-watch-game").classList.toggle("hidden", !(room && room.isHost && room.allowSpectators));
  showScreen("game");
  render();
}

function handlePeerData(data) {
  switch (data.type) {
    case "move": {
      const applied = game.move({ from: data.from, to: data.to, promotion: data.promotion });
      // A spectator browsing earlier moves keeps their place; players snap back to live.
      if (mode !== "spectate") exitReview();
      lastMove = { from: data.from, to: data.to };
      if (applied) playMoveSound(applied);
      if (clock) clock.switchTo(game.turn());
      render();
      break;
    }
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
      if (room && room.isHost && room.allowSpectators) listLiveGame();
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
  endText = text;
  if (mode === "spectate") return; // watching isn't playing: no rating, no history

  let ratingInfo = null;
  if (mode === "online" && outcome && typeof opponentRating === "number") {
    const profile = getProfile();
    const before = profile.rating;
    const score = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
    const expected = 1 / (1 + Math.pow(10, (opponentRating - before) / 400));
    const after = Math.round(before + ELO_K * (score - expected));
    const updatedProfile = { ...profile, rating: after, games: profile.games + 1 };
    saveProfile(updatedProfile);
    pushProfile(updatedProfile);
    ratingInfo = { before, after };
    statusEl.textContent += ` (Rating ${before} → ${after}, ${after - before >= 0 ? "+" : ""}${after - before})`;
    endText = statusEl.textContent;
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
    delistLiveGame(); // a finished game shouldn't still show up as live
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
  if (mode === "bot") {
    if (game.history().length < 2) return; // nothing meaningful to retry yet
    applyLocalUndo(); // pop the bot's reply
    applyLocalUndo(); // pop your own last move
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
  if (mode === "bot") {
    startBotGame(botElo, myColor);
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
  if (game.isGameOver() || gameRecorded) return; // already over — don't resign twice
  if (mode === "online") {
    room.send({ type: "resign" });
    endGame("You resigned.", "loss");
  } else if (mode === "bot") {
    endGame("You resigned.");
  }
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
  updatePlaySummary();
}

document.querySelectorAll("#time-control .chip").forEach((c) => {
  c.addEventListener("click", () => setActiveChip(c.dataset.tc));
});
setActiveChip("untimed");

function renderAccountCard() {
  if (!isConfigured()) {
    el("account-status").textContent = "Add your Firebase config to enable sign-in — see README.";
    el("account-status").classList.remove("hidden");
    el("account-signed-out").classList.add("hidden");
    el("account-signed-in").classList.add("hidden");
    return;
  }
  el("account-status").classList.add("hidden");
  const user = getCurrentUser();
  if (user && !user.isAnonymous) {
    el("account-signed-out").classList.add("hidden");
    el("account-signed-in").classList.remove("hidden");
    el("account-label").textContent = `Signed in as ${user.displayName || user.email || "your account"} — your rating follows you across devices.`;
  } else {
    el("account-signed-in").classList.add("hidden");
    el("account-signed-out").classList.remove("hidden");
  }
}

function showAuthError(msg) {
  el("auth-error").textContent = msg;
  el("auth-error").classList.remove("hidden");
}
function hideAuthError() {
  el("auth-error").classList.add("hidden");
}

async function afterSignIn() {
  el("auth-email").value = "";
  el("auth-password").value = "";
  const typedName = el("profile-name").value.trim().slice(0, 24);

  const existing = await fetchMyProfile();
  if (existing) {
    // A returning account — its saved profile is the source of truth,
    // regardless of whatever happens to be cached on this device.
    saveProfile({ name: existing.name || "", rating: existing.rating ?? 1200, games: existing.games ?? 0 });
    hideNameError();
  } else {
    // Brand new account — claim whichever username they typed (falling
    // back to a Google display name if they didn't type one).
    const user = getCurrentUser();
    const nameToClaim = typedName || (user?.displayName ? user.displayName.slice(0, 24) : "");
    if (nameToClaim) {
      const res = await claimUsername(nameToClaim);
      if (res.ok) {
        const profile = getProfile();
        profile.name = nameToClaim;
        saveProfile(profile);
        hideNameError();
      } else {
        showNameError(`Signed in, but couldn't claim that username: ${res.error}`);
      }
    }
    pushProfile(getProfile());
  }
  renderAccountCard();
  renderProfile();
  renderLeaderboard();
}

el("btn-google-signin").addEventListener("click", async () => {
  hideAuthError();
  const res = await signInWithGoogle();
  if (!res.ok) {
    showAuthError(res.error);
    return;
  }
  await afterSignIn();
});

el("btn-email-signin").addEventListener("click", async () => {
  hideAuthError();
  const email = el("auth-email").value.trim();
  const password = el("auth-password").value;
  if (!email || !password) {
    showAuthError("Enter your email and password.");
    return;
  }
  const res = await signInWithEmail(email, password);
  if (!res.ok) {
    showAuthError(res.error);
    return;
  }
  await afterSignIn();
});

el("btn-email-signup").addEventListener("click", async () => {
  hideAuthError();
  const email = el("auth-email").value.trim();
  const password = el("auth-password").value;
  if (!email || !password) {
    showAuthError("Enter an email and password.");
    return;
  }
  const res = await signUpWithEmail(email, password);
  if (!res.ok) {
    showAuthError(res.error);
    return;
  }
  await afterSignIn();
});

el("btn-signout").addEventListener("click", async () => {
  await signOutUser();
  renderAccountCard();
  renderProfile();
  renderLeaderboard();
});

function renderProfile() {
  const profile = getProfile();
  el("profile-name").value = profile.name || "";
  el("rating-value").textContent = profile.rating;
  el("rating-record").textContent =
    profile.games > 0 ? `${profile.games} rated game${profile.games === 1 ? "" : "s"} played` : "No rated games yet.";
  hideNameError();
  el("username-check-result").classList.add("hidden");
}

async function renderLiveGames() {
  const note = el("live-games-note");
  const list = el("live-games-list");
  list.innerHTML = "";
  if (!isConfigured()) {
    note.textContent = "Add your Firebase config to see live games here — see README.";
    note.classList.remove("hidden");
    return;
  }
  note.textContent = "Loading…";
  note.classList.remove("hidden");
  const rows = await fetchLiveGames(30);
  if (rows == null) {
    note.textContent =
      getFirestoreErrorCode("live") === "permission-denied"
        ? "Live games aren't enabled in your database yet — add the liveGames rule from the README, then refresh."
        : "Couldn't load live games right now.";
    return;
  }
  // Hosts remove their listing when they leave, but a closed tab can skip
  // that cleanup — so hide anything old enough to almost certainly be dead.
  const maxAgeMs = 3 * 60 * 60 * 1000;
  const fresh = rows.filter((r) => {
    const started = r.startedAt?.toMillis?.();
    return !started || Date.now() - started < maxAgeMs;
  });
  if (fresh.length === 0) {
    note.textContent =
      "No games are being played live right now. Start one with “Let others watch” ticked and it'll show up here.";
    return;
  }
  note.classList.add("hidden");
  for (const g of fresh) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "history-row";
    const title = document.createElement("span");
    title.className = "h-result";
    title.textContent = `${g.hostName} vs ${g.guestName}`;
    const meta = document.createElement("span");
    meta.className = "h-meta";
    meta.textContent = `${TIME_CONTROLS[g.timeControl]?.label || "Untimed"} · tap to watch live`;
    btn.appendChild(title);
    btn.appendChild(meta);
    btn.addEventListener("click", () => startSpectating(g.code));
    li.appendChild(btn);
    list.appendChild(li);
  }
}
el("btn-refresh-live").addEventListener("click", renderLiveGames);

async function renderLeaderboard() {
  const note = el("leaderboard-note");
  const list = el("leaderboard-list");
  list.innerHTML = "";

  if (!isConfigured()) {
    note.textContent = "Add your Firebase config to turn this into a shared leaderboard across devices — see README.";
    note.classList.remove("hidden");
    return;
  }

  note.textContent = "Loading…";
  note.classList.remove("hidden");
  const rows = await fetchLeaderboard(50);

  if (rows == null) {
    note.textContent = "Couldn't reach the leaderboard right now.";
    return;
  }

  // Defensive cleanup for entries created before usernames were required to
  // be unique: drop anything unnamed/"Anonymous", and if the same name
  // appears more than once, keep only its best rating.
  const byName = new Map();
  for (const r of rows) {
    const name = (r.name || "").trim();
    if (!name || name.toLowerCase() === "anonymous") continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || (r.rating || 0) > (existing.rating || 0)) {
      byName.set(key, { ...r, name });
    }
  }
  const cleaned = [...byName.values()].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 20);

  if (cleaned.length === 0) {
    note.textContent = "No rated games yet — be the first!";
    return;
  }

  note.classList.add("hidden");
  cleaned.forEach((r, i) => {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "history-row";
    row.style.cursor = "default";
    const name = document.createElement("span");
    name.className = "h-result";
    name.textContent = `${i + 1}. ${r.name}`;
    const meta = document.createElement("span");
    meta.className = "h-meta";
    meta.textContent = `${r.rating} rating · ${r.games || 0} games`;
    row.appendChild(name);
    row.appendChild(meta);
    li.appendChild(row);
    list.appendChild(li);
  });
}

el("profile-name").addEventListener("input", () => {
  el("username-check-result").classList.add("hidden");
});

el("btn-check-username").addEventListener("click", async () => {
  const resultEl = el("username-check-result");
  const name = el("profile-name").value.trim();
  if (!name) {
    resultEl.textContent = "Type a username first.";
    resultEl.className = "conn-state error";
    resultEl.classList.remove("hidden");
    return;
  }
  if (!isConfigured()) {
    resultEl.textContent = "Add your Firebase config to check availability — see README.";
    resultEl.className = "conn-state";
    resultEl.classList.remove("hidden");
    return;
  }
  resultEl.textContent = "Checking…";
  resultEl.className = "conn-state";
  resultEl.classList.remove("hidden");
  const res = await checkUsernameAvailable(name);
  if (!res.ok) {
    resultEl.textContent = res.error;
    resultEl.className = "conn-state error";
  } else if (res.mine) {
    resultEl.textContent = "That's already your username.";
    resultEl.className = "conn-state";
  } else if (res.available) {
    resultEl.textContent = "Available!";
    resultEl.className = "conn-state success";
  } else {
    resultEl.textContent = "Already taken — try another.";
    resultEl.className = "conn-state error";
  }
});

el("profile-name").addEventListener("change", async () => {
  const newName = el("profile-name").value.trim().slice(0, 24);
  hideNameError();
  if (!newName) {
    const profile = getProfile();
    profile.name = "";
    saveProfile(profile);
    return;
  }
  if (isConfigured()) {
    const res = await claimUsername(newName);
    if (!res.ok) {
      showNameError(res.error);
      renderProfile(); // revert the field to the last saved name
      return;
    }
  }
  const profile = getProfile();
  profile.name = newName;
  saveProfile(profile);
  pushProfile(profile);
  renderLeaderboard();
});

function showNameError(msg) {
  el("profile-name-error").textContent = msg;
  el("profile-name-error").classList.remove("hidden");
}
function hideNameError() {
  el("profile-name-error").classList.add("hidden");
}

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

function setNavActive(name) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.nav === "home") {
      goHome();
    } else if (btn.dataset.nav === "learn") {
      setNavActive("learn");
      showScreen("learn");
    } else if (btn.dataset.nav === "watch") {
      setNavActive("watch");
      showScreen("watch");
      renderLiveGames();
    } else if (btn.dataset.nav === "account") {
      setNavActive("account");
      showScreen("account");
      renderAccountCard();
      renderProfile();
      renderLeaderboard();
    }
  });
});

el("btn-learn-back").addEventListener("click", goHome);

el("btn-learn-play").addEventListener("click", () => {
  startBotGame(400, "w"); // a gentle level for someone just learning the rules
});

// Builds the Elo picker from bot.js's TIERS/BOTS so the list of levels only
// has to be maintained in one place. One scrollable row, tiers divided by a
// thin line (Beginner | Intermediate | Advanced).
function buildBotEloPicker() {
  const container = el("bot-elo-picker");
  container.innerHTML = "";
  TIERS.forEach((tier, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "elo-sep";
      container.appendChild(sep);
    }
    tier.elos.forEach((elo) => {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.dataset.elo = String(elo);
      btn.textContent = String(elo);
      container.appendChild(btn);
    });
  });
}
buildBotEloPicker();

function centerActiveElo() {
  const row = el("bot-elo-picker");
  const active = row.querySelector(".chip.active");
  if (active) row.scrollLeft = active.offsetLeft - row.clientWidth / 2 + active.offsetWidth / 2;
}

function setActiveBotElo(elo) {
  botElo = Number(elo);
  document.querySelectorAll("#bot-elo-picker .chip").forEach((c) => c.classList.toggle("active", Number(c.dataset.elo) === botElo));
  centerActiveElo();
  updatePlaySummary();
}
el("bot-elo-picker").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) setActiveBotElo(chip.dataset.elo);
});
setActiveBotElo(1000);

function setActiveBotColor(key) {
  botColorChoice = key;
  document.querySelectorAll("#bot-color .chip").forEach((c) => c.classList.toggle("active", c.dataset.color === key));
  updatePlaySummary();
}
document.querySelectorAll("#bot-color .chip").forEach((c) => {
  c.addEventListener("click", () => setActiveBotColor(c.dataset.color));
});
setActiveBotColor("w");

// The one Play button starts whichever mode is selected, and its second
// line always says exactly what that will be.
function updatePlaySummary() {
  const tc = TIME_CONTROLS[timeControlKey]?.label || "Untimed";
  const colorLabel = botColorChoice === "w" ? "White" : botColorChoice === "b" ? "Black" : "Random";
  let text;
  if (homeMode === "bot") text = `vs Computer · ${botElo} · ${colorLabel}`;
  else if (homeMode === "local") text = `Local · ${tc}`;
  else text = isConfigured() ? `Online · ${tc}` : "Needs the shared database — see README";
  el("play-summary").textContent = text;
  el("btn-main-play").disabled = homeMode === "online" && !isConfigured();
  el("btn-create").textContent = `Create a room for a friend · ${tc}`;
}

function setHomeMode(m) {
  if (!["online", "bot", "local"].includes(m)) m = "bot";
  homeMode = m;
  localStorage.setItem("oakwood.homeMode", m);
  document.querySelectorAll("#mode-switch button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  el("panel-bot").classList.toggle("hidden", m !== "bot");
  el("panel-local").classList.toggle("hidden", m !== "local");
  el("panel-online").classList.toggle("hidden", m !== "online");
  el("tc-section").classList.toggle("hidden", m === "bot"); // time control is for local/online
  updatePlaySummary();
  if (m === "bot") centerActiveElo();
  if (m === "online") renderOpenGames();
}
document.querySelectorAll("#mode-switch button").forEach((b) => {
  b.addEventListener("click", () => setHomeMode(b.dataset.mode));
});
if (!isConfigured()) document.querySelector('#mode-switch [data-mode="online"]').textContent = "🔒 Online";

el("btn-main-play").addEventListener("click", () => {
  if (homeMode === "bot") {
    const color = botColorChoice === "random" ? (Math.random() < 0.5 ? "w" : "b") : botColorChoice;
    startBotGame(botElo, color);
  } else if (homeMode === "local") {
    startLocal();
  } else {
    quickPlay();
  }
});

// ---------- Online lobby (needs Firebase) ----------
// A game is only ever a room two browsers share; Firestore just remembers
// "this room is open and waiting" so strangers can find each other.

function openGameFresh(g) {
  const created = g.createdAt?.toMillis?.();
  return !created || Date.now() - created < 5 * 60 * 1000; // older listings are almost surely abandoned
}

function delistOpenGame() {
  if (!lobbyListed) return;
  lobbyListed = false;
  unregisterOpenGame(currentRoomCode);
}

// Join the longest-waiting game for this time control, or open one and wait.
async function quickPlay() {
  el("btn-main-play").disabled = true;
  el("play-summary").textContent = "Looking for a game…";
  const rows = await fetchOpenGames(30);
  if (rows == null) {
    updatePlaySummary();
    el("open-games-note").textContent =
      getFirestoreErrorCode("open") === "permission-denied"
        ? "The lobby isn't enabled in your database yet — add the openGames rule from the README."
        : "Couldn't reach the lobby right now — check your connection and try again.";
    return;
  }
  updatePlaySummary();
  const me = getCurrentUser()?.uid;
  const match = rows.find((g) => g.hostUid !== me && g.timeControl === timeControlKey && openGameFresh(g));
  if (match) startOnlineAsGuest(match.code);
  else startOnlineAsHost(null, { listInLobby: true });
}

async function renderOpenGames() {
  const note = el("open-games-note");
  const list = el("open-games-list");
  list.innerHTML = "";
  if (!isConfigured()) {
    note.textContent =
      "Playing other people online needs the shared database (Firebase) — see the README. You can still play a friend with a room code under Local / Friend.";
    return;
  }
  note.textContent = "Press Play to join the longest-waiting game for your time control, or to open one and wait. You can also pick a game below.";
  const rows = await fetchOpenGames(30);
  if (rows == null) {
    note.textContent =
      getFirestoreErrorCode("open") === "permission-denied"
        ? "The lobby isn't enabled in your database yet — add the openGames rule from the README, then refresh."
        : "Couldn't load open games right now.";
    return;
  }
  const me = getCurrentUser()?.uid;
  const open = rows.filter((g) => g.hostUid !== me && openGameFresh(g));
  if (open.length === 0) {
    note.textContent += " No open games right now.";
    return;
  }
  for (const g of open) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "history-row";
    const title = document.createElement("span");
    title.className = "h-result";
    title.textContent = `${g.hostName} (${g.rating})`;
    const meta = document.createElement("span");
    meta.className = "h-meta";
    meta.textContent = `${TIME_CONTROLS[g.timeControl]?.label || "Untimed"} · tap to join`;
    btn.appendChild(title);
    btn.appendChild(meta);
    btn.addEventListener("click", () => startOnlineAsGuest(g.code));
    li.appendChild(btn);
    list.appendChild(li);
  }
}
el("btn-refresh-open").addEventListener("click", renderOpenGames);

function startBotGame(elo, humanColor) {
  mode = "bot";
  myColor = humanColor;
  botElo = Number(elo);
  setActiveBotElo(botElo);
  game.reset();
  flipped = humanColor === "b";
  resetTransientState();
  clock = new Clock("untimed", onClockTick, onClockFlag);
  clearClockDisplay();
  updateSideLabels();
  el("btn-resign").classList.remove("hidden");
  el("btn-rematch").classList.remove("hidden");
  setRematchLabel("New game");
  el("chat-card").classList.add("hidden");
  showScreen("game");
  render();
  maybeTriggerBotMove(); // in case the bot plays first (human chose Black)
}

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
  // Games that began from a custom position start from that FEN, not the
  // standard setup — replaying from the standard start would be illegal.
  const startFen = temp.header().FEN;
  const stepper = startFen ? new Chess(startFen) : new Chess();
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

// --- Browser back button ---
//
// While you're on any non-home screen we keep one extra entry in the
// browser's history. Pressing Back then pops *that* entry instead of
// leaving the app (which used to close a game in progress), and we decide
// what to do: confirm if a game is live, otherwise just return Home.
function syncHistoryGuard(name) {
  if (name === "home") {
    if (guardActive) {
      guardActive = false;
      ignorePop = true; // the pop we're about to cause is ours, not the user's
      history.back();
    }
  } else if (!guardActive) {
    guardActive = true;
    history.pushState({ oakwood: "guard" }, "");
  }
}

function needsLeaveConfirm() {
  return !!mode && mode !== "spectate" && viewState === "game" && !game.isGameOver() && !gameRecorded;
}

function leaveMessage() {
  const messages = {
    local: "Leave this game? It'll be saved so you can resume from Home.",
    bot: "Leave this game? Your progress against the bot won't be saved.",
    online: "Leave this game? Your friend will see you disconnect, and it won't be saved.",
  };
  return messages[mode] || "Leave this game?";
}

window.addEventListener("popstate", () => {
  if (ignorePop) {
    ignorePop = false;
    return;
  }
  if (!guardActive) return;
  guardActive = false; // the browser already removed our entry
  if (needsLeaveConfirm() && !window.confirm(leaveMessage())) {
    guardActive = true; // stay put: put the guard entry back
    history.pushState({ oakwood: "guard" }, "");
    return;
  }
  leaveToHome();
});

// Leaves whatever screen we're on, without asking.
function leaveToHome() {
  if (mode === "local" && !game.isGameOver() && !gameRecorded) {
    saveLocalProgress();
  }
  if ((mode === "online" || mode === "spectate") && room) {
    room.close();
  }
  delistLiveGame();
  delistOpenGame();
  exitReview();
  mode = null;
  room = null;
  if (clock) clock.stop();
  setNavActive("home");
  showScreen("home");
  renderResumeBanner();
  renderHistoryList();
}

function goHome() {
  if (needsLeaveConfirm() && !window.confirm(leaveMessage())) return;
  leaveToHome();
}

el("btn-home").addEventListener("click", goHome);
el("btn-cancel-room").addEventListener("click", goHome);

el("btn-create").addEventListener("click", () => {
  if (el("custom-position-toggle").checked) startPositionSetup();
  else startOnlineAsHost();
});

// ---------- Custom position editor (remove pieces before a friend game) ----------

function startPositionSetup() {
  mode = null;
  game.reset();
  selected = null;
  legalTargets = [];
  lastMove = null;
  flipped = false;
  showScreen("setup");
  render();
}

function onSetupSquareClick(square) {
  const piece = game.get(square);
  if (!piece || piece.type === "k") return; // both sides always keep their king
  game.remove(square);
  render();
}

el("btn-setup-reset").addEventListener("click", () => {
  game.reset();
  render();
});
el("btn-setup-clear").addEventListener("click", () => {
  for (const file of "abcdefgh") {
    for (let rank = 1; rank <= 8; rank++) {
      const sq = file + rank;
      const piece = game.get(sq);
      if (piece && piece.type !== "k") game.remove(sq);
    }
  }
  render();
});
el("btn-setup-start").addEventListener("click", () => startOnlineAsHost(game.fen()));
el("btn-setup-cancel").addEventListener("click", goHome);


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

function updateSoundButton() {
  el("btn-sound").textContent = isSoundEnabled() ? "🔊" : "🔇";
}

el("btn-sound").addEventListener("click", () => {
  setSoundEnabled(!isSoundEnabled());
  updateSoundButton();
  if (isSoundEnabled()) playSound("move"); // quick audible confirmation it's back on
});
updateSoundButton();

// ---------- Recovering from backgrounding the tab ----------

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || (mode !== "online" && mode !== "spectate") || !room) return;
  room.reconnectIfNeeded();
  if (viewState === "room" && !el("conn-state").classList.contains("error")) {
    el("conn-state").textContent = "Reconnecting…";
  }
});

// ---------- Install as an app ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    // updateViaCache: "none" stops the browser from serving a stale,
    // HTTP-cached copy of sw.js itself when checking for updates.
    const reg = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => null);
    if (!reg) return;
    // Check for a newer version whenever the app is brought back to the
    // foreground, rather than waiting on the browser's own schedule.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  });

  // Once a new service worker activates, reload once so this tab is
  // actually running the new files instead of stale ones still in memory.
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
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

// ---------- Share the app ----------

el("btn-share-app").addEventListener("click", async () => {
  const url = location.origin + location.pathname; // the app itself, not a room link
  const note = el("share-note");
  try {
    if (navigator.share) {
      await navigator.share({ title: "Oakwood Chess", text: "Come play chess with me on Oakwood Chess.", url });
      return;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return; // they just closed the share sheet
    // anything else: fall through to copying the link instead
  }
  try {
    await navigator.clipboard.writeText(url);
    note.textContent = "Link copied — paste it anywhere to share.";
  } catch {
    note.textContent = url;
  }
  note.classList.remove("hidden");
  setTimeout(() => note.classList.add("hidden"), 4000);
});

el("btn-copy-watch-game").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?watch=${currentRoomCode}`;
  const btn = el("btn-copy-watch-game");
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Copied!";
  } catch {
    btn.textContent = url; // clipboard blocked: show the link so it can be copied by hand
  }
  setTimeout(() => (btn.textContent = "Copy watch link"), 2500);
});

// Best-effort cleanup if the host just closes the tab mid-game.
window.addEventListener("pagehide", () => {
  delistLiveGame();
  delistOpenGame();
});

// ---------- Boot ----------

setHomeMode(homeMode);

const params = new URLSearchParams(location.search);
const joinId = params.get("join");
const watchId = params.get("watch");
if (joinId) {
  startOnlineAsGuest(joinId);
} else if (watchId) {
  startSpectating(watchId);
} else {
  showScreen("home");
  renderResumeBanner();
  renderHistoryList();
  renderProfile();
  renderLeaderboard();
  renderAccountCard();

  if (isConfigured() && !localStorage.getItem("oakwood.onboarded")) {
    el("welcome-modal").classList.remove("hidden");
  }
}
render();

el("btn-welcome-signin").addEventListener("click", () => {
  localStorage.setItem("oakwood.onboarded", "1");
  el("welcome-modal").classList.add("hidden");
  setNavActive("account");
  showScreen("account");
  renderAccountCard();
  renderProfile();
  renderLeaderboard();
});
el("btn-welcome-guest").addEventListener("click", () => {
  localStorage.setItem("oakwood.onboarded", "1");
  el("welcome-modal").classList.add("hidden");
});

// Keep the account screen in sync if auth state changes asynchronously
// (e.g. a popup sign-in completing) without another explicit re-render call.
onAuthChange(() => {
  if (viewState === "account") {
    renderAccountCard();
    renderProfile();
    renderLeaderboard();
  }
});
