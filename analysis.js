// Post-game analysis: scores every position of a game with the built-in
// engine (bot.js), then turns those scores into the things the Game Review
// screen shows — a move-quality label for each move, accuracy for each side,
// a kid-friendly name for what went wrong, and the coach's sentence.
//
// HOW GOOD IS IT? Honest answer: it's only as good as bot.js's search
// (a few plies deep, a small node budget so a phone can finish a game in
// reasonable time). Clear blunders and missed mates are caught reliably;
// the fine calls — Excellent vs Good, and especially Brilliant and Great,
// which need a deep look at why a sacrifice works — are approximate. The
// engine is a replaceable piece (see setEngine): a Stockfish build wrapped
// to the same `analyze(fen)` shape would drop straight in.

import { Chess } from "./vendor/chess.js";
import { scoreAllMoves, MATE_THRESHOLD } from "./bot.js";
import { createStockfish } from "./stockfish.js";
import { moveFacts, phaseOf as phaseOfPly, tacticOf } from "./coach.js";
import { isBookPly, openingAt } from "./openings.js";

// Built-in engine budgets (used when Stockfish isn't available).
export const ANALYSIS_PARAMS = { depth: 3, nodes: 15000, q: 1 };
export const LIVE_PARAMS = { depth: 3, nodes: 8000, q: 1 };
const BOT_PRESETS = { quick: ANALYSIS_PARAMS, deep: { depth: 4, nodes: 40000, q: 2 }, live: LIVE_PARAMS };
// Stockfish budgets: stop at this depth or this many milliseconds, whichever first.
export const ENGINE_PRESETS = {
  quick: { depth: 10, movetime: 700 },
  deep: { depth: 14, movetime: 2500 },
  live: { depth: 10, movetime: 500 },
};
const MATE = 100000;

// ---------- The ten move classes ----------

export const CLASS_INFO = {
  brilliant: { label: "Brilliant", mark: "!!", color: "#1baca6", spoken: "Brilliant move!" },
  great: { label: "Great", mark: "!", color: "#5c8bb0", spoken: "Great move!" },
  best: { label: "Best", mark: "⭐", color: "#8bbf5a", spoken: "Best move." },
  excellent: { label: "Excellent", mark: "👍", color: "#96bc4b", spoken: "Excellent." },
  good: { label: "Good", mark: "✔️", color: "#7d9b6a", spoken: "Good move." },
  book: { label: "Book", mark: "📖", color: "#a88865", spoken: "" }, // spoken specially (needs the move)
  inaccuracy: { label: "Inaccuracy", mark: "?!", color: "#f7c631", spoken: "Inaccuracy." },
  mistake: { label: "Mistake", mark: "?", color: "#e58f2a", spoken: "Mistake." },
  miss: { label: "Miss", mark: "❌", color: "#ee6b55", spoken: "Missed chance." },
  blunder: { label: "Blunder", mark: "??", color: "#ca3431", spoken: "Blunder!" },
};
export const CLASS_ORDER = Object.keys(CLASS_INFO);

// ---------- Scores -> win probability ----------

const MAX_CP = 1500;

export function scoreToCp(score) {
  if (Math.abs(score) >= MATE_THRESHOLD) return score > 0 ? MAX_CP : -MAX_CP;
  return Math.max(-MAX_CP, Math.min(MAX_CP, score));
}

// Centipawns -> chance (0..100) that the side the score favours wins.
// Same logistic curve Lichess uses.
export function winPercent(score) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * scoreToCp(score))) - 1);
}

// One move's accuracy from the win-% it threw away (Lichess' formula).
export function moveAccuracy(winDrop) {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, winDrop)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

// Whole-game accuracy for one side: the average of a volatility-weighted
// mean (mistakes in sharp positions count for more) and a harmonic mean
// (one awful move drags the score down hard) — as Lichess does it.
export function gameAccuracy(accs, weights) {
  if (accs.length === 0) return null;
  let wSum = 0;
  let wTotal = 0;
  let inv = 0;
  accs.forEach((a, i) => {
    const w = weights[i] || 1;
    wSum += a * w;
    wTotal += w;
    inv += 1 / Math.max(a, 0.5);
  });
  const weighted = wSum / wTotal;
  const harmonic = accs.length / inv;
  return Math.round(((weighted + harmonic) / 2) * 10) / 10;
}

function volatilityWeights(winSeries) {
  // winSeries: White's win% after each ply (index 0 = the starting position).
  const n = winSeries.length;
  const win = Math.max(2, Math.min(8, Math.round(n / 10)));
  const weights = [];
  for (let i = 1; i < n; i++) {
    const from = Math.max(0, i - win);
    const slice = winSeries.slice(from, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length);
    weights.push(Math.max(0.5, Math.min(12, sd)));
  }
  return weights; // weights[i-1] belongs to ply i
}

// ---------- The engine (replaceable) ----------

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const PIECE_NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

// Synchronous: score every move in one position. This is what both the
// worker and the no-worker fallback run.
export function analyzeFenSync(fen, params = ANALYSIS_PARAMS) {
  const g = new Chess(fen);
  const res = scoreAllMoves(g, params);
  return {
    fen,
    turn: g.turn(),
    moves: res.moves, // sorted best-first, scores from the side-to-move's view
    depth: res.depth,
    inCheck: g.isCheck(),
    legalCount: res.moves.length,
    lines: res.moves.slice(0, 1).map((m) => ({ score: m.score, pv: [m.from + m.to + (m.promotion || "")] })),
    engine: "builtin",
  };
}

function makeDefaultEngine() {
  let worker = null;
  let failed = false;
  const pending = new Map();
  let nextId = 1;

  function start() {
    if (worker || failed || typeof Worker === "undefined") return;
    try {
      worker = new Worker(new URL("./analysis-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data.result);
      };
      worker.onerror = () => {
        // Worker couldn't load (old browser, file:// etc.): fall back to the
        // main thread for everything from here on, and retry what was queued.
        failed = true;
        worker = null;
        for (const [id, p] of pending) {
          pending.delete(id);
          p.retry();
        }
      };
    } catch {
      failed = true;
      worker = null;
    }
  }

  return {
    analyze(fen, params) {
      start();
      if (!worker) {
        // Main-thread fallback: yield first so the UI can paint between positions.
        return new Promise((resolve) => setTimeout(() => resolve(analyzeFenSync(fen, params)), 0));
      }
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, {
          resolve,
          reject,
          retry: () => setTimeout(() => resolve(analyzeFenSync(fen, params)), 0),
        });
        worker.postMessage({ id, fen, params });
      });
    },
    stop() {
      if (worker) worker.terminate();
      worker = null;
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(new Error("cancelled"));
      }
    },
  };
}

const botEngine = makeDefaultEngine();

// Stockfish is the preferred engine. It starts on first use; if its files
// are missing or it can't start (old browser, blocked worker) everything
// quietly falls back to the built-in engine above.
let sf = null;
let sfStatus = "idle"; // idle | ready | failed
function getStockfish() {
  if (sfStatus === "failed") return null;
  if (!sf) {
    sf = createStockfish();
    sf.ready.then(
      () => (sfStatus = "ready"),
      () => (sfStatus = "failed")
    );
  }
  return sf;
}

// UCI "mate N" -> a huge centipawn-style number so one scale covers both.
function uciScore(sc) {
  if (sc.type === "mate") return sc.value > 0 ? MATE - sc.value : -(MATE + sc.value);
  return sc.value;
}

async function stockfishAnalyze(fen, preset) {
  const g = new Chess(fen);
  const legalCount = g.moves().length;
  const base = { fen, turn: g.turn(), inCheck: g.isCheck(), legalCount, engine: "stockfish" };
  if (legalCount === 0) return { ...base, moves: [], lines: [], depth: 0 }; // mate / stalemate
  const res = await getStockfish().analyze(fen, { ...ENGINE_PRESETS[preset || "quick"], multipv: 3 });
  if (!res || res.lines.length === 0) throw new Error("no result");
  const lines = res.lines.map((l) => ({ score: uciScore(l.score), pv: l.pv, depth: l.depth }));
  const moves = lines.map((l) => ({
    from: l.pv[0].slice(0, 2),
    to: l.pv[0].slice(2, 4),
    promotion: l.pv[0][4],
    score: l.score,
  }));
  return { ...base, moves, lines, depth: Math.max(...lines.map((l) => l.depth)) };
}

// The engine Game Review uses: Stockfish when available, else the built-in one.
const autoEngine = {
  async analyze(fen, preset = "quick") {
    if (sfStatus !== "failed") {
      try {
        return await stockfishAnalyze(fen, preset);
      } catch {
        if (sfStatus === "idle") sfStatus = "failed";
        else if (sf && sf.failed) sfStatus = "failed";
      }
    }
    return botEngine.analyze(fen, BOT_PRESETS[preset] || BOT_PRESETS.quick);
  },
  stop() {
    botEngine.stop();
  },
};

let engine = autoEngine;

// Swap in a different engine: an object with analyze(fen, preset) returning a
// Promise of { moves: [{from,to,promotion,score}], depth, legalCount } (scores
// in centipawns from the side-to-move's view, best first).
export function setEngine(e) {
  engine = e;
}

// Which engine actually did the work ("Stockfish 16" or "Built-in engine").
export function engineName() {
  return sfStatus === "ready" ? "Stockfish 16" : "Built-in engine";
}

// Live score for the evaluation bar. onUpdate({cp, depth, best}) is called as
// the search deepens (cp is from White's point of view). A newer call cancels
// the older one. Falls back to a one-shot built-in evaluation.
export function liveEvaluate(fen, onUpdate) {
  const g = new Chess(fen);
  const sign = g.turn() === "b" ? -1 : 1;
  if (g.moves().length === 0) {
    const cp = g.isCheckmate() ? (g.turn() === "w" ? -(MATE - 1) : MATE - 1) : 0;
    onUpdate({ cp, depth: 0, best: null, final: true });
    return Promise.resolve();
  }
  const fallback = async () => {
    const a = await botEngine.analyze(fen, LIVE_PARAMS);
    if (a.moves.length) onUpdate({ cp: sign * a.moves[0].score, depth: a.depth, best: a.moves[0].from + a.moves[0].to, final: true });
  };
  const s = getStockfish();
  if (!s || sfStatus === "failed") return fallback();
  return s
    .evaluate(fen, {
      ...ENGINE_PRESETS.deep,
      onProgress: (info) => onUpdate({ cp: sign * uciScore(info.score), depth: info.depth, best: info.pv[0], final: false }),
    })
    .then((res) => {
      if (res && res.lines[0]) onUpdate({ cp: sign * uciScore(res.lines[0].score), depth: res.lines[0].depth, best: res.best, final: true });
    })
    .catch(fallback);
}

// What the side that just moved would do if it could move again — the
// "threat". Not available while the side to move is in check.
export async function analyzeThreat(fen) {
  const g = new Chess(fen);
  if (g.isCheck()) return null;
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-"; // en passant no longer applies
  const flipped = parts.join(" ");
  try {
    const a = await autoEngine.analyze(flipped, "live");
    return a.moves.length ? { from: a.moves[0].from, to: a.moves[0].to, score: a.moves[0].score } : null;
  } catch {
    return null;
  }
}

// ---------- Judging one move ----------

function sameMove(a, b) {
  return a.from === b.from && a.to === b.to && (a.promotion || "") === (b.promotion || "");
}

// A piece move that gives up material: the moved piece can be taken and,
// after the best recapture, the side that moved is down at least two pawns'
// worth. A one-exchange estimate — good enough to spot "this piece is being
// offered", not a full exchange calculation.
function isSacrifice(fenBefore, played) {
  const g = new Chess(fenBefore);
  const mover = g.turn();
  const enemy = mover === "w" ? "b" : "w";
  let m;
  try {
    m = g.move({ from: played.from, to: played.to, promotion: played.promotion });
  } catch {
    return false;
  }
  if (!m || m.piece === "p" || m.piece === "k") return false;
  const gained = m.captured ? VAL[m.captured] : 0;
  const attackers = g.attackers(m.to, enemy);
  if (attackers.length === 0) return false;
  const lowestAttacker = Math.min(...attackers.map((sq) => VAL[g.get(sq).type]));
  const defended = g.attackers(m.to, mover).length > 0;
  const net = defended ? gained - VAL[m.piece] + lowestAttacker : gained - VAL[m.piece];
  return net <= -2;
}

// Core judgement, shared by the full-game review and the live spectator
// commentary. `a` is the engine's analysis of the position BEFORE the move.
export function judgeMove({ a, played, fenBefore, san, book, prevOppDrop = 0, prevTo = null }) {
  const best = a.moves[0];
  const entry = a.moves.find((m) => sameMove(m, played)) || best;
  const second = a.moves[1] || null;
  const winBest = winPercent(best.score);
  const winPlayed = winPercent(entry.score);
  const drop = Math.max(0, winBest - winPlayed);
  const isBest = sameMove(entry, best) || drop <= 0.3;

  let cls;
  const legal = a.legalCount != null ? a.legalCount : a.moves.length;
  if (legal === 1) {
    cls = book ? "book" : "best"; // forced: nothing to judge
  } else if (drop >= 20) {
    cls = "blunder";
  } else if (drop >= 10) {
    cls = prevOppDrop >= 10 ? "miss" : "mistake";
  } else if (drop >= 5) {
    cls = prevOppDrop >= 10 ? "miss" : "inaccuracy";
  } else {
    cls = isBest ? "best" : drop < 2 ? "excellent" : "good";
    // A forced recapture isn't "great" — taking back the piece that just took
    // is what anyone would do — so only non-recaptures can earn it.
    const isRecapture = prevTo && played.to === prevTo;
    if (legal >= 4 && second && isBest && !isRecapture) {
      const onlyMove = winBest - winPercent(second.score) >= 15;
      if (onlyMove) cls = "great";
    }
    if (drop <= 2 && winPlayed >= 40 && winBest < 92 && isSacrifice(fenBefore, played)) cls = "brilliant";
    if (cls === "great" && san.endsWith("#")) cls = "best"; // delivering mate isn't a "great" find
  }
  if (book && drop < 10) cls = "book";

  return {
    cls,
    drop,
    winBest,
    winPlayed,
    bestMove: best,
    playedScore: entry.score,
    bestScore: best.score,
    secondScore: second ? second.score : null,
  };
}

// ---------- Kid-friendly "what went wrong" ----------

const nameOf = (type) => PIECE_NAME[type] || "piece";

// What does `moveObj` do on `fen`: capture something undefended? fork? pin?
function describeMove(fen, moveObj) {
  const g = new Chess(fen);
  const mover = g.turn();
  const enemy = mover === "w" ? "b" : "w";
  let m;
  try {
    m = g.move({ from: moveObj.from, to: moveObj.to, promotion: moveObj.promotion });
  } catch {
    return {};
  }
  const out = { san: m.san, mate: g.isCheckmate() };

  if (m.captured) {
    const defended = g.attackers(m.to, enemy).length > 0;
    const gain = VAL[m.captured] - (defended ? VAL[m.piece] : 0);
    if (gain >= 2) out.wins = { piece: m.captured, free: !defended };
  }

  // Fork: the moved piece now attacks two or more enemy pieces that are
  // either worth more than it or not protected.
  const attacked = [];
  for (const row of g.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy || cell.square === m.to) continue;
      if (!g.attackers(cell.square, mover).includes(m.to)) continue;
      const protectedPiece = g.attackers(cell.square, enemy).length > 0;
      if (VAL[cell.type] > VAL[m.piece] || !protectedPiece || cell.type === "k") {
        if (cell.type !== "p" || !protectedPiece) attacked.push(cell);
      }
    }
  }
  if (attacked.length >= 2) out.fork = attacked.map((c) => c.type);

  // Pin: a bishop/rook/queen move that lines up a piece with something more
  // valuable (or the king) behind it.
  if (["b", "r", "q"].includes(m.piece)) {
    const dirs = [];
    if (m.piece !== "b") dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    if (m.piece !== "r") dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    const file0 = m.to.charCodeAt(0) - 97;
    const rank0 = Number(m.to[1]) - 1;
    for (const [df, dr] of dirs) {
      let f = file0 + df;
      let r = rank0 + dr;
      const seen = [];
      while (f >= 0 && f < 8 && r >= 0 && r < 8 && seen.length < 2) {
        const p = g.get("abcdefgh"[f] + (r + 1));
        if (p) {
          if (p.color !== enemy) break;
          seen.push(p);
        }
        f += df;
        r += dr;
      }
      if (seen.length === 2 && VAL[seen[1].type] > VAL[seen[0].type]) {
        out.pin = [seen[0].type, seen[1].type];
        break;
      }
    }
  }
  return out;
}

// Names the problem in words a child can use. `reply` is the opponent's best
// answer after the move (engine analysis of the following position).
export function kidTag({ fenBefore, fenAfter, judged, replyBest, replyScore }) {
  if (judged.bestScore >= MATE_THRESHOLD && judged.playedScore < MATE_THRESHOLD) {
    return { tag: "Missed Checkmate", text: "There was a checkmate here!" };
  }
  if (replyScore != null && replyScore >= MATE_THRESHOLD) {
    return { tag: "Walked into Checkmate", text: "That lets the other side checkmate you." };
  }
  if (replyBest) {
    const d = describeMove(fenAfter, replyBest);
    if (d.wins) {
      return {
        tag: "Hanging Piece",
        text: d.wins.free
          ? `That leaves a ${nameOf(d.wins.piece)} hanging — nothing protects it.`
          : `That lets the other side win a ${nameOf(d.wins.piece)} in a trade.`,
      };
    }
    if (d.fork) return { tag: "Fork", text: "That allows a fork — one piece attacking two at once." };
    if (d.pin) {
      return { tag: "Pin", text: `That allows a pin — your ${nameOf(d.pin[0])} can't move without exposing your ${nameOf(d.pin[1])}.` };
    }
  }
  const missed = describeMove(fenBefore, judged.bestMove);
  if (missed.fork) return { tag: "Fork Missed", text: "You could have forked two pieces at once." };
  if (missed.wins && missed.wins.free) {
    return { tag: "Free Piece Missed", text: `A ${nameOf(missed.wins.piece)} was free to take.` };
  }
  return null;
}

// ---------- Words ----------

export function sanToSpoken(san) {
  if (!san) return "";
  if (san.startsWith("O-O-O")) return "castles queenside" + (san.endsWith("#") ? ", checkmate" : san.endsWith("+") ? ", check" : "");
  if (san.startsWith("O-O")) return "castles kingside" + (san.endsWith("#") ? ", checkmate" : san.endsWith("+") ? ", check" : "");
  const names = { N: "Knight", B: "Bishop", R: "Rook", Q: "Queen", K: "King" };
  let s = san;
  let prefix = "";
  if (names[s[0]]) {
    prefix = names[s[0]] + " ";
    s = s.slice(1);
  }
  let suffix = "";
  if (s.endsWith("#")) {
    suffix = ", checkmate";
    s = s.slice(0, -1);
  } else if (s.endsWith("+")) {
    suffix = ", check";
    s = s.slice(0, -1);
  }
  s = s.replace("x", " takes ").replace("=", " promotes to ");
  return (prefix + s + suffix).replace(/\s+/g, " ").trim();
}

// The coach's words for a move, in two parts like chess.com's bubble: a
// headline ("c6 is an inaccuracy") and one sentence of explanation.
export function coachText({ san, cls, bestSan, kid, openingNote, openingName }) {
  const tail = (best, phrase) => [kid && kid.text, best ? `${best} ${phrase}` : ""].filter(Boolean).join(" ");
  switch (cls) {
    case "book":
      return { title: `${san} is a book move`, detail: openingNote || (openingName ? `${openingName}.` : "A well-known opening move.") };
    case "brilliant":
      return { title: `${san} is brilliant`, detail: "A clever sacrifice that pays off!" };
    case "great":
      return { title: `${san} is great`, detail: "It was the only move that kept things under control." };
    case "best":
      return { title: `${san} is best`, detail: "The strongest move in this position." };
    case "excellent":
      return { title: `${san} is excellent`, detail: "Almost as good as the very best move." };
    case "good":
      return { title: `${san} is good`, detail: "A solid move that keeps the position healthy." };
    case "inaccuracy":
      return { title: `${san} is an inaccuracy`, detail: tail(bestSan, "was a little better.") || "There was a slightly better move." };
    case "mistake":
      return { title: `${san} is a mistake`, detail: tail(bestSan, "was better.") || "There was a much better move." };
    case "miss":
      return { title: `${san} is a miss`, detail: tail(bestSan, "was the move to find.") || "A chance to gain an advantage slipped by." };
    case "blunder":
      return { title: `${san} is a blunder`, detail: tail(bestSan, "was much better.") || "That gives away a lot." };
    default:
      return { title: `${san}`, detail: "" };
  }
}

// The short line the voice speaks (kept brief: "e4 is a book move",
// "Brilliant move!", "Blunder!").
export function spokenText({ san, cls, kid }) {
  if (cls === "book") return `${sanToSpoken(san)} is a book move`;
  const base = CLASS_INFO[cls]?.spoken || "";
  if ((cls === "blunder" || cls === "mistake" || cls === "miss") && kid) return `${base} ${kid.tag}.`;
  return base;
}

// ---------- Whole-game analysis ----------

function whiteView(score, turn) {
  return turn === "w" ? score : -score;
}

// Score of the position AFTER a move, from the mover's point of view, when the
// engine didn't score that exact move itself (Stockfish only returns its top
// lines): it's the opposing side's best score, negated. A finished game has no
// moves to search, so checkmate counts as a win for the mover.
function afterMoveScore(next, fenAfter) {
  if (next && next.moves.length) return -next.moves[0].score;
  const g = new Chess(fenAfter);
  return g.isCheckmate() ? MATE - 1 : 0;
}

const PHASE_VALUE = { n: 3, b: 3, r: 5, q: 9 };
function nonPawnMaterial(fen) {
  const g = new Chess(fen);
  const m = { w: 0, b: 0 };
  for (const row of g.board()) for (const c of row) if (c && PHASE_VALUE[c.type]) m[c.color] += PHASE_VALUE[c.type];
  return m;
}

// moves: chess.js verbose history. Returns
// { plies, positions, counts, acpl, phases, accuracy:{w,b}, opening, depth, engine }.
// onProgress(done, total); cancel is { cancelled: boolean }.
export async function analyzeGame({ moves, startFen, preset = "quick", onProgress, cancel }) {
  const g = startFen ? new Chess(startFen) : new Chess();
  const sans = moves.map((m) => m.san);
  const analyses = [];
  const fens = [g.fen()];
  const total = moves.length + 1; // every position, including the final one

  for (let i = 0; i < moves.length; i++) {
    g.move({ from: moves[i].from, to: moves[i].to, promotion: moves[i].promotion });
    fens.push(g.fen());
  }
  for (let i = 0; i < total; i++) {
    if (cancel && cancel.cancelled) throw new Error("cancelled");
    analyses.push(await engine.analyze(fens[i], preset));
    if (onProgress) onProgress(i + 1, total);
  }

  // The engine may not have scored the move that was actually played (Stockfish
  // returns only its best few); derive that score from the following position.
  moves.forEach((m, i) => {
    const a = analyses[i];
    const played = { from: m.from, to: m.to, promotion: m.promotion };
    if (!a.moves.some((x) => sameMove(x, played))) {
      a.moves = [...a.moves, { ...played, score: afterMoveScore(analyses[i + 1], fens[i + 1]) }];
    }
  });

  const plies = [];
  let prevDrop = 0;
  const winSeries = [winPercent(analyses[0].moves.length ? whiteView(analyses[0].moves[0].score, analyses[0].turn) : 0)];

  for (let i = 0; i < moves.length; i++) {
    const a = analyses[i];
    const m = moves[i];
    const played = { from: m.from, to: m.to, promotion: m.promotion };
    const bookNow = !startFen && isBookPly(sans, i + 1);
    const j = judgeMove({
      a,
      played,
      fenBefore: fens[i],
      san: m.san,
      book: bookNow,
      prevOppDrop: prevDrop,
      prevTo: i > 0 ? moves[i - 1].to : null,
    });
    const next = analyses[i + 1];
    const replyBest = next && next.moves[0] ? next.moves[0] : null;
    let kid = null;
    if (["inaccuracy", "mistake", "miss", "blunder"].includes(j.cls)) {
      kid = kidTag({
        fenBefore: fens[i],
        fenAfter: fens[i + 1],
        judged: j,
        replyBest,
        replyScore: replyBest ? replyBest.score : null,
      });
    }
    const evalWhite = whiteView(j.playedScore, a.turn);
    winSeries.push(winPercent(evalWhite));
    let bestSan = null;
    try {
      bestSan = new Chess(fens[i]).move(j.bestMove).san;
    } catch {
      /* best move couldn't be rendered; the text just omits it */
    }
    const op = !startFen ? openingAt(sans, i + 1) : null;
    // Moves about as good as the best one: "Retry" accepts any of them.
    const acceptable = a.moves
      .filter((x) => j.winBest - winPercent(x.score) <= 3.5)
      .map((x) => ({ from: x.from, to: x.to }));
    const sacrifice = ["n", "b", "r", "q"].includes(m.piece) && isSacrifice(fens[i], played);
    const facts = moveFacts(fens[i], played, { ply: i + 1, prevMove: i > 0 ? moves[i - 1] : null, prevOwn: i > 1 ? moves[i - 2] : null, sacrifice });
    const replyFacts = replyBest ? moveFacts(fens[i + 1], replyBest, { ply: i + 2, prevMove: m }) : null;
    const bestIsPlayed = j.bestMove.from === m.from && j.bestMove.to === m.to;
    const bestFacts = bestIsPlayed ? null : moveFacts(fens[i], j.bestMove, { ply: i + 1, prevMove: i > 0 ? moves[i - 1] : null, prevOwn: i > 1 ? moves[i - 2] : null });
    plies.push({
      ply: i + 1,
      color: m.color,
      san: m.san,
      facts,
      replyFacts,
      bestFacts,
      phase: phaseOfPly(i + 1, fens[i]),
      opening: op ? op.name : null,
      openingKid: op && op.exact ? op.kidNote : null,
      from: m.from,
      to: m.to,
      fenBefore: fens[i],
      fenAfter: fens[i + 1],
      cls: j.cls,
      drop: j.drop,
      cpLoss: Math.max(0, Math.min(1000, scoreToCp(j.bestScore) - scoreToCp(j.playedScore))),
      evalWhite, // centipawns, White's point of view, after the move
      winWhite: winSeries[i + 1],
      bestSan,
      kid,
      openingNote: op && op.exact ? op.note : null,
      ...coachText({
        san: m.san,
        cls: j.cls,
        bestSan,
        kid,
        openingNote: op && op.exact ? op.note : null,
        openingName: op ? op.name : null,
      }),
      bestFrom: j.bestMove.from,
      bestTo: j.bestMove.to,
      acceptable,
      speech: spokenText({ san: m.san, cls: j.cls, kid }),
    });
    prevDrop = j.drop;
  }

  // Per-position data for the evaluation bar, suggestion arrows and engine
  // lines: position i is the board after i moves.
  const positions = fens.map((fen, i) => {
    const a = analyses[i];
    const evalWhite = i === 0 ? (a.moves.length ? whiteView(a.moves[0].score, a.turn) : 0) : plies[i - 1].evalWhite;
    let lines = [];
    if (a.lines && a.lines.length) {
      lines = a.lines.map((l) => {
        const c = new Chess(fen);
        const san = [];
        for (const u of l.pv.slice(0, 6)) {
          try {
            san.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
          } catch {
            break;
          }
        }
        return { san, score: whiteView(l.score, a.turn) };
      });
    }
    const best = a.moves.length ? { from: a.moves[0].from, to: a.moves[0].to } : null;
    return { fen, evalWhite, best, lines };
  });

  const weights = volatilityWeights(winSeries);
  const accs = { w: [], b: [] };
  const ws = { w: [], b: [] };
  const loss = { w: [], b: [] };
  const phaseOf = (p) => {
    if (p.ply <= 20) return "opening";
    const m = nonPawnMaterial(p.fenBefore);
    return m.w <= 13 && m.b <= 13 ? "endgame" : "middlegame";
  };
  const phaseAcc = { opening: { w: [], b: [], ww: { w: [], b: [] } }, middlegame: { w: [], b: [], ww: { w: [], b: [] } }, endgame: { w: [], b: [], ww: { w: [], b: [] } } };
  plies.forEach((p, i) => {
    const acc = moveAccuracy(p.drop);
    accs[p.color].push(acc);
    ws[p.color].push(weights[i]);
    loss[p.color].push(p.cpLoss);
    const ph = phaseAcc[phaseOf(p)];
    ph[p.color].push(acc);
    ph.ww[p.color].push(weights[i]);
  });
  const phases = {};
  for (const k of Object.keys(phaseAcc)) {
    const ph = phaseAcc[k];
    phases[k] = { w: gameAccuracy(ph.w, ph.ww.w), b: gameAccuracy(ph.b, ph.ww.b) };
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

  // How many moves of each quality each side played (for the summary table).
  const counts = { w: {}, b: {} };
  for (const k of CLASS_ORDER) {
    counts.w[k] = 0;
    counts.b[k] = 0;
  }
  plies.forEach((p) => counts[p.color][p.cls]++);
  // The single move that cost the most — the "turning point" the coach mentions.
  let turning = null;
  plies.forEach((p) => {
    if (p.drop >= 10 && (!turning || p.drop > turning.drop)) turning = p;
  });

  // The opening name shown in the header: the deepest one the game reached.
  let opening = null;
  if (!startFen) {
    for (let p = 1; p <= sans.length && isBookPly(sans, p); p++) {
      const o = openingAt(sans, p);
      if (o && o.exact) opening = o.name;
    }
  }

  return {
    counts,
    turning,
    plies,
    positions,
    startWin: winSeries[0],
    winSeries,
    accuracy: { w: gameAccuracy(accs.w, ws.w), b: gameAccuracy(accs.b, ws.b) },
    acpl: { w: avg(loss.w), b: avg(loss.b) },
    phases,
    opening,
    depth: Math.min(...analyses.filter((a) => a.depth).map((a) => a.depth), 99),
    engine: engineName(),
  };
}

// ---------- Live commentary for spectators ----------

// Keeps one position analysed ahead so each new move can be judged the
// moment it arrives. Call reset(fen, sans) when a position is loaded
// (sync / rematch) and moved(moveVerbose, sansSoFar) for each new move.
export function createLiveAnalyzer(onResult) {
  // `pending` is the (possibly still running) analysis of the position the NEXT
  // move will be played from. A move that arrives while it is still running
  // waits for it, rather than going uncommented while the engine warms up.
  let pending = Promise.resolve(null);
  let prevDrop = 0;
  let prevTo = null;
  let prevMoveObj = null;
  let token = 0;

  const analyzeAhead = (fen) => engine.analyze(fen, "live").catch(() => null);

  return {
    reset(fen) {
      token++;
      prevDrop = 0;
      prevTo = null;
      prevMoveObj = null;
      pending = analyzeAhead(fen);
    },
    async moved(move, sansSoFar, fenBefore, fenAfter, startFen) {
      const myToken = token;
      const beforeP = pending;
      pending = analyzeAhead(fenAfter);
      const [a, next] = await Promise.all([beforeP, pending]);
      if (myToken !== token || !a || !a.moves.length) return;
      const played = { from: move.from, to: move.to, promotion: move.promotion };
      if (!a.moves.some((x) => sameMove(x, played))) {
        a.moves = [...a.moves, { ...played, score: afterMoveScore(next, fenAfter) }];
      }
      const book = !startFen && isBookPly(sansSoFar, sansSoFar.length);
      const j = judgeMove({ a, played, fenBefore, san: move.san, book, prevOppDrop: prevDrop, prevTo });
      prevDrop = j.drop;
      prevTo = move.to;
      const op = !startFen ? openingAt(sansSoFar, sansSoFar.length) : null;
      const facts = moveFacts(fenBefore, played, { ply: sansSoFar.length, prevMove: prevMoveObj, sacrifice: j.cls === "brilliant" });
      prevMoveObj = move;
      onResult({
        cls: j.cls,
        san: move.san,
        opening: op && op.exact ? op.name : null,
        openingNote: op && op.exact ? op.note : null,
        openingKidNote: op && op.exact ? op.kidNote : null,
        facts,
        tactic: facts ? tacticOf(facts) : null,
        speech: spokenText({ san: move.san, cls: j.cls }),
      });
    },
    stop() {
      token++;
      pending = Promise.resolve(null);
    },
  };
}

export function stopAnalysis() {
  engine.stop && engine.stop();
}
