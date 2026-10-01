// A small, dependency-free chess engine with an Elo-style ladder of bots.
//
// Strength is controlled three ways, so each rung feels different rather
// than just "the same bot, slower":
//   - search budget: a node cap (not a clock), so a bot plays the same
//     strength on a fast laptop and a slow phone — the phone just takes
//     longer to answer;
//   - quiescence depth: how far it follows captures past its horizon
//     (low rungs hang pieces, high rungs rarely do);
//   - temperature: weaker rungs pick among candidate moves with a softmax
//     over their scores instead of always taking the best, which produces
//     human-looking inaccuracies rather than pure randomness.
//
// The Elo labels are approximate and relative — see BOTS below.
//
// Performance note: the search loop below uses chess.js's *internal*
// move representation (`_moves`/`_makeMove`/`_undoMove`, all underscore-
// prefixed and not part of its public API) instead of `.moves({verbose:
// true})`/`.move()`/`.undo()`. The public API builds a full SAN string
// (which itself requires generating sibling moves to check for
// disambiguation) on every single call, which made a several-thousand-node
// search take seconds instead of milliseconds. The internal shape is
// stable for the exact chess.js version vendored in this project
// (vendor/chess.js) but isn't a documented contract — if that file is ever
// upgraded, re-check this still works against the new internals.

function toAlgebraic(sq) {
  return "abcdefgh"[sq & 0xf] + "87654321"[sq >> 4];
}

function toExternalMove(m) {
  return { from: toAlgebraic(m.from), to: toAlgebraic(m.to), promotion: m.promotion };
}

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

// Standard simplified piece-square tables (Tomasz Michniewski's widely used
// values). Row 0 = rank 8 — this lines up directly with the internal 0x88
// board's `rank(sq) = sq >> 4`, and column 0 = file a lines up with
// `file(sq) = sq & 0xf` — used as-is for White, mirrored vertically (7-row)
// for Black.
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

// The ladder. `elo` is the label shown to players. Node budgets were tuned
// empirically so the *slowest* rung (1800) stays well under a second even
// from a busy, wide-open middlegame position on modest hardware.
export const BOTS = [
  { elo: 250, depth: 1, nodes: 150, temp: 900, q: 0 },
  { elo: 400, depth: 1, nodes: 150, temp: 350, q: 0 },
  { elo: 600, depth: 2, nodes: 400, temp: 160, q: 1 },
  { elo: 800, depth: 2, nodes: 900, temp: 120, q: 1 },
  { elo: 1000, depth: 3, nodes: 1800, temp: 70, q: 2 },
  { elo: 1200, depth: 3, nodes: 3500, temp: 45, q: 2 },
  { elo: 1400, depth: 4, nodes: 7000, temp: 25, q: 3 },
  { elo: 1600, depth: 4, nodes: 14000, temp: 12, q: 3 },
  { elo: 1800, depth: 5, nodes: 26000, temp: 0, q: 3 },
];

export const TIERS = [
  { name: "Beginner", elos: [250, 400, 600, 800] },
  { name: "Intermediate", elos: [1000, 1200, 1400, 1600] },
  { name: "Advanced", elos: [1800] },
];

export function botByElo(elo) {
  return BOTS.find((b) => b.elo === Number(elo)) || BOTS.find((b) => b.elo === 1000);
}

// Reads chess.js's internal sparse board directly — same values as the
// public board(), but without allocating a fresh 8x8 array of {square,
// type, color} objects on every single call (this runs at every leaf).
function evaluate(game) {
  let score = 0;
  const board = game._board;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const cell = board[sq];
    if (!cell) continue;
    const row = sq >> 4;
    const col = sq & 0xf;
    const value = PIECE_VALUES[cell.type];
    const table = PST[cell.type];
    const pos = table ? (cell.color === "w" ? table[row][col] : table[7 - row][col]) : 0;
    score += cell.color === "w" ? value + pos : -(value + pos);
  }
  return score;
}

function moveOrderScore(m) {
  // MVV-LVA-ish: prefer capturing big things with small things.
  let s = 0;
  if (m.captured) s += 10 * PIECE_VALUES[m.captured] - PIECE_VALUES[m.piece] / 10;
  if (m.promotion) s += 800;
  return s;
}

function orderedMoves(game) {
  const moves = game._moves();
  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
  return moves;
}

class Abort extends Error {}

function qsearch(game, alpha, beta, color, S, qdepth) {
  S.nodes++;
  const stand = color * evaluate(game);
  if (qdepth <= 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const moves = game._moves().filter((m) => m.captured || m.promotion);
  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
  for (const m of moves) {
    game._makeMove(m);
    const s = -qsearch(game, -beta, -alpha, -color, S, qdepth - 1);
    game._undoMove();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

// Negamax: `color` is +1 if it's White to move at this node, -1 if Black.
function negamax(game, depth, alpha, beta, color, ply, S) {
  if (S.enforce && S.nodes > S.max) throw new Abort();
  S.nodes++;
  const moves = orderedMoves(game);
  if (moves.length === 0) return game.isCheck() ? -(MATE - ply) : 0;
  if (depth === 0) return qsearch(game, alpha, beta, color, S, S.q);
  let best = -Infinity;
  for (const move of moves) {
    game._makeMove(move);
    const score = -negamax(game, depth - 1, -beta, -alpha, -color, ply + 1, S);
    game._undoMove();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function softmaxPick(scored, temp) {
  const top = Math.max(...scored.map((s) => s.score));
  const weights = scored.map((s) => Math.exp((s.score - top) / temp));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return scored[i].move;
  }
  return scored[scored.length - 1].move;
}

// Picks a move for whoever is to move in `game`. Leaves `game`'s position
// unchanged (and returns a plain {from, to, promotion} in algebraic
// notation, ready to hand to the public `game.move()`).
// `bot` is one of the BOTS entries (or an Elo number).
export function chooseBotMove(game, bot) {
  const p = typeof bot === "object" ? bot : botByElo(bot);
  const rootMoves = orderedMoves(game);
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) return toExternalMove(rootMoves[0]);

  const rootColor = game.turn() === "w" ? 1 : -1;
  const startLen = game.history().length;
  const S = { nodes: 0, max: p.nodes, enforce: false, q: p.q };
  const noisy = p.temp > 0;
  let lastGood = null; // per-move scores from the deepest fully completed depth

  for (let depth = 1; depth <= p.depth; depth++) {
    S.enforce = depth > 1; // depth 1 always completes, so we always have a move
    const scored = [];
    let bestSoFar = -Infinity;
    try {
      for (const move of rootMoves) {
        game._makeMove(move);
        let score;
        if (game.isDraw()) {
          score = 0;
        } else if (noisy) {
          // Weak bots pick among *all* moves by softmax, so every move
          // needs an exact (non-pruned) score.
          score = -negamax(game, depth - 1, -Infinity, Infinity, -rootColor, 1, S);
        } else {
          // Scores are integers, so searching with alpha = best - 1 keeps
          // moves that tie the best exact (they land inside the window)
          // while still pruning clearly worse ones — no false ties.
          const alpha = bestSoFar === -Infinity ? -Infinity : bestSoFar - 1;
          score = -negamax(game, depth - 1, -Infinity, -alpha, -rootColor, 1, S);
        }
        game._undoMove();
        scored.push({ move, score });
        if (score > bestSoFar) bestSoFar = score;
      }
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      // Out of budget mid-iteration: the half-searched result is unreliable.
      // negamax doesn't unmake its move when it throws, so unwind by hand.
      while (game.history().length > startLen) game._undoMove();
      break;
    }
    lastGood = scored;
    if (S.nodes > S.max) break;
  }

  if (!lastGood) return toExternalMove(rootMoves[0]);
  if (noisy) return toExternalMove(softmaxPick(lastGood, p.temp));

  const bestScore = Math.max(...lastGood.map((s) => s.score));
  const best = lastGood.filter((s) => s.score >= bestScore);
  return toExternalMove(best[Math.floor(Math.random() * best.length)].move);
}

// A strong, low-noise suggestion for the Hint button.
export function bestMoveHint(game) {
  return chooseBotMove(game, { elo: 0, depth: 4, nodes: 20000, temp: 0, q: 3 });
}
