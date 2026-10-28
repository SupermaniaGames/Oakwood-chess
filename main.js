import { Chess } from "./vendor/chess.js";
import { Room, checkRelayAvailable } from "./multiplayer.js";
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
  usersRuleMissing,
  registerOpenGame,
  unregisterOpenGame,
  fetchOpenGames,
  getFirestoreErrorCode,
  sendFriendRequest,
  answerFriendRequest,
  removeFriendLink,
  watchSocial,
  fetchPlayerCards,
  sendChallenge,
  answerChallenge,
  deleteChallenge,
} from "./leaderboard.js";
import { chooseBotMove, TIERS } from "./bot.js";
import { createReview } from "./review.js";
import { createPuzzles } from "./puzzles.js";
import { createLearn } from "./learn.js";
import { initCoach } from "./coach-avatar.js";
import { createCoachGame, COACH_LEVELS, DEFAULT_COACH_ELO } from "./coach-game.js";
import { createLiveAnalyzer, stopAnalysis, CLASS_INFO } from "./analysis.js";
import { liveSentence } from "./coach.js";
import { getAnalysisSettings } from "./storage.js";
import { speak, stopSpeaking, isVoiceEnabled, setVoiceEnabled, voiceSupported, listVoices, getVoiceName, setVoiceName, canPickMaleVoice, voiceHelp } from "./voice.js";
import { playSound, isSoundEnabled, setSoundEnabled } from "./sound.js";

const PEER_PREFIX = "oakwood-chess-";
const WATCH_PREFIX = "oakwood-watch-"; // spectators connect here, never to the players' room
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — easy to read aloud
const ELO_K = 32;

function generateRoomCode(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

// After a failed connection, say whether a relay server can be reached from this phone.
let relayCheckRunning = false;
async function appendRelayReport(node) {
  if (relayCheckRunning) return;
  relayCheckRunning = true;
  const r = await checkRelayAvailable();
  relayCheckRunning = false;
  const line =
    r.relay > 0
      ? "Connection check: a relay server is reachable from this phone, so trying again can work."
      : "Connection check: this phone could not reach any relay server, which is what connects people on different networks. See the README (“When friends can't connect”).";
  if (node && !node.textContent.includes("Connection check:")) node.textContent += "\n\n" + line;
}

function describeConnError(err) {
  const type = err?.type;
  if (type === "peer-unavailable")
    return "That code doesn't match an open room. Double-check it with your friend, or ask them to create a new one.";
  if (type === "network") return "Network problem — check your connection and try again.";
  if (type === "negotiation-failed" || type === "connection-closed" || type === "webrtc")
    return "Couldn't set up a direct connection with your friend. This often happens when you're on different mobile networks, or on a school/office network. Tap Try again, or try the same Wi-Fi.";
  if (type === "socket-error" || type === "socket-closed" || type === "server-error")
    return "Can't reach the matchmaking server right now. Check your connection and tap Try again.";
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
let liveListedCode = "";
let currentWatchCode = ""; // host only: the code spectators use (not the room code)
let hostWantsSpectators = false; // host only: spectating was ticked and hasn't been stopped
let lobbyListed = false; // host only: is this room listed in the Online lobby?
let homeMode = localStorage.getItem("oakwood.homeMode") || "bot"; // "online" | "bot" | "friend" | "person"
if (homeMode === "local") homeMode = "person"; // renamed
let reviewPly = null; // null = the live position; a number = browsing earlier moves
let reviewLastMove = null;
let flagCheckTimer = 0; // waiting for the friend's phone to confirm their clock really ran out
let clockHeartbeat = 0; // keeps both phones' view of the running clock in step
let coachMode = false; // Play Coach: a bot game with live coaching (mode is still "bot")
let coachThinking = false;
let gameArrows = []; // arrows on the live board (hints, the coach's warning)
let spectateTimer = 0; // 'still can\'t connect' hint for a spectator
let guestTimer = 0; // 'still can\'t connect' hint for a friend joining a room
let boardHook = null; // set while the Review / Puzzle screens draw the board (see renderBoard)
let reviewReturn = "game"; // screen to go back to when Game Review is closed
let specAnalysis = null; // spectator's private analysis board: { game, last } or null
let specNewMoves = 0; // live moves that arrived while the spectator was on their analysis board
let hydratedUid = null; // account whose cloud profile this page has already loaded
let authBusy = false; // a sign-in flow is running and will sync the profile itself
let guardActive = false; // is our extra browser-history entry in place?
let ignorePop = false;
const reviewGame = new Chess(); // scratch board used while browsing history

// ---------- Screen management ----------

function setRematchLabel(text) {
  el("rematch-label").textContent = text;
}

function showScreen(name) {
  const cameFrom = viewState;
  viewState = name;
  if (name === "home" && cameFrom !== "home" && typeof setMobileView === "function") setMobileView("hub");
  document.body.dataset.screen = name; // lets CSS adapt the layout per screen
  if (name !== "game") exitReview();
  ["home", "room", "setup", "game", "replay", "learn", "account", "watch", "friends", "review", "puzzles", "puzzle", "coach"].forEach((s) =>
    el(`screen-${s}`).classList.toggle("hidden", s !== name)
  );
  const boardVisible =
    name === "game" || name === "replay" || name === "setup" || name === "review" || name === "puzzle";
  el("board-wrap").classList.toggle("hidden", !boardVisible);
  el("bottom-nav").classList.toggle("hidden", name === "game" || name === "review" || name === "puzzle");
  boardHook = name === "review" ? review.hook : name === "puzzle" ? puzzles.hook : null;
  scheduleLayout();
  // Opening the Account screen always re-reads the account's saved profile.
  if (name === "account" && !authBusy) hydrateProfileFromCloud({ force: true }).then(renderAccountCard);
  // Credits and the "runs in your browser" note belong on the home page
  // only — during play they just take up space.
  el("app-footer").classList.toggle("hidden", name !== "home");
  syncHistoryGuard(name);
}

// ---------- Rendering ----------

function activeGame() {
  if (viewState === "replay") return replayGame;
  if (viewState === "game" && mode === "spectate" && specAnalysis) return specAnalysis.game;
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
  if (viewState === "replay" || viewState === "review" || viewState === "puzzle") return;
  renderMoveList();
  renderCapturedTray();
  renderStatus();
  finalizeIfOver();
  updateReviewButton();
  scheduleLayout();
}

// ---------- Game Review, Puzzles and spectator extras ----------

const review = createReview({ rerender: renderBoard, onClose: closeReview });
const puzzles = createPuzzles({
  rerender: renderBoard,
  onLeave: () => {
    puzzles.stop();
    setNavActive("puzzles");
    showScreen("puzzles");
    puzzles.updateLeft();
  },
});
const liveAnalyzer = createLiveAnalyzer(announceLive);

// --- Play Coach ---
//
// A game against the computer (mode stays "bot", so saving, undo, resigning and
// the end-of-game flow all work as they do for any computer game) with the coach
// judging every move you make. See coach-game.js.

const COACH_KEY = "oakwood.coach";
function loadCoachChoice() {
  try {
    return { elo: DEFAULT_COACH_ELO, color: "w", ...JSON.parse(localStorage.getItem(COACH_KEY) || "{}") };
  } catch {
    return { elo: DEFAULT_COACH_ELO, color: "w" };
  }
}
let coachChoice = loadCoachChoice();

const coachGame = createCoachGame({
  game: () => game,
  myColor: () => myColor,
  applyBotMove: (mv) => {
    let applied = null;
    try {
      applied = game.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    } catch {
      return null;
    }
    exitReview();
    lastMove = { from: applied.from, to: applied.to };
    playMoveSound(applied);
    if (clock) clock.switchTo(game.turn());
    render();
    return applied;
  },
  undoPlies: (n) => {
    for (let i = 0; i < n; i++) applyLocalUndo();
  },
  setArrows: (arrows) => {
    gameArrows = arrows;
    renderBoard();
  },
  render: () => render(),
  setThinking: (on) => {
    coachThinking = on;
    renderStatus();
  },
});

// Turns the coach's extras (panel, Hint button, board size) on or off.
function setCoachUi(on) {
  coachMode = on;
  if (on) document.body.dataset.coach = "on";
  else delete document.body.dataset.coach;
  el("btn-hint").classList.toggle("hidden", !on);
  el("coach-panel").classList.toggle("hidden", !on);
  if (on) initCoach(); // load the coach's face pictures
  if (!on) {
    coachThinking = false;
    gameArrows = [];
  }
  scheduleLayout();
}

function renderCoachSetup() {
  const box = el("coach-levels");
  box.innerHTML = "";
  for (const lvl of COACH_LEVELS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "coach-level";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(coachChoice.elo === lvl.elo));
    b.innerHTML = "<span></span><small></small>";
    b.firstChild.textContent = lvl.name;
    b.lastChild.textContent = `(${lvl.elo})`;
    b.onclick = () => {
      coachChoice = { ...coachChoice, elo: lvl.elo };
      renderCoachSetup();
    };
    box.appendChild(b);
  }
  for (const chip of el("coach-colors").children) chip.classList.toggle("active", chip.dataset.color === coachChoice.color);
  renderCoachVoice();
}

// The voice picker on the setup screen. Phones often default to a woman's voice,
// so the coach picks a man's voice when there is one ("Auto") — or you choose.
function renderCoachVoice() {
  const row = document.querySelector(".coach-voice-row");
  row.classList.toggle("hidden", !voiceSupported());
  if (!voiceSupported()) return;
  const on = el("coach-voice-on");
  on.checked = isVoiceEnabled();
  on.onchange = () => setVoiceEnabled(on.checked);
  const sel = el("coach-voice");
  sel.innerHTML = "";
  for (const [val, label] of [["", canPickMaleVoice() ? "Auto (male)" : "Auto (phone's voice)"], ...listVoices().map((v) => [v.name, v.name])]) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = getVoiceName();
  sel.onchange = () => {
    setVoiceName(sel.value);
    speak("Hello, I'm your chess coach.");
  };
  // On phones that don't name their voices (Android), say how to change the voice.
  let help = el("coach-voice-help");
  if (!help) {
    help = document.createElement("p");
    help.id = "coach-voice-help";
    help.className = "muted";
    help.style.cssText = "margin:6px 0 0;font-size:.78rem;";
    row.insertAdjacentElement("afterend", help);
  }
  help.textContent = voiceHelp();
  help.classList.toggle("hidden", !help.textContent);
}
// Browsers load their voice list a moment after the page does.
if (voiceSupported() && "onvoiceschanged" in window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    if (viewState === "coach") renderCoachVoice();
  };
}

function startCoachGame() {
  try {
    localStorage.setItem(COACH_KEY, JSON.stringify(coachChoice));
  } catch {
    /* choice just won't be remembered */
  }
  const color = coachChoice.color === "r" ? (Math.random() < 0.5 ? "w" : "b") : coachChoice.color;
  mode = "bot";
  myColor = color;
  botElo = coachChoice.elo;
  game.reset();
  flipped = color === "b";
  resetTransientState();
  setCoachUi(true);
  clock = new Clock("untimed", onClockTick, onClockFlag);
  clearClockDisplay();
  updateSideLabels();
  el("btn-resign").classList.remove("hidden");
  el("btn-rematch").classList.add("hidden");
  el("chat-card").classList.add("hidden");
  showScreen("game");
  coachGame.start({ elo: botElo });
  render();
  maybeTriggerBotMove(); // the coach moves first when you play Black
}

el("btn-coach-home").addEventListener("click", () => {
  initCoach();
  renderCoachSetup();
  showScreen("coach");
});
el("btn-coach-back").addEventListener("click", goHome);
el("coach-colors").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-color]");
  if (!chip) return;
  coachChoice = { ...coachChoice, color: chip.dataset.color };
  renderCoachSetup();
});
el("btn-coach-play").addEventListener("click", startCoachGame);
el("btn-hint").addEventListener("click", () => coachGame.hint());
el("btn-coach-continue").addEventListener("click", () => coachGame.continueAfterPrompt());
el("btn-coach-retry").addEventListener("click", () => coachGame.retry());
el("btn-coach-end-close").addEventListener("click", () => el("coach-end").classList.add("hidden"));
el("btn-coach-review").addEventListener("click", () => {
  el("coach-end").classList.add("hidden");
  openGameReview("game");
});
el("btn-coach-new").addEventListener("click", () => {
  el("coach-end").classList.add("hidden");
  coachGame.stop();
  setCoachUi(false);
  renderCoachSetup();
  showScreen("coach");
});
el("btn-coach-rematch").addEventListener("click", () => {
  el("coach-end").classList.add("hidden");
  startCoachGame();
});

let replayEntry = null; // the history entry currently open in Replay

// --- Game Review ---

// The toolbar's Review button appears once a game you played has finished.
function updateReviewButton() {
  const ok = viewState === "game" && !!mode && mode !== "spectate" && gameRecorded && game.history().length >= 2;
  el("btn-review").classList.toggle("hidden", !ok);
}

function reviewSetup(source) {
  if (source === "replay") {
    const t = new Chess();
    t.loadPgn(replayEntry.pgn);
    return {
      moves: t.history({ verbose: true }),
      startFen: t.header().FEN || null,
      whiteName: replayEntry.whiteName || "White",
      blackName: replayEntry.blackName || "Black",
      orientation: "w",
    };
  }
  const you = getProfile().name || "You";
  let whiteName = "White";
  let blackName = "Black";
  if (mode === "online") {
    whiteName = myColor === "w" ? you : opponentName;
    blackName = myColor === "w" ? opponentName : you;
  } else if (mode === "bot") {
    const bot = coachMode ? "Coach" : `Bot (${botElo})`;
    whiteName = myColor === "w" ? you : bot;
    blackName = myColor === "w" ? bot : you;
  }
  return {
    moves: game.history({ verbose: true }),
    startFen: game.header().FEN || null,
    whiteName,
    blackName,
    orientation: mode === "online" || mode === "bot" ? myColor : "w",
    side: mode === "online" || mode === "bot" ? myColor : null,
  };
}

function openGameReview(source) {
  reviewReturn = source;
  const setup = reviewSetup(source);
  showScreen("review");
  review.open(setup);
}

function closeReview() {
  showScreen(reviewReturn);
  render();
}

el("btn-review").addEventListener("click", () => openGameReview("game"));

// Learn tab: famous games open straight into the coach's Game Review.
const learn = createLearn({
  tabsEl: el("learn-tabs"),
  basicsEl: el("learn-basics"),
  contentEl: el("learn-content"),
  onReviewGame: (gm) => {
    const g = new Chess();
    for (const san of gm.moves.split(" ")) g.move(san);
    const [whiteName, blackName] = gm.players.split(" vs. ").map((s) => s.trim());
    replayEntry = { pgn: g.pgn(), whiteName: whiteName || "White", blackName: blackName || "Black" };
    reviewReturn = "learn";
    showScreen("review");
    review.open({ moves: g.history({ verbose: true }), whiteName: replayEntry.whiteName, blackName: replayEntry.blackName, orientation: "w", side: null });
  },
});
el("btn-replay-review").addEventListener("click", () => openGameReview("replay"));

// --- Puzzles ---

el("btn-puzzles-back").addEventListener("click", goHome);
document.querySelectorAll(".puzzle-tile").forEach((btn) => {
  btn.addEventListener("click", () => {
    showScreen("puzzle");
    puzzles.start(btn.dataset.puzzle);
  });
});

// Called whenever we leave to Home: stop anything running in the background.
function stopExtras() {
  coachGame.stop();
  setCoachUi(false);
  puzzles.stop();
  review.abort();
  stopAnalysis();
  stopSpeaking();
  liveAnalyzer.stop();
  specAnalysis = null;
  specNewMoves = 0;
}

// --- Spectator: private analysis board ---
//
// A spectator can try moves for BOTH sides on their own copy of the position.
// Nothing here touches `game` or `room` — spectators never send moves, and the
// live game keeps updating underneath so they can jump back to it.

function updateSpectatorControls() {
  const on = mode === "spectate";
  el("btn-spec-analysis").classList.toggle("hidden", !on || !!specAnalysis);
  el("btn-spec-undo").classList.toggle("hidden", !on || !specAnalysis);
  el("btn-spec-live").classList.toggle("hidden", !on || !specAnalysis);
  const note = el("spec-new-moves");
  note.classList.toggle("hidden", !(on && specAnalysis));
  if (specAnalysis) {
    note.textContent =
      specNewMoves > 0
        ? `Analysis board — only you can see these moves. The live game has ${specNewMoves} new move${specNewMoves === 1 ? "" : "s"}.`
        : "Analysis board — only you can see these moves. The live game carries on.";
  }
  el("btn-spec-voice").textContent = isVoiceEnabled() ? "🔊 Voice" : "🔇 Voice";
  el("btn-spec-voice").classList.toggle("hidden", !on || !voiceSupported());
}

function startSpecAnalysis() {
  if (mode !== "spectate") return;
  const fen = reviewPly !== null ? reviewGame.fen() : game.fen();
  specAnalysis = { game: new Chess(fen), last: null };
  specNewMoves = 0;
  selected = null;
  legalTargets = [];
  updateSpectatorControls();
  render();
}

function leaveSpecAnalysis() {
  specAnalysis = null;
  specNewMoves = 0;
  selected = null;
  legalTargets = [];
  updateSpectatorControls();
  render();
}

function onSpecAnalysisClick(square) {
  if (viewState !== "game" || mode !== "spectate" || !specAnalysis) return;
  const g = specAnalysis.game;
  if (selected) {
    const move = legalTargets.find((m) => m.to === square);
    if (move) {
      const made = g.move({ from: selected, to: square, promotion: move.promotion ? "q" : undefined });
      specAnalysis.last = { from: made.from, to: made.to };
      playMoveSound(made);
      selected = null;
      legalTargets = [];
      render();
      return;
    }
  }
  const piece = g.get(square);
  if (piece && piece.color === g.turn()) {
    selected = square;
    legalTargets = g.moves({ square, verbose: true });
  } else {
    selected = null;
    legalTargets = [];
  }
  render();
}

el("btn-spec-analysis").addEventListener("click", startSpecAnalysis);
el("btn-spec-live").addEventListener("click", leaveSpecAnalysis);
el("btn-spec-undo").addEventListener("click", () => {
  if (!specAnalysis) return;
  specAnalysis.game.undo();
  const h = specAnalysis.game.history({ verbose: true });
  specAnalysis.last = h.length ? { from: h[h.length - 1].from, to: h[h.length - 1].to } : null;
  selected = null;
  legalTargets = [];
  render();
});
el("btn-spec-voice").addEventListener("click", () => {
  setVoiceEnabled(!isVoiceEnabled());
  updateSpectatorControls();
});

// --- Spectator: floating emojis (seen by spectators only) ---
//
// A spectator's tap travels to the host, and the host forwards it to the OTHER
// spectators only (multiplayer.js) — never to the two players, and the host's
// own screen never draws it.

const SPEC_EMOJIS = ["👏", "🔥", "👑", "😱"];
let lastEmojiAt = 0;

function floatEmoji(emoji) {
  if (!SPEC_EMOJIS.includes(emoji)) return;
  const layer = el("emoji-layer");
  const span = document.createElement("span");
  span.className = "float-emoji";
  span.textContent = emoji;
  span.style.left = `${8 + Math.random() * 78}%`;
  span.addEventListener("animationend", () => span.remove());
  layer.appendChild(span);
  setTimeout(() => span.remove(), 3000); // in case animations are disabled
}

el("emoji-bar").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-emoji]");
  if (!btn || mode !== "spectate") return;
  const now = Date.now();
  if (now - lastEmojiAt < 300) return; // a gentle rate limit
  lastEmojiAt = now;
  floatEmoji(btn.dataset.emoji);
  if (room) room.sendEmoji(btn.dataset.emoji);
});

// --- Spectator: live voice commentary ---

function announceLive(result) {
  if (mode !== "spectate") return;
  const style = getAnalysisSettings().coachStyle;
  const cls = result.cls;
  let say = "";
  let text = "";
  if (result.tactic) {
    // A named idea: say what it is and explain it in a sentence.
    const sentence = result.facts ? liveSentence(result.facts, style) : "";
    say = `${result.tactic.name}! ${sentence}`;
    text = `${result.san} — ${result.tactic.name}`;
  } else if (cls === "book") {
    const note = style === "adults" ? result.openingNote : result.openingKidNote;
    say = `${result.speech}.${result.opening ? ` ${result.opening}.` : ""}${note ? ` ${note}` : ""}`;
    text = `${result.san} — Book${result.opening ? ` (${result.opening})` : ""}`;
  } else if (["brilliant", "great", "blunder", "mistake", "miss"].includes(cls)) {
    say = result.speech;
    text = `${result.san} — ${CLASS_INFO[cls].label}`;
  } else if (result.san.endsWith("+")) {
    say = "Check.";
    text = `${result.san} — check`;
  }
  if (!text) return;
  const box = el("spec-commentary");
  box.textContent = text;
  box.classList.remove("hidden");
  speak(say);
}

// --- Keeping the board centred on phones ---
//
// On a phone the board is sized AND placed so its middle is the middle of the
// screen. Everything above it (header, move strip, opponent bar) and below it
// (status, your bar, the fixed toolbar) is measured; the board takes whatever
// size lets both fit, and a top margin balances the two sides. If the screen is
// too short for both at full width the board shrinks to fit rather than sit off
// centre. Desktop and the other screens keep the plain CSS sizing.

let layoutRaf = 0;
function scheduleLayout() {
  if (layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    layoutBoard();
  });
}

function layoutBoard() {
  const root = document.documentElement;
  const mobile = window.matchMedia("(max-width: 899px)").matches;
  // Spectators get the plain full-width board: their controls sit below it and
  // would otherwise force the board smaller just to stay centred.
  if (!mobile || viewState !== "game" || mode === "spectate" || coachMode) {
    root.style.removeProperty("--board-size");
    root.style.removeProperty("--board-pad");
    return;
  }
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return; // keyboard is open
  const vh = window.innerHeight;
  const maxW = Math.min(window.innerWidth - 16, 640);
  root.style.setProperty("--board-pad", "0px");
  root.style.setProperty("--board-size", `${maxW}px`);
  const b = boardEl.getBoundingClientRect();
  const wrap = el("board-wrap").getBoundingClientRect();
  const above = b.top + window.scrollY;
  const below = wrap.bottom - b.bottom + el("game-controls").offsetHeight + 6;
  const fit = vh - 2 * Math.max(above, below);
  const size = Math.floor(Math.max(Math.min(maxW, fit), Math.min(maxW, 200)));
  const pad = Math.max(0, Math.round((vh - size) / 2 - above));
  root.style.setProperty("--board-size", `${size}px`);
  root.style.setProperty("--board-pad", `${pad}px`);
  // Check against where the board really landed (fonts, safe areas and the
  // like can shift things by a few pixels after the estimate) and nudge the
  // margin until its middle is the middle of the screen.
  let applied = pad;
  for (let i = 0; i < 3; i++) {
    const r = boardEl.getBoundingClientRect();
    const err = vh / 2 - (r.top + r.height / 2);
    if (Math.abs(err) < 0.5 || applied + err < 0) break;
    applied = Math.round(applied + err);
    root.style.setProperty("--board-pad", `${applied}px`);
  }
}

window.addEventListener("resize", scheduleLayout);
window.addEventListener("orientationchange", scheduleLayout);


// --- Dragging pieces (chess.com style) ---
//
// Press a piece and drag: an enlarged copy follows the pointer (held above
// your finger on touch screens so it isn't hidden), a grey halo marks the
// square you're over, and the usual legal-move dots show. Letting go on a
// square does exactly what tapping that square would — every rule check still
// lives in the tap handlers. Plain taps are untouched.

const DRAG_START_PX = 6;
let drag = null;
let suppressClickUntil = 0;

function boardTap(square) {
  if (boardHook && boardHook.onSquare) return boardHook.onSquare(square);
  if (viewState !== "game") return;
  return mode === "spectate" ? onSpecAnalysisClick(square) : onSquareClick(square);
}

function canDragOnThisBoard() {
  if (viewState === "review" || viewState === "puzzle") return !!(boardHook && boardHook.onSquare);
  return viewState === "game" && (mode !== "spectate" || !!specAnalysis);
}

function squareUnder(x, y) {
  const hit = document.elementFromPoint(x, y);
  const sq = hit && hit.closest ? hit.closest("#board .sq") : null;
  return sq || null;
}

function startDrag(e) {
  const origin = drag.square;
  // Select the piece exactly as a tap would, so legal-move dots appear.
  boardTap(origin);
  const sqEl = boardEl.querySelector(`.sq[data-square="${origin}"]`);
  const selectedNow = !!boardEl.querySelector(".sq.selected") || !!boardEl.querySelector(".sq.legal");
  const pieceEl = sqEl && sqEl.querySelector(".piece-svg");
  if (!selectedNow || !pieceEl) {
    drag = null; // not a piece that can move right now
    return;
  }
  const size = boardEl.getBoundingClientRect().width / 8;
  drag.size = size;
  drag.started = true;
  sqEl.classList.add("drag-origin");
  const float = pieceEl.cloneNode(true);
  float.classList.add("drag-piece");
  float.style.width = float.style.height = `${size * 1.75}px`;
  const halo = document.createElement("div");
  halo.className = "drag-halo";
  halo.style.width = halo.style.height = `${size * 2.3}px`;
  document.body.append(halo, float);
  drag.float = float;
  drag.halo = halo;
  try {
    boardEl.setPointerCapture(drag.id);
  } catch {
    /* pointer already gone */
  }
}

function moveDrag(e) {
  const lift = drag.touch ? drag.size * 1.0 : 0; // keep the piece clear of a finger
  drag.float.style.left = `${e.clientX}px`;
  drag.float.style.top = `${e.clientY - lift}px`;
  const over = squareUnder(e.clientX, e.clientY);
  drag.over = over ? over.dataset.square : null;
  if (over) {
    const r = over.getBoundingClientRect();
    drag.halo.style.display = "";
    drag.halo.style.left = `${r.left + r.width / 2}px`;
    drag.halo.style.top = `${r.top + r.height / 2}px`;
  } else {
    drag.halo.style.display = "none";
  }
}

function endDrag(e, cancelled) {
  const d = drag;
  drag = null;
  if (!d || !d.started) return;
  d.float.remove();
  d.halo.remove();
  const sqEl = boardEl.querySelector(`.sq[data-square="${d.square}"]`);
  if (sqEl) sqEl.classList.remove("drag-origin");
  suppressClickUntil = Date.now() + 60; // only the click that immediately follows a drag, not the next real tap
  const target = cancelled ? null : d.over;
  if (target && target !== d.square) boardTap(target);
}

boardEl.addEventListener("pointerdown", (e) => {
  if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
  if (!canDragOnThisBoard()) return;
  const sq = e.target.closest ? e.target.closest(".sq") : null;
  if (!sq || !sq.querySelector(".piece-svg")) return;
  // A piece that is a capture target of the current selection is tapped, not dragged.
  if (sq.classList.contains("legal")) return;
  drag = { square: sq.dataset.square, id: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, touch: e.pointerType !== "mouse" };
});
window.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_START_PX) return;
    startDrag(e);
    if (!drag) return;
  }
  e.preventDefault();
  moveDrag(e);
});
window.addEventListener("pointerup", (e) => {
  if (drag && e.pointerId === drag.id) endDrag(e, false);
});
window.addEventListener("pointercancel", (e) => {
  if (drag && e.pointerId === drag.id) endDrag(e, true);
});
boardEl.addEventListener(
  "click",
  (e) => {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true
);

// --- Keeping the account's profile in step across devices ---

// Saves the profile to the account and adopts whatever name the account really
// has (it may differ from this device's cached copy).
async function syncProfileToCloud(profile) {
  const res = await pushProfile(profile);
  if (res && res.ok && res.name && res.name !== getProfile().name) {
    saveProfile({ ...getProfile(), name: res.name });
    if (viewState === "account") renderProfile();
  }
  return res;
}

// The account's saved profile (users/{uid}) is the source of truth: whenever
// we learn who is signed in — on page load, after sign-in, or when the app
// comes back to the foreground — load it over this device's cached copy.
async function hydrateProfileFromCloud({ force = false } = {}) {
  const user = getCurrentUser();
  if (!isConfigured() || !user) return;
  if (!force && hydratedUid === user.uid) return;
  hydratedUid = user.uid;
  const cloud = await fetchMyProfile();
  if (cloud && cloud.name) {
    saveProfile({ name: cloud.name, rating: cloud.rating ?? 1200, games: cloud.games ?? 0 });
  } else {
    const local = getProfile();
    if (local.name) await syncProfileToCloud(local);
  }
  if (viewState === "account") {
    renderProfile();
    renderLeaderboard();
  }
}

let lastForegroundSync = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || authBusy) return;
  if (Date.now() - lastForegroundSync < 60000) return;
  lastForegroundSync = Date.now();
  hydrateProfileFromCloud({ force: true });
});

// The board is drawn from one of three sources: the live game (default), or,
// on the Review and Puzzle screens, a "hook" object from review.js /
// puzzles.js describing the position, highlights, badges and what a tap does.
function renderBoard() {
  const hook = viewState === "review" || viewState === "puzzle" ? boardHook : null;
  const g = hook ? hook.game : activeGame();
  boardEl.innerHTML = "";
  // Review flips with a CSS rotation (pieces and labels are turned back
  // upright by the stylesheet), so stepping through moves never changes it.
  const cssFlip = !!(hook && hook.cssFlip);
  boardEl.classList.toggle("css-flip", cssFlip);
  const boardState = (hook && hook.cells && hook.cells()) || g.board();
  const useFlip = hook ? !!hook.flipped : flipped;

  const rowOrder = useFlip ? [...boardState].reverse() : boardState;
  for (let r = 0; r < 8; r++) {
    const row = rowOrder[r];
    const cols = useFlip ? [...row].reverse() : row;
    for (let c = 0; c < 8; c++) {
      const cell = cols[c];
      const rankIndex = useFlip ? r : 7 - r;
      const fileIndex = useFlip ? 7 - c : c;
      const square = "abcdefgh"[fileIndex] + (rankIndex + 1);

      const sq = document.createElement("div");
      sq.className = "sq " + ((rankIndex + fileIndex) % 2 === 0 ? "dark" : "light");
      sq.dataset.square = square;

      if (cell) {
        sq.appendChild(pieceElement(cell.color, cell.type));
      }
      // Rank numbers down the left edge, file letters along the bottom,
      // drawn inside the squares in small type (chess.com / lichess style).
      // With the CSS flip they go on the opposite edges of the unrotated
      // grid, which is where the left/bottom edges end up after rotating.
      if (cssFlip ? c === 7 : c === 0) {
        const rk = document.createElement("span");
        rk.className = "coord rank";
        rk.textContent = String(rankIndex + 1);
        sq.appendChild(rk);
      }
      if (cssFlip ? r === 0 : r === 7) {
        const fl = document.createElement("span");
        fl.className = "coord file";
        fl.textContent = "abcdefgh"[fileIndex];
        sq.appendChild(fl);
      }

      if (hook) {
        for (const cls of (hook.classes && hook.classes(square)) || []) sq.classList.add(cls);
        const label = hook.label && hook.label(square);
        if (label) {
          const lb = document.createElement("span");
          lb.className = "sq-label";
          lb.textContent = label;
          sq.appendChild(lb);
        }
        const badge = hook.badge && hook.badge(square);
        if (badge) {
          const b = document.createElement("span");
          b.className = "move-badge";
          b.style.background = badge.color;
          b.textContent = badge.mark;
          b.title = badge.label || "";
          sq.appendChild(b);
        }
        if (hook.onSquare) sq.addEventListener("click", () => hook.onSquare(square));
      } else if (viewState === "game") {
        if (selected === square) sq.classList.add("selected");
        const legal = legalTargets.find((m) => m.to === square);
        if (legal) {
          sq.classList.add("legal");
          if (legal.captured || legal.flags?.includes("e")) sq.classList.add("capture");
        }
        sq.addEventListener("click", () => (mode === "spectate" ? onSpecAnalysisClick(square) : onSquareClick(square)));
      } else if (viewState === "setup") {
        sq.addEventListener("click", () => onSetupSquareClick(square));
      }

      if (!hook) {
        const lm = specAnalysis ? specAnalysis.last : viewState === "game" && reviewPly !== null ? reviewLastMove : lastMove;
        if (lm && (lm.from === square || lm.to === square)) {
          sq.classList.add("last-move");
        }
      }
      if (cell && cell.type === "k" && !(hook && hook.noCheck) && cell.color === g.turn() && g.inCheck()) {
        sq.classList.add("in-check");
      }

      boardEl.appendChild(sq);
    }
  }

  // Best-move arrow (Game Review): drawn in the board's own coordinates, so
  // the CSS flip turns it along with the squares.
  const arrows = hook ? (hook.arrows ? hook.arrows() : []) : viewState === "game" ? gameArrows : [];
  for (const arrow of arrows) boardEl.appendChild(arrowElement(arrow, useFlip));
}

function arrowElement({ from, to, color = "rgba(129,182,76,0.85)" }, reversed) {
  const ns = "http://www.w3.org/2000/svg";
  const pt = (sq) => {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]) - 1;
    return reversed ? [7 - f + 0.5, r + 0.5] : [f + 0.5, 7 - r + 0.5];
  };
  const [x1, y1] = pt(from);
  const [x2, y2] = pt(to);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = 0.62;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 8 8");
  svg.setAttribute("class", "board-arrow");
  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", x1 + ux * 0.2);
  line.setAttribute("y1", y1 + uy * 0.2);
  line.setAttribute("x2", bx);
  line.setAttribute("y2", by);
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "0.22");
  const tri = document.createElementNS(ns, "polygon");
  tri.setAttribute(
    "points",
    `${x2},${y2} ${bx - uy * 0.34},${by + ux * 0.34} ${bx + uy * 0.34},${by - ux * 0.34}`
  );
  tri.setAttribute("fill", color);
  svg.append(line, tri);
  return svg;
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
  if (flagCheckTimer && !gameRecorded) {
    statusEl.textContent = "Checking your friend's clock…";
    return;
  }
  if (coachMode && coachThinking && !gameRecorded) {
    statusEl.textContent = "Coach is thinking…";
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
    themLabel.textContent = coachMode ? `Coach · ${myColor === "w" ? "Black" : "White"}` : `Bot (${botElo} Elo) · ${myColor === "w" ? "Black" : "White"}`;
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

// ---- Online clocks ----
//
// Each phone runs a clock for BOTH players, but messages arrive late (network
// lag, a phone that was busy or asleep), so the copy of the opponent's clock is
// only a guess. Rules that keep the two screens from disagreeing:
//   - a phone ends the game on time only for ITS OWN player's clock;
//   - if it sees the OTHER player's clock reach 0 it first asks their phone, and
//     only if that phone doesn't answer for a few seconds does it claim the win;
//   - every move carries the mover's remaining time, and while a game is on each
//     phone also reports its own running clock every few seconds.

const FLAG_GRACE_MS = 8000;

function ownClockReport() {
  return { type: "clock", remaining: clock.snapshot(), active: clock.active };
}

function startClockHeartbeat() {
  clearInterval(clockHeartbeat);
  if (mode !== "online" || !clock || !clock.enabled) return;
  clockHeartbeat = setInterval(() => {
    if (gameRecorded || !room || !clock) return clearInterval(clockHeartbeat);
    room.send(ownClockReport());
  }, 2500);
}

function stopClockSync() {
  clearInterval(clockHeartbeat);
  clearTimeout(flagCheckTimer);
  clockHeartbeat = 0;
  flagCheckTimer = 0;
}

// Their phone's report of its own clock: adopt it, and carry on if we had paused
// to ask.
function applyOpponentClock(remaining) {
  if (!clock || !clock.enabled || !remaining) return;
  const opp = myColor === "w" ? "b" : "w";
  clock.syncRemote(opp, remaining[opp]);
  if (flagCheckTimer) {
    clearTimeout(flagCheckTimer);
    flagCheckTimer = 0;
    if (!gameRecorded && !clock.active) clock.start(game.turn()); // the stopped clock resumes
    render();
  }
}

function requestFlagCheck() {
  if (flagCheckTimer || gameRecorded) return;
  room.send({ type: "flag-check" });
  flagCheckTimer = setTimeout(() => {
    flagCheckTimer = 0;
    if (gameRecorded) return;
    // No answer: their phone is offline or asleep. Claim the win — and tell them,
    // so both phones end the same way (`final` = they must accept it).
    const opp = myColor === "w" ? "b" : "w";
    room.send({ type: "flag", color: opp, final: true });
    endGame("Your friend ran out of time (and didn't respond). You win!", "win");
    render();
  }, FLAG_GRACE_MS);
  render();
}

function onClockFlag(color) {
  if (gameRecorded) return;
  if (mode === "online" && color !== myColor) {
    requestFlagCheck(); // not ours to call: ask their phone first
    return;
  }
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
  if (mode === "online") room.send({ type: "move", from, to, promotion, remaining: clock && clock.enabled ? clock.snapshot() : undefined });
  if (mode === "local") saveLocalProgress();
  if (mode === "bot") {
    if (coachMode) coachGame.onPlayerMove();
    else maybeTriggerBotMove();
  }
  return move;
}

function maybeTriggerBotMove() {
  if (coachMode) {
    // In Play Coach the coach decides when to move (after judging your move).
    if (mode === "bot" && viewState === "game" && !gameRecorded && game.turn() !== myColor && !game.isGameOver() && !coachGame.isBusy()) coachGame.requestBotMove();
    return;
  }
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
  if (mode === "online" && room && room.isHost) {
    if (hostWantsSpectators && !room.watchOpen) startWatchRoom();
    else if (room.listPublicly && room.watchOpen) listLiveGame();
    updateHostWatchUI();
  }
}

// ---------- Local / online setup ----------

function resetTransientState() {
  stopClockSync();
  coachGame.stop();
  setCoachUi(false);
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
  specAnalysis = null;
  specNewMoves = 0;
  liveAnalyzer.stop();
  el("spec-commentary").classList.add("hidden");
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

// Drops the current room without any of its callbacks firing (used by "Try again").
function discardRoom() {
  if (!room) return;
  room.onConnected = room.onConnectFailed = room.onData = room.onPeerLeft = room.onError = null;
  room.close();
  room = null;
}

function startOnlineAsHost(customFen = null, { listInLobby = false, inviteTo = null } = {}) {
  outgoingChallenge = inviteTo ? { id: "", uid: inviteTo.uid, name: inviteTo.name } : null;
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
  el("btn-room-retry").classList.add("hidden");
  clearTimeout(guestTimer);

  let attempts = 0;
  room = new Room({
    onOpen: () => {
      el("room-code").value = currentRoomCode;
      el("room-link").value = `${location.origin}${location.pathname}?join=${currentRoomCode}`;
      if (inviteTo && outgoingChallenge && !outgoingChallenge.id && !outgoingChallenge.sending) {
        // Tell the friend: their invite carries the room code, so they just tap Accept.
        outgoingChallenge.sending = true;
        el("room-sub").textContent = `Inviting ${inviteTo.name}… the game starts when they accept. You can also send the link or code.`;
        sendChallenge({ toUid: inviteTo.uid, toName: inviteTo.name, timeControl: timeControlKey, roomCode: currentRoomCode }).then((id) => {
          if (!outgoingChallenge || outgoingChallenge.uid !== inviteTo.uid) {
            if (id) deleteChallenge(id); // we left the room while it was being sent
            return;
          }
          outgoingChallenge.sending = false;
          if (id) outgoingChallenge.id = id;
          else el("conn-state").textContent = "Couldn't send the invite — send your friend the link or code instead.";
        });
      }
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
      cancelOutgoingChallenge(); // they're here, so the invite has done its job
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
      el("watch-chip-count").textContent = `· ${n}`;
      el("watch-chip-count").classList.toggle("hidden", n === 0);
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
      // The room isn't reachable any more: offer a fresh one with the same settings.
      const retry = el("btn-room-retry");
      retry.classList.remove("hidden");
      retry.onclick = () => {
        discardRoom();
        startOnlineAsHost(customFen, { listInLobby });
      };
    },
  });
  hostWantsSpectators = el("allow-spectators-toggle").checked;
  room.listPublicly = hostWantsSpectators && el("list-public-toggle").checked && isConfigured();
  currentWatchCode = "";
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

  // Say so when it isn't working instead of waiting for ever, and let them try again.
  let guestConnected = false;
  const retryBtn = el("btn-room-retry");
  retryBtn.classList.add("hidden");
  retryBtn.onclick = () => {
    discardRoom();
    startOnlineAsGuest(code);
  };
  const guestFailed = (message) => {
    if (guestConnected || mode !== "online" || viewState !== "room") return;
    clearTimeout(guestTimer);
    el("conn-state").textContent = message;
    el("conn-state").classList.add("error");
    retryBtn.classList.remove("hidden");
    appendRelayReport(el("conn-state"));
  };
  clearTimeout(guestTimer);
  guestTimer = setTimeout(
    () =>
      guestFailed(
        "Still can't connect. Check that your friend still has the room open, then tap Try again. If you're on different networks (mobile data vs Wi-Fi), the connection may be blocked — try the same Wi-Fi."
      ),
    20000
  );

  room = new Room({
    onConnected: () => {
      guestConnected = true;
      clearTimeout(guestTimer);
      el("conn-state").textContent = "Connected — waiting for game info…";
    },
    onConnectFailed: () => guestFailed(describeConnError({ type: "negotiation-failed" })),
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
      if (guestConnected && viewState !== "room") return; // mid-game: the "friend left" message covers it
      guestFailed(describeConnError(err));
      if (guestConnected) {
        el("conn-state").textContent = describeConnError(err);
        el("conn-state").classList.add("error");
      }
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
  if (!currentWatchCode) return;
  if (window.__oakwoodTest) (window.__oakwoodTest.listed = window.__oakwoodTest.listed || []).push(currentWatchCode); // test hook
  const code = currentWatchCode;
  registerLiveGame(code, {
    hostName: getProfile().name || "Host",
    guestName: opponentName,
    timeControl: timeControlKey,
  }).then((ok) => {
    liveListed = ok;
    if (ok) liveListedCode = code;
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
  unregisterLiveGame(liveListedCode || currentWatchCode);
  liveListedCode = "";
}

// --- Spectator access (host side) ---
// Watching has its own code, opened only while the host allows it.

function startWatchRoom(attempt = 0) {
  if (!room || !room.isHost) return;
  currentWatchCode = generateRoomCode(6);
  room.openWatchRoom(WATCH_PREFIX + currentWatchCode, {
    onReady: () => {
      updateHostWatchUI();
      if (room.listPublicly && room.conn && room.conn.open) listLiveGame();
    },
    // A clash on the code is routine: mint another and try again.
    onTaken: () => {
      if (attempt < 6) startWatchRoom(attempt + 1);
    },
    onError: () => updateHostWatchUI(),
  });
  updateHostWatchUI();
}

function stopWatchRoom() {
  hostWantsSpectators = false;
  delistLiveGame();
  if (room) room.closeWatchRoom();
  currentWatchCode = "";
  updateHostWatchUI();
}

function updateHostWatchUI() {
  const host = mode === "online" && !!room && room.isHost;
  el("host-watch-card").classList.toggle("hidden", !host);
  el("btn-watch-manage").classList.toggle("hidden", !host);
  if (!host) {
    el("host-watch-card").classList.remove("open");
    return;
  }
  const on = room.watchOpen && !!currentWatchCode;
  const state = el("host-watch-state");
  state.textContent = "";
  if (on) {
    state.append("Spectators allowed · watch code ");
    const code = document.createElement("b");
    code.className = "watch-code";
    code.textContent = currentWatchCode;
    state.append(code, room.listPublicly ? " · also listed in the Watch tab" : " · private");
  } else {
    state.textContent = "Spectators are off. Nobody can watch this game.";
  }
  el("btn-copy-watch-game").classList.toggle("hidden", !on);
  el("btn-watch-manage").classList.toggle("on", on);
  // The code is always visible on the game page (a chip in the header).
  const chip = el("watch-chip");
  chip.classList.toggle("on", on);
  el("watch-chip-code").textContent = on ? currentWatchCode : "";
  const stop = el("btn-stop-spectators");
  stop.textContent = on ? "Stop spectators" : "Allow spectators";
  stop.classList.toggle("btn-danger-soft", on);
  if (!on) el("watchers-note").classList.add("hidden");
}

// --- Spectating someone else's game (read-only) ---

function startSpectating(rawCode) {
  const code = String(rawCode || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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

  // If nothing connects, say why instead of waiting forever: the usual causes
  // are that the host didn't tick "Let others watch", the game is over, or the
  // two devices are on networks that can't reach each other directly.
  let spectateConnected = false;
  const retryBtn = el("btn-room-retry");
  retryBtn.classList.add("hidden");
  retryBtn.onclick = () => startSpectating(code);
  clearTimeout(spectateTimer);
  spectateTimer = setTimeout(() => {
    if (spectateConnected || mode !== "spectate" || viewState !== "room") return;
    el("conn-state").textContent =
      "Still can't connect. Check that the game is still going and that the host allows spectators. If you're on different networks (mobile data vs Wi-Fi), the connection may be blocked — try the same Wi-Fi.";
    el("conn-state").classList.add("error");
    retryBtn.classList.remove("hidden");
    appendRelayReport(el("conn-state"));
  }, 15000);

  room = new Room({
    onConnected: () => {
      spectateConnected = true;
      clearTimeout(spectateTimer);
      el("conn-state").textContent = "Connected — loading the game…";
    },
    onData: handleSpectatorData,
    onPeerLeft: () => {
      statusEl.textContent = "The live feed has ended — the game is over, the host left, or the host stopped spectators.";
    },
    onError: (err) => {
      el("conn-state").textContent =
        err?.type === "peer-unavailable"
          ? "No game is open to watch with that code. Check the code with the host — spectators may have been stopped, or the game is over."
          : describeConnError(err);
      el("conn-state").classList.add("error");
      retryBtn.classList.remove("hidden");
    },
  });
  room.joinAsSpectator(WATCH_PREFIX + code);
}

function beginSpectating() {
  clearTimeout(spectateTimer);
  el("btn-room-retry").classList.add("hidden");
  clock = new Clock("untimed", onClockTick, onClockFlag);
  clearClockDisplay();
  updateSideLabels();
  el("btn-resign").classList.add("hidden");
  el("btn-rematch").classList.add("hidden");
  el("btn-undo").classList.add("hidden");
  el("spectator-banner").classList.remove("hidden");
  updateSpectatorControls();
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
      el("conn-state").textContent = data.oldLink
        ? "That link is out of date. Ask the host for the new watch link or watch code."
        : "This game isn't open to spectators.";
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
      specAnalysis = null;
      specNewMoves = 0;
      liveAnalyzer.reset(game.fen());
      beginSpectating();
      break;
    }
    case "move": {
      const before = game.fen();
      const count = game.history().length;
      handlePeerData(data);
      const hist = game.history({ verbose: true });
      if (hist.length > count) {
        if (specAnalysis) {
          specNewMoves += 1;
          updateSpectatorControls();
        }
        liveAnalyzer.moved(
          hist[hist.length - 1],
          hist.map((m) => m.san),
          before,
          game.fen(),
          customStartFen
        );
      }
      break;
    }
    case "undo-accept":
      handlePeerData(data);
      liveAnalyzer.reset(game.fen());
      break;
    case "spectator-emoji":
      floatEmoji(data.e);
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
      liveAnalyzer.reset(game.fen());
      updateSideLabels();
      render();
      break;
  }
}

function beginOnlineGame() {
  // The host opens spectator access only now that the game exists (never before).
  if (room && room.isHost && hostWantsSpectators && !room.watchOpen) startWatchRoom();
  clock = new Clock(timeControlKey, onClockTick, onClockFlag);
  clearClockDisplay();
  clock.start("w");
  startClockHeartbeat();
  updateSideLabels();
  el("btn-resign").classList.remove("hidden");
  el("btn-rematch").classList.add("hidden");
  setRematchLabel("Rematch");
  el("chat-card").classList.remove("hidden");
  el("chat-list").innerHTML = "";
  updateHostWatchUI();
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
      // The mover's own phone knows exactly how much time it has left.
      if (clock && data.remaining) applyOpponentClock(data.remaining);
      render();
      break;
    }
    case "clock":
      applyOpponentClock(data.remaining);
      break;
    case "flag-check":
      // They think our clock ran out: tell them the truth about it.
      if (clock && clock.enabled && !gameRecorded) room.send(ownClockReport());
      break;
    case "resign":
      endGame("Your friend resigned. You win!", "win");
      render();
      break;
    case "flag": {
      if (data.color === myColor && !data.final && clock && clock.enabled && clock.remainingNow(myColor) > 1500) {
        // They say OUR clock ran out, but it hasn't: correct them instead of ending the game.
        room.send(ownClockReport());
        break;
      }
      endGame(`${data.color === "w" ? "Black" : "White"} wins on time.`, data.color === myColor ? "loss" : "win");
      render();
      break;
    }
    case "init-ack":
      opponentName = data.name || "Friend";
      opponentRating = typeof data.rating === "number" ? data.rating : 1200;
      updateSideLabels();
      if (room && room.isHost && room.listPublicly && room.watchOpen) listLiveGame();
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
  stopClockSync();
  if (coachMode) coachGame.onGameEnd(text);
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
    syncProfileToCloud(updatedProfile);
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
  if (coachMode) {
    coachGame.undo();
    return;
  }
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
  document.querySelectorAll("#time-control .chip, #time-sheet .chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.tc === key);
  });
  updatePlaySummary();
}

document.querySelectorAll("#time-control .chip, #time-sheet .chip").forEach((c) => {
  c.addEventListener("click", () => {
    setActiveChip(c.dataset.tc);
    el("time-sheet").classList.add("hidden");
  });
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
    // A short account ID: if two devices show different IDs they are NOT the same account.
    el("account-id").textContent = `Account ID: ${String(user.uid).slice(-6)}${usersRuleMissing() ? " · Firestore rules need updating (see README)" : ""}`;
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

  hydratedUid = getCurrentUser()?.uid || hydratedUid;
  const existing = await fetchMyProfile();
  if (existing && existing.name) {
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
    await syncProfileToCloud({ ...getProfile(), ...(existing ? { rating: existing.rating ?? 1200, games: existing.games ?? 0 } : {}) });
  }
  renderAccountCard();
  renderProfile();
  renderLeaderboard();
}

el("btn-google-signin").addEventListener("click", async () => {
  hideAuthError();
  authBusy = true; // afterSignIn() syncs the profile itself
  const res = await signInWithGoogle();
  if (!res.ok) {
    authBusy = false;
    showAuthError(res.error);
    return;
  }
  try {
    await afterSignIn();
  } finally {
    authBusy = false;
  }
});

el("btn-email-signin").addEventListener("click", async () => {
  hideAuthError();
  const email = el("auth-email").value.trim();
  const password = el("auth-password").value;
  if (!email || !password) {
    showAuthError("Enter your email and password.");
    return;
  }
  authBusy = true; // afterSignIn() syncs the profile itself
  const res = await signInWithEmail(email, password);
  if (!res.ok) {
    authBusy = false;
    showAuthError(res.error);
    return;
  }
  try {
    await afterSignIn();
  } finally {
    authBusy = false;
  }
});

el("btn-email-signup").addEventListener("click", async () => {
  hideAuthError();
  const email = el("auth-email").value.trim();
  const password = el("auth-password").value;
  if (!email || !password) {
    showAuthError("Enter an email and password.");
    return;
  }
  authBusy = true; // afterSignIn() syncs the profile itself
  const res = await signUpWithEmail(email, password);
  if (!res.ok) {
    authBusy = false;
    showAuthError(res.error);
    return;
  }
  try {
    await afterSignIn();
  } finally {
    authBusy = false;
  }
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
      "No public games right now. Hosts can choose to list a game here; private games are shared with a watch code or link instead.";
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
    const uidAtStart = getCurrentUser()?.uid;
    const res = await claimUsername(newName);
    // If a sign-in switched accounts while that was running (typing a name and
    // then tapping "Sign in" fires this handler), the sign-in owns the profile
    // now — don't write this name over the account's real one.
    if (authBusy || getCurrentUser()?.uid !== uidAtStart) return;
    if (!res.ok) {
      showNameError(res.error);
      renderProfile(); // revert the field to the last saved name
      return;
    }
  }
  const profile = getProfile();
  profile.name = newName;
  saveProfile(profile);
  syncProfileToCloud(profile);
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

// Shortcut cards on the desktop Home press the matching navigation button.
document.querySelectorAll("[data-goto]").forEach((card) => {
  card.addEventListener("click", () => {
    const target = document.querySelector(`.nav-btn[data-nav="${card.dataset.goto}"]`);
    if (target) target.click();
  });
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
    } else if (btn.dataset.nav === "puzzles") {
      setNavActive("puzzles");
      showScreen("puzzles");
      puzzles.updateLeft();
    } else if (btn.dataset.nav === "friends") {
      setNavActive("friends");
      showScreen("friends");
      renderSocial();
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
  if (homeMode === "bot") text = `Play Bots · ${botElo} · ${colorLabel}`;
  else if (homeMode === "person") text = `Play in Person · ${tc}`;
  else if (homeMode === "friend") text = `Play a Friend · ${tc}`;
  else text = isConfigured() ? `Online · ${tc}` : "Needs the shared database — see README";
  el("play-summary").textContent = text;
  el("btn-main-play").disabled = homeMode === "online" && !isConfigured();
  el("btn-create").textContent = `Play a Friend · ${tc}`;
  updateNewGameSummary();
}

// Phone: the texts on the Home hub and the New Game screen.
function updateNewGameSummary() {
  const tc = TIME_CONTROLS[timeControlKey]?.label || "Untimed";
  const colorLabel = botColorChoice === "w" ? "White" : botColorChoice === "b" ? "Black" : "Random";
  el("m-time-label").textContent = tc;
  el("m-bots-sub").textContent = `${botElo} · ${colorLabel}`;
  el("m-start-sub").textContent = isConfigured() ? `Online · ${tc}` : `Play Bots · ${botElo} · ${colorLabel}`;
}

function setHomeMode(m) {
  if (!["online", "bot", "friend", "person"].includes(m)) m = "bot";
  homeMode = m;
  localStorage.setItem("oakwood.homeMode", m);
  document.querySelectorAll("#mode-switch button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  el("panel-bot").classList.toggle("hidden", m !== "bot");
  el("panel-friend").classList.toggle("hidden", m !== "friend");
  el("panel-person").classList.toggle("hidden", m !== "person");
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
  } else if (homeMode === "person") {
    startLocal();
  } else if (homeMode === "friend") {
    el("btn-create").click();
  } else {
    quickPlay();
  }
});

// ---------- Phone: Home hub, New Game screen and the screens behind it ----------
// (chess.com-style; the desktop layout above is unchanged.)

const homeScreen = el("screen-home");
const M_TITLES = { bots: "Play Bots", friend: "Play a Friend", person: "Play in Person", online: "Play Online" };
let mStack = ["hub"];

function setMobileView(v, { push = true } = {}) {
  if (push) {
    if (v === "hub") mStack = ["hub"];
    else if (mStack[mStack.length - 1] !== v) mStack.push(v);
  }
  homeScreen.dataset.mview = v;
  if (M_TITLES[v]) {
    el("m-title").textContent = M_TITLES[v];
    setHomeMode(v === "bots" ? "bot" : v);
  }
  // The Start button belongs to modes that start straight from their screen.
  homeScreen.dataset.mstart = v === "bots" || v === "person" || v === "online" ? "1" : "0";
  updateNewGameSummary();
  window.scrollTo(0, 0);
}

// One step back inside the Play screens. Returns false if already at the hub.
function mobileViewBack() {
  if (mStack.length <= 1) return false;
  mStack.pop();
  setMobileView(mStack[mStack.length - 1], { push: false });
  return true;
}

function startBotFromHome() {
  const color = botColorChoice === "random" ? (Math.random() < 0.5 ? "w" : "b") : botColorChoice;
  startBotGame(botElo, color);
}

document.querySelectorAll("[data-mgo]").forEach((b) => {
  b.addEventListener("click", () => {
    const go = b.dataset.mgo;
    if (go === "coach") el("btn-coach-home").click();
    else setMobileView(go);
  });
});
document.querySelectorAll("[data-mback]").forEach((b) => b.addEventListener("click", () => mobileViewBack()));
el("m-play").addEventListener("click", () => setMobileView("new"));
// "Start Game": find an opponent online when the shared database is set up, otherwise play a bot.
el("btn-newgame-start").addEventListener("click", () => {
  if (isConfigured()) quickPlay();
  else startBotFromHome();
});
el("btn-m-start").addEventListener("click", () => el("btn-main-play").click());

// The Time sheet.
el("btn-time-open").addEventListener("click", () => el("time-sheet").classList.remove("hidden"));
el("btn-time-close").addEventListener("click", () => el("time-sheet").classList.add("hidden"));
el("time-sheet").addEventListener("click", (e) => {
  if (e.target === el("time-sheet")) el("time-sheet").classList.add("hidden");
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
      "Playing other people online needs the shared database (Firebase) — see the README. You can still play a friend with a room code under Play a Friend.";
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
    const modeLabel = entry.mode === "online" ? "Online" : "In person";
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
  replayEntry = entry;
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
  const modeLabel = entry.mode === "online" ? "Online" : "In person";
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

// Back on the Home screen asks before leaving the app. A second history entry
// sits under whatever screen is open; pressing Back pops it, we show the
// popup and put the entry straight back so the next Back asks again.
let homeGuardActive = false;
function ensureHomeGuard() {
  if (homeGuardActive) return;
  homeGuardActive = true;
  history.pushState({ oakwood: "home" }, "");
}
function showExitModal(show) {
  el("exit-modal").classList.toggle("hidden", !show);
}
el("btn-exit-stay").addEventListener("click", () => showExitModal(false));
el("btn-exit-leave").addEventListener("click", () => {
  homeGuardActive = false;
  showExitModal(false);
  try {
    window.close(); // only works for windows a script opened
  } catch {
    /* ignore */
  }
  // Step back over our own entry, then once more to actually leave (closes an
  // installed app; in a browser tab it returns to the page before this one).
  history.back();
  setTimeout(() => history.back(), 80);
});
ensureHomeGuard();

window.addEventListener("popstate", () => {
  if (ignorePop) {
    ignorePop = false;
    return;
  }
  if (!guardActive) {
    if (homeGuardActive && viewState === "home") {
      homeGuardActive = false; // the browser just removed it
      if (mobileViewBack()) {
        // Back inside the phone's Play screens just goes up one level.
        ensureHomeGuard();
        return;
      }
      showExitModal(true);
      ensureHomeGuard();
    }
    return;
  }
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
  hostWantsSpectators = false;
  currentWatchCode = "";
  cancelOutgoingChallenge();
  exitReview();
  stopExtras();
  mode = null;
  updateHostWatchUI();
  room = null;
  if (clock) clock.stop();
  setNavActive("home");
  showScreen("home");
  renderResumeBanner();
  renderHistoryList();
  if (window.__applyPendingUpdate) window.__applyPendingUpdate();
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
  // Not on the very first visit (nothing stale to replace — and the reload used to
  // cut off a friend who had just opened a room link), and not in the middle of a
  // room or a game: then it waits until you're back on Home.
  const hadController = !!navigator.serviceWorker.controller;
  let reloadedForUpdate = false;
  window.__applyPendingUpdate = () => {
    if (!updatePending || reloadedForUpdate || viewState === "room" || viewState === "game") return;
    reloadedForUpdate = true;
    window.location.reload();
  };
  let updatePending = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloadedForUpdate) return;
    updatePending = true;
    window.__applyPendingUpdate();
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

async function copyWatchLink(btn, idle) {
  const url = `${location.origin}${location.pathname}?watch=${currentWatchCode}`;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Copied!";
  } catch {
    btn.textContent = url; // clipboard blocked: show the link so it can be copied by hand
  }
  setTimeout(() => (btn.textContent = idle), 2500);
}
el("btn-copy-watch-game").addEventListener("click", () => copyWatchLink(el("btn-copy-watch-game"), "Copy watch link"));
// The header chip copies the link too (its label swaps to "Copied!" for a moment).
el("watch-chip").addEventListener("click", async () => {
  const label = el("watch-chip").querySelector(".watch-chip-label");
  await copyWatchLink(label, "Watch");
});


// ---------- Friends and challenges (need the shared database) ----------

let social = null; // the latest { friends, requestsIn, requestsOut, challengesIn, challengesOut }
let socialUnsub = null;
let socialUid = "";
let friendCards = {}; // uid -> public card (rating)
let cardsLoading = new Set();
let outgoingChallenge = null; // the invite we sent for the room we're hosting
let popupChallenge = null;
const seenInvites = new Set();

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const AVATAR_COLOURS = ["#477747", "#3B6B7D", "#8A6A12", "#A4472F", "#5C6B1E", "#7A5A32", "#4A5D4A"];
function avatar(name, large = false) {
  const a = mk("div", "fr-avatar" + (large ? " fr-avatar-lg" : ""), (name || "?").trim().slice(0, 1).toUpperCase());
  let n = 0;
  for (const ch of name || "") n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  a.style.background = AVATAR_COLOURS[n % AVATAR_COLOURS.length];
  return a;
}

function tcText(key) {
  return TIME_CONTROLS[key]?.label || "Untimed";
}

function cancelOutgoingChallenge() {
  const c = outgoingChallenge;
  outgoingChallenge = null;
  if (c && c.id) deleteChallenge(c.id);
}

function inviteFriend(f) {
  if (!isConfigured()) return;
  setHomeMode("friend");
  startOnlineAsHost(null, { inviteTo: f });
}

function loadFriendCards() {
  if (!social) return;
  const missing = social.friends.map((f) => f.uid).filter((u) => !(u in friendCards) && !cardsLoading.has(u));
  if (!missing.length) return;
  missing.forEach((u) => cardsLoading.add(u));
  fetchPlayerCards(missing).then((cards) => {
    for (const u of missing) {
      cardsLoading.delete(u);
      friendCards[u] = cards[u] || {};
    }
    renderSocial();
  });
}

function friendRow(f, { remove = false } = {}) {
  const row = mk("div", "fr-row");
  const info = mk("div", "fr-info");
  info.append(mk("b", "fr-name", f.name));
  const rating = friendCards[f.uid]?.rating;
  if (rating != null) info.append(mk("small", "muted", `Rating ${Math.round(rating)}`));
  const actions = mk("div", "fr-actions");
  const inv = mk("button", "btn btn-primary btn-small", "Invite");
  inv.type = "button";
  inv.onclick = () => inviteFriend(f);
  actions.append(inv);
  if (remove) {
    const rm = mk("button", "btn btn-ghost btn-small", "Remove");
    rm.type = "button";
    rm.onclick = () => {
      if (confirm(`Remove ${f.name} from your friends?`)) removeFriendLink(f.id);
    };
    actions.append(rm);
  }
  row.append(avatar(f.name), info, actions);
  return row;
}

function emptyLine(text) {
  return mk("p", "muted fr-empty", text);
}

function goToFriendsTab() {
  document.querySelector('.nav-btn[data-nav="friends"]').click();
}

function renderSocial() {
  const configured = isConfigured();
  const hasName = !!getProfile().name;
  const note = el("fr-note");
  if (!configured) {
    note.textContent = "Friends and invites need the shared database (Firebase). See the README to switch it on.";
  } else if (!hasName) {
    note.textContent = "Choose a username in Account first. Friends find you by it.";
  }
  note.classList.toggle("hidden", configured && hasName);
  el("fr-pane-friends").classList.toggle("fr-off", !configured);
  el("fr-pane-challenges").classList.toggle("fr-off", !configured);
  el("fr-tc").textContent = tcText(timeControlKey);

  const s = social || { friends: [], requestsIn: [], requestsOut: [], challengesIn: [], challengesOut: [] };

  // badges: invites + friend requests waiting for you
  const waiting = s.challengesIn.length + s.requestsIn.length;
  document.querySelectorAll("[data-nav-badge]").forEach((b) => {
    b.textContent = waiting > 9 ? "9+" : String(waiting);
    b.classList.toggle("hidden", waiting === 0);
  });
  el("fr-badge").textContent = String(s.challengesIn.length);
  el("fr-badge").classList.toggle("hidden", s.challengesIn.length === 0);

  // your friends
  const list = el("fr-list");
  list.replaceChildren();
  if (s.friends.length) s.friends.forEach((f) => list.append(friendRow(f, { remove: true })));
  else list.append(emptyLine("No friends yet. Add someone by their username above."));

  // friend requests
  const reqs = el("fr-requests-list");
  reqs.replaceChildren();
  for (const r of s.requestsIn) {
    const row = mk("div", "fr-row");
    const info = mk("div", "fr-info");
    info.append(mk("b", "fr-name", r.fromName), mk("small", "muted", "wants to be your friend"));
    const acts = mk("div", "fr-actions");
    const yes = mk("button", "btn btn-primary btn-small", "Accept");
    yes.onclick = () => answerFriendRequest(r.id, true);
    const no = mk("button", "btn btn-ghost btn-small", "Decline");
    no.onclick = () => answerFriendRequest(r.id, false);
    acts.append(yes, no);
    row.append(avatar(r.fromName), info, acts);
    reqs.append(row);
  }
  for (const r of s.requestsOut) {
    const row = mk("div", "fr-row");
    const info = mk("div", "fr-info");
    info.append(mk("b", "fr-name", r.toName), mk("small", "muted", "request sent — waiting"));
    const acts = mk("div", "fr-actions");
    const x = mk("button", "btn btn-ghost btn-small", "Cancel");
    x.onclick = () => removeFriendLink(r.id);
    acts.append(x);
    row.append(avatar(r.toName), info, acts);
    reqs.append(row);
  }
  el("fr-requests").classList.toggle("hidden", !s.requestsIn.length && !s.requestsOut.length);

  // challenges
  const cin = el("ch-in-list");
  cin.replaceChildren();
  if (!s.challengesIn.length) cin.append(emptyLine("No invites right now. When a friend invites you to a game, it shows up here."));
  for (const c of s.challengesIn) {
    const row = mk("div", "fr-row");
    const info = mk("div", "fr-info");
    info.append(mk("b", "fr-name", c.fromName), mk("small", "muted", `invites you to play · ${tcText(c.timeControl)}`));
    const acts = mk("div", "fr-actions");
    const yes = mk("button", "btn btn-primary btn-small", "Accept");
    yes.onclick = () => acceptChallenge(c);
    const no = mk("button", "btn btn-ghost btn-small", "Decline");
    no.onclick = () => answerChallenge(c.id, "declined");
    acts.append(yes, no);
    row.append(avatar(c.fromName), info, acts);
    cin.append(row);
  }
  const cout = el("ch-out-list");
  cout.replaceChildren();
  if (!s.challengesOut.length) cout.append(emptyLine("You haven't invited anyone. Pick a friend and tap Invite."));
  for (const c of s.challengesOut) {
    const row = mk("div", "fr-row");
    const info = mk("div", "fr-info");
    info.append(mk("b", "fr-name", c.toName), mk("small", "muted", `waiting for an answer · ${tcText(c.timeControl)}`));
    const acts = mk("div", "fr-actions");
    const x = mk("button", "btn btn-ghost btn-small", "Cancel");
    x.onclick = () => {
      deleteChallenge(c.id);
      if (outgoingChallenge && outgoingChallenge.id === c.id) leaveToHome();
    };
    acts.append(x);
    row.append(avatar(c.toName), info, acts);
    cout.append(row);
  }

  // Play a Friend: invite from your list
  const pf = el("pf-friends");
  const pfList = el("pf-friends-list");
  pfList.replaceChildren();
  pf.classList.toggle("hidden", !(configured && s.friends.length));
  s.friends.forEach((f) => pfList.append(friendRow(f)));

  // the phone Home hub
  const hubBox = el("m-friends");
  hubBox.replaceChildren();
  hubBox.classList.toggle("hidden", !configured);
  if (configured) {
    const head = mk("div", "m-block-head");
    head.append(mk("h3", null, "Friends"));
    const all = mk("button", "m-link", s.friends.length ? "View all" : "Add friends");
    all.type = "button";
    all.onclick = goToFriendsTab;
    head.append(all);
    hubBox.append(head);
    if (s.friends.length) {
      const row = mk("div", "m-friend-row");
      s.friends.slice(0, 12).forEach((f) => {
        const b = mk("button", "m-friend");
        b.type = "button";
        b.append(avatar(f.name, true), mk("span", null, f.name));
        b.onclick = () => setMobileView("friend");
        row.append(b);
      });
      hubBox.append(row);
    } else {
      hubBox.append(emptyLine("Add friends to invite them to a game."));
    }
  }
}

// ---- the invite popup ----

function showChallengePopup(c) {
  popupChallenge = c;
  el("ch-pop-title").textContent = `${c.fromName} invited you to play`;
  el("ch-pop-sub").textContent = `${tcText(c.timeControl)} game`;
  el("ch-pop-avatar").replaceChildren(...avatar(c.fromName, true).childNodes);
  el("ch-pop-avatar").style.background = avatar(c.fromName).style.background;
  el("challenge-modal").classList.remove("hidden");
}

function hideChallengePopup() {
  popupChallenge = null;
  el("challenge-modal").classList.add("hidden");
}

async function acceptChallenge(c) {
  hideChallengePopup();
  await answerChallenge(c.id, "accepted");
  setNavActive("home");
  startOnlineAsGuest(c.roomCode);
}

el("btn-ch-accept").addEventListener("click", () => {
  if (popupChallenge) acceptChallenge(popupChallenge);
});
el("btn-ch-decline").addEventListener("click", () => {
  if (popupChallenge) answerChallenge(popupChallenge.id, "declined");
  hideChallengePopup();
});

function onSocial(data) {
  social = data;
  if (!data) return renderSocial();
  loadFriendCards();
  renderSocial();
  // the friend we invited said no
  if (outgoingChallenge && outgoingChallenge.id && viewState === "room") {
    const mine = (data.challengesOutAll || []).find((c) => c.id === outgoingChallenge.id);
    if (mine && mine.status === "declined") {
      el("conn-state").textContent = `${outgoingChallenge.name} declined the invite. The room is still open — send them the link, or go back.`;
    }
  }
  // a new invite: pop up unless you're in the middle of something
  const busy = ["game", "room", "coach", "review", "puzzle"].includes(viewState);
  for (const c of data.challengesIn) {
    if (seenInvites.has(c.id)) continue;
    seenInvites.add(c.id);
    if (!busy && !popupChallenge) showChallengePopup(c);
  }
  if (popupChallenge && !data.challengesIn.some((c) => c.id === popupChallenge.id)) hideChallengePopup();
}

onAuthChange((user) => {
  if (!user || user.uid === socialUid) return;
  if (socialUnsub) socialUnsub();
  socialUid = user.uid;
  seenInvites.clear();
  social = null;
  friendCards = {};
  socialUnsub = watchSocial(onSocial);
});

// the Friends tab itself
document.querySelectorAll("[data-ftab]").forEach((b) => {
  b.addEventListener("click", () => {
    const which = b.dataset.ftab;
    document.querySelectorAll("[data-ftab]").forEach((x) => x.classList.toggle("active", x === b));
    el("fr-pane-friends").classList.toggle("hidden", which !== "friends");
    el("fr-pane-challenges").classList.toggle("hidden", which !== "challenges");
  });
});
async function addFriendFromInput() {
  const msg = el("fr-add-msg");
  const r = await sendFriendRequest(el("fr-add-input").value);
  msg.textContent = r.ok
    ? r.became === "friends"
      ? `You and ${r.name} are now friends.`
      : `Request sent to ${r.name}. They need to accept it.`
    : r.error;
  msg.classList.toggle("warn", !r.ok);
  msg.classList.remove("hidden");
  if (r.ok) el("fr-add-input").value = "";
}
el("btn-fr-add").addEventListener("click", addFriendFromInput);
el("fr-add-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addFriendFromInput();
});

renderSocial(); // right away: badges and the "needs the database" note, before any data arrives

el("btn-stop-spectators").addEventListener("click", () => {
  if (!room || !room.isHost) return;
  if (room.watchOpen) {
    stopWatchRoom();
  } else {
    hostWantsSpectators = true;
    startWatchRoom(); // a brand-new code: the old one stays dead
  }
});

// On a phone the spectator controls are a popup opened from the toolbar.
el("btn-watch-manage").addEventListener("click", () => el("host-watch-card").classList.toggle("open"));
document.addEventListener("click", (e) => {
  const card = el("host-watch-card");
  if (card.classList.contains("open") && !card.contains(e.target) && !e.target.closest("#btn-watch-manage")) card.classList.remove("open");
});

// Host options: the privacy choice only matters once spectating is ticked.
function syncWatchPrivacyOptions() {
  const on = el("allow-spectators-toggle").checked;
  el("watch-privacy").classList.toggle("hidden", !on);
  el("list-public-row").classList.toggle("hidden", !isConfigured()); // there is no public list without the shared database
}
el("allow-spectators-toggle").addEventListener("change", syncWatchPrivacyOptions);
syncWatchPrivacyOptions();

// Watch tab: enter a watch code.
function watchFromInput() {
  const code = el("watch-code-input").value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const note = el("watch-code-note");
  if (code.length < 4) {
    note.textContent = "Enter the watch code your friend sent you.";
    note.classList.remove("hidden");
    return;
  }
  note.classList.add("hidden");
  el("watch-code-input").value = "";
  startSpectating(code);
}
el("btn-watch-code").addEventListener("click", watchFromInput);
el("watch-code-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") watchFromInput();
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
  if (!authBusy) hydrateProfileFromCloud();
  if (viewState === "account") {
    renderAccountCard();
    renderProfile();
    renderLeaderboard();
  }
});
