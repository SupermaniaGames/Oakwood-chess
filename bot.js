// A small, dependency-free chess engine: minimax with alpha-beta pruning
// over material + standard piece-square tables. It's not a strong engine —
// it's meant to give genuinely different, recognizable difficulty levels
// for casual and practice play, not to challenge a serious player.

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Standard simplified piece-square tables (Tomasz Michniewski's widely used
// values). Row 0 = rank 8, matching chess.js's board() layout — used
// directly for White, mirrored vertically for Black.
const PST = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
};

export const DIFFICULTIES = {
  easy: { label: "Easy", maxDepth: 1, randomness: 0.55, timeBudgetMs: 200 },
  medium: { label: "Medium", maxDepth: 3, randomness: 0.2, timeBudgetMs: 500 },
  hard: { label: "Hard", maxDepth: 4, randomness: 0.04, timeBudgetMs: 1200 },
};

function evaluate(game) {
  if (game.isCheckmate()) {
    // Side to move has no moves and is in check — they've lost.
    return game.turn() === "w" ? -100000 : 100000;
  }
  if (game.isStalemate() || game.isDraw()) return 0;

  let score = 0;
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      const value = PIECE_VALUES[cell.type];
      const table = PST[cell.type];
      const posValue = table ? (cell.color === "w" ? table[r][c] : table[7 - r][c]) : 0;
      score += cell.color === "w" ? value + posValue : -(value + posValue);
    }
  }
  return score;
}

function orderedMoves(game) {
  const moves = game.moves({ verbose: true });
  // Cheap move ordering (captures first) noticeably improves alpha-beta
  // pruning without needing a real transposition table.
  moves.sort((a, b) => (PIECE_VALUES[b.captured] || 0) - (PIECE_VALUES[a.captured] || 0));
  return moves;
}

// Negamax: `color` is +1 if it's White to move at this node, -1 if Black.
function negamax(game, depth, alpha, beta, color) {
  if (depth === 0 || game.isGameOver()) {
    return color * evaluate(game);
  }
  let best = -Infinity;
  for (const move of orderedMoves(game)) {
    game.move(move);
    const score = -negamax(game, depth - 1, -beta, -alpha, -color);
    game.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // prune
  }
  return best;
}

// Picks a move for whoever's turn it currently is in `game`. Mutates and
// restores `game`'s state during search, but leaves it unchanged on return.
// Uses iterative deepening so search time stays bounded even in complex
// middlegame positions — a fixed depth could take seconds in a busy
// position and be instant in a quiet one.
export function chooseBotMove(game, difficultyKey) {
  const settings = DIFFICULTIES[difficultyKey] || DIFFICULTIES.medium;
  const moves = orderedMoves(game);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  if (Math.random() < settings.randomness) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const rootColor = game.turn() === "w" ? 1 : -1;
  const deadline = Date.now() + settings.timeBudgetMs;
  let bestMoves = [moves[0]];

  for (let depth = 1; depth <= settings.maxDepth; depth++) {
    let bestScore = -Infinity;
    let movesAtDepth = [];
    let timedOut = false;
    for (const move of moves) {
      if (depth > 1 && Date.now() > deadline) {
        timedOut = true;
        break;
      }
      game.move(move);
      const score = -negamax(game, depth - 1, -Infinity, Infinity, -rootColor);
      game.undo();
      if (score > bestScore + 1e-6) {
        bestScore = score;
        movesAtDepth = [move];
      } else if (Math.abs(score - bestScore) < 1e-6) {
        movesAtDepth.push(move);
      }
    }
    if (timedOut) break; // keep the last fully-completed depth's result
    bestMoves = movesAtDepth;
    if (Date.now() > deadline) break;
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
