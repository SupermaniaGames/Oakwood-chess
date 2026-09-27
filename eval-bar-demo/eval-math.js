// Pure helpers for turning Stockfish's UCI "info" lines into something a UI
// can render. No engine/DOM dependency here on purpose, so this is easy to
// unit test on its own.

// Parses one UCI line like:
//   "info depth 14 seldepth 20 multipv 1 score cp 35 nodes ... pv e2e4 e7e5"
//   "info depth 10 ... score mate -3 ... pv ..."
//   "bestmove e2e4 ponder e7e5"
// Returns { type: 'info', depth, score: {type:'cp'|'mate', value} } or
// { type: 'bestmove', move } or null if the line isn't one we care about.
// `score` is always from the *side to move*'s perspective, per the UCI spec
// — converting to an absolute (White-positive) score is the caller's job,
// since that requires knowing whose turn it was (see toWhiteRelative below).
export function parseUciLine(line) {
  if (line.startsWith("bestmove")) {
    const m = line.match(/^bestmove\s+(\S+)/);
    return m ? { type: "bestmove", move: m[1] } : null;
  }
  if (!line.startsWith("info")) return null;

  const depthMatch = line.match(/\bdepth\s+(\d+)/);
  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!scoreMatch) return null; // e.g. "info string ..." lines

  return {
    type: "info",
    depth: depthMatch ? parseInt(depthMatch[1], 10) : null,
    score: { type: scoreMatch[1], value: parseInt(scoreMatch[2], 10) },
  };
}

// UCI scores are from the side-to-move's perspective; flip sign when it was
// Black's turn so the result is consistently White-positive.
export function toWhiteRelative(score, sideToMove) {
  const sign = sideToMove === "b" ? -1 : 1;
  return { type: score.type, value: score.value * sign };
}

// Centipawns -> a signed pawns string, e.g. 290 -> "+2.9", -30 -> "-0.3".
// Mate scores get a "#" prefix instead, e.g. mate +3 -> "#3", mate -3 -> "#-3".
export function formatScore(score) {
  if (score.type === "mate") {
    return score.value === 0 ? "#0" : `#${score.value}`;
  }
  const pawns = score.value / 100;
  const sign = pawns > 0 ? "+" : pawns < 0 ? "-" : "";
  return `${sign}${Math.abs(pawns).toFixed(1)}`;
}

// Maps a White-relative score to White's estimated win percentage (0-100),
// using the same logistic curve Lichess uses for its eval bar — chosen so
// a ~1 pawn edge looks like a modest lean, not a near-certain win, while
// anything past a few pawns compresses toward the extremes.
export function scoreToWhiteWinPercent(score) {
  if (score.type === "mate") {
    if (score.value === 0) return 50;
    return score.value > 0 ? 99 : 1;
  }
  const cp = score.value;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
