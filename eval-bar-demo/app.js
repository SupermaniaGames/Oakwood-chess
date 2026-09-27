import { Chess } from "./vendor/chess.js";
import { Engine } from "./engine.js";
import { formatScore, scoreToWhiteWinPercent } from "./eval-math.js";

const PIECES = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

const el = (id) => document.getElementById(id);
const boardEl = el("board");
const statusEl = el("status");
const depthEl = el("depth-indicator");
const evalFill = el("eval-fill");
const evalScoreEl = el("eval-score");

const game = new Chess();
let selected = null;
let legalTargets = [];
let lastMove = null;

// Search depth 14 is a reasonable balance for a single-threaded WASM build
// running on the main device's CPU in a browser tab — strong enough to be
// meaningful, shallow enough to stay responsive after every move.
const SEARCH_DEPTH = 14;
const engine = new Engine("vendor/stockfish/stockfish-nnue-16-single.js");

function render() {
  boardEl.innerHTML = "";
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      const square = "abcdefgh"[c] + (8 - r);
      const sq = document.createElement("div");
      sq.className = "sq " + ((r + c) % 2 === 0 ? "light" : "dark");
      sq.dataset.square = square;
      if (cell) sq.textContent = PIECES[cell.color][cell.type];
      if (selected === square) sq.classList.add("selected");
      if (legalTargets.some((m) => m.to === square)) sq.classList.add("legal");
      if (lastMove && (lastMove.from === square || lastMove.to === square)) sq.classList.add("last-move");
      sq.addEventListener("click", () => onSquareClick(square));
      boardEl.appendChild(sq);
    }
  }
  renderStatus();
}

function renderStatus() {
  if (game.isCheckmate()) {
    statusEl.textContent = `Checkmate — ${game.turn() === "w" ? "Black" : "White"} wins.`;
  } else if (game.isDraw() || game.isStalemate()) {
    statusEl.textContent = "Draw.";
  } else {
    statusEl.textContent = `${game.turn() === "w" ? "White" : "Black"} to move.`;
  }
}

function onSquareClick(square) {
  if (game.isGameOver()) return;
  if (selected) {
    const move = legalTargets.find((m) => m.to === square);
    if (move) {
      game.move({ from: selected, to: square, promotion: "q" }); // auto-queen for simplicity in this demo
      lastMove = { from: selected, to: square };
      selected = null;
      legalTargets = [];
      render();
      requestEvaluation();
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

function updateEvalBar(score) {
  const whitePercent = scoreToWhiteWinPercent(score);
  evalFill.style.width = `${whitePercent}%`;
  evalScoreEl.textContent = formatScore(score);
}

async function requestEvaluation() {
  depthEl.textContent = "Stockfish (WASM) · thinking…";
  const fen = game.fen();
  const result = await engine.evaluate(fen, {
    depth: SEARCH_DEPTH,
    onProgress: ({ depth, score }) => {
      updateEvalBar(score);
      depthEl.textContent = `Stockfish (WASM) · depth ${depth}`;
    },
  });
  if (result.score) updateEvalBar(result.score);
  depthEl.textContent = `Stockfish (WASM) · depth ${SEARCH_DEPTH} · best: ${result.move ?? "—"}`;
}

el("btn-reset").addEventListener("click", () => {
  game.reset();
  selected = null;
  legalTargets = [];
  lastMove = null;
  render();
  requestEvaluation();
});

render();
requestEvaluation();
