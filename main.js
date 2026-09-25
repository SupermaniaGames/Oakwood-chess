import { Chess } from "./vendor/chess.js";
import { Room } from "./multiplayer.js";

const PIECES = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

const el = (id) => document.getElementById(id);
const boardEl = el("board");
const statusEl = el("status");

const game = new Chess();
let mode = null; // "local" | "online"
let myColor = "w"; // which side this browser plays, in online mode
let flipped = false;
let selected = null; // square string like "e2"
let legalTargets = []; // verbose move objects from selected square
let lastMove = null; // { from, to }
let room = null;
let pendingPromotion = null; // { from, to }

// ---------- Rendering ----------

function render() {
  boardEl.innerHTML = "";
  const boardState = game.board(); // 8x8, rank 8 -> rank 1, each row a -> h

  const rowOrder = flipped ? [...boardState].reverse() : boardState;
  for (let r = 0; r < 8; r++) {
    const row = rowOrder[r];
    const cols = flipped ? [...row].reverse() : row;
    for (let c = 0; c < 8; c++) {
      const cell = cols[c];
      const rankIndex = flipped ? r : 7 - r; // 0 = rank1
      const fileIndex = flipped ? 7 - c : c; // 0 = file a
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

      if (selected === square) sq.classList.add("selected");
      if (lastMove && (lastMove.from === square || lastMove.to === square)) sq.classList.add("last-move");
      const legal = legalTargets.find((m) => m.to === square);
      if (legal) {
        sq.classList.add("legal");
        if (legal.captured || legal.flags?.includes("e")) sq.classList.add("capture");
      }
      if (cell && cell.type === "k" && cell.color === game.turn() && game.inCheck()) {
        sq.classList.add("in-check");
      }

      sq.addEventListener("click", () => onSquareClick(square));
      boardEl.appendChild(sq);
    }
  }

  renderMoveList();
  renderStatus();
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
    const turnName = game.turn() === myColor ? "Your move" : "Waiting for your friend";
    statusEl.textContent = turnName;
  } else if (mode === "local") {
    statusEl.textContent = `${game.turn() === "w" ? "White" : "Black"} to move.`;
  } else {
    statusEl.textContent = "Set up a game to begin.";
  }

  if (mode === "online") {
    el("tag-you").classList.toggle("active", game.turn() === myColor);
    el("tag-them").classList.toggle("active", game.turn() !== myColor);
  }
}

// ---------- Interaction ----------

function onSquareClick(square) {
  if (!mode) return;
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
        showPromotionModal();
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
  if (mode === "online") {
    room.send({ type: "move", from, to, promotion });
  }
  return move;
}

function showPromotionModal() {
  el("promo-modal").classList.remove("hidden");
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

// ---------- Game setup ----------

function startLocal() {
  mode = "local";
  game.reset();
  selected = null;
  legalTargets = [];
  lastMove = null;
  flipped = false;
  showPanel("game-info");
  el("btn-resign").classList.add("hidden");
  render();
}

function startOnlineAsHost() {
  mode = "online";
  myColor = "w";
  game.reset();
  showPanel("room-info");

  room = new Room({
    onOpen: (id) => {
      const link = `${location.origin}${location.pathname}?join=${id}`;
      el("room-link").value = link;
    },
    onConnected: () => {
      el("conn-state").textContent = "Connected! You're playing White.";
      showPanel("game-info");
      el("btn-resign").classList.remove("hidden");
      flipped = false;
      render();
    },
    onData: handlePeerData,
    onPeerLeft: () => {
      statusEl.textContent = "Your friend disconnected.";
    },
    onError: (err) => {
      el("conn-state").textContent = "Connection problem: " + (err?.type || err?.message || "unknown error");
    },
  });
  room.host();
}

function startOnlineAsGuest(hostId) {
  mode = "online";
  myColor = "b";
  game.reset();
  flipped = true;
  showPanel("room-info");
  el("room-info").querySelector("h2").textContent = "Joining room…";
  el("room-info").querySelector(".link-row").classList.add("hidden");
  el("conn-state").textContent = "Connecting to your friend…";

  room = new Room({
    onConnected: () => {
      el("conn-state").textContent = "Connected! You're playing Black.";
      showPanel("game-info");
      el("btn-resign").classList.remove("hidden");
      render();
    },
    onData: handlePeerData,
    onPeerLeft: () => {
      statusEl.textContent = "Your friend disconnected.";
    },
    onError: (err) => {
      el("conn-state").textContent = "Connection problem: " + (err?.type || err?.message || "unknown error");
    },
  });
  room.join(hostId);
}

function handlePeerData(data) {
  if (data.type === "move") {
    game.move({ from: data.from, to: data.to, promotion: data.promotion });
    lastMove = { from: data.from, to: data.to };
    render();
  } else if (data.type === "resign") {
    statusEl.textContent = "Your friend resigned. You win!";
  } else if (data.type === "reset") {
    game.reset();
    selected = null;
    legalTargets = [];
    lastMove = null;
    render();
  }
}

function showPanel(id) {
  ["lobby", "room-info", "game-info"].forEach((p) => el(p).classList.toggle("hidden", p !== id));
}

// ---------- Controls ----------

el("btn-create").addEventListener("click", startOnlineAsHost);
el("btn-local").addEventListener("click", startLocal);

el("btn-copy").addEventListener("click", async () => {
  const input = el("room-link");
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    el("btn-copy").textContent = "Copied";
    setTimeout(() => (el("btn-copy").textContent = "Copy"), 1500);
  } catch {
    document.execCommand("copy");
  }
});

el("btn-flip").addEventListener("click", () => {
  flipped = !flipped;
  render();
});

el("btn-resign").addEventListener("click", () => {
  if (mode === "online" && room) room.send({ type: "resign" });
  statusEl.textContent = "You resigned.";
});

el("btn-new").addEventListener("click", () => {
  if (mode === "online" && room) room.send({ type: "reset" });
  game.reset();
  selected = null;
  legalTargets = [];
  lastMove = null;
  render();
});

// ---------- Boot ----------

const params = new URLSearchParams(location.search);
const joinId = params.get("join");
if (joinId) {
  startOnlineAsGuest(joinId);
} else {
  showPanel("lobby");
}
render();
