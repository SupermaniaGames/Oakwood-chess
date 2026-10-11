// A small opening book: enough to name the openings people actually meet
// and to tell "still in book" from "left the book". It is deliberately
// short — a lookup of move sequences, not an engine — and it matches by
// exact move order (so a transposition into a named opening won't be
// recognised).
//
// Keys are SAN move sequences without move numbers. `note` is the one-line
// explanation the coach says for the last move of that sequence.

import { Chess } from "./vendor/chess.js";

const OPENINGS = [
  // --- 1. e4 ---
  ["e4", "King's Pawn Opening", "Popular for versatility."],
  ["e4 e5", "Open Game", "Both sides fight for the center."],
  ["e4 e5 Nf3", "King's Knight Opening", "Develops a knight and attacks the e5 pawn."],
  ["e4 e5 Nf3 Nc6", "King's Knight Opening", "Defends the pawn and develops a knight."],
  ["e4 e5 Nf3 Nc6 Bc4", "Italian Game", "Aims the bishop at the weak f7 square."],
  ["e4 e5 Nf3 Nc6 Bc4 Bc5", "Giuoco Piano", "A classic, balanced reply."],
  ["e4 e5 Nf3 Nc6 Bc4 Nf6", "Two Knights Defense", "A sharp, active reply."],
  ["e4 e5 Nf3 Nc6 Bb5", "Ruy Lopez", "One of the oldest and most respected openings."],
  ["e4 e5 Nf3 Nc6 Bb5 a6", "Ruy Lopez, Morphy Defense", "Asks the bishop what it wants to do."],
  ["e4 e5 Nf3 Nc6 d4", "Scotch Game", "Opens the center right away."],
  ["e4 e5 Nf3 Nc6 d4 exd4", "Scotch Game", "Takes the pawn that challenged the center."],
  ["e4 e5 Nf3 Nf6", "Petrov's Defense", "Counterattacks instead of defending."],
  ["e4 e5 f4", "King's Gambit", "A bold pawn offer to open lines."],
  ["e4 e5 Nc3", "Vienna Game", "Keeps options open and prepares f4."],
  ["e4 c5", "Sicilian Defense", "The most popular fighting reply to 1. e4."],
  ["e4 c5 Nf3", "Sicilian Defense", "Prepares to open the center with d4."],
  ["e4 c5 Nf3 d6", "Sicilian Defense, ...d6 setup", "Keeps a solid pawn chain."],
  ["e4 c5 Nf3 Nc6", "Sicilian Defense, Classical", "Develops and eyes the d4 square."],
  ["e4 c5 Nf3 e6", "Sicilian Defense, Paulsen", "Flexible and solid."],
  ["e4 c5 Nf3 d6 d4", "Open Sicilian", "White opens the center."],
  ["e4 c5 Nf3 d6 d4 cxd4", "Open Sicilian", "Black trades a wing pawn for a center pawn."],
  ["e4 c5 Nc3", "Closed Sicilian", "A slower, positional plan."],
  ["e4 e6", "French Defense", "Solid, with a plan to hit the center next."],
  ["e4 e6 d4 d5", "French Defense", "Challenges the e4 pawn."],
  ["e4 c6", "Caro-Kann Defense", "Very solid; prepares d5."],
  ["e4 c6 d4 d5", "Caro-Kann Defense", "Challenges the center safely."],
  ["e4 d5", "Scandinavian Defense", "Attacks the e4 pawn immediately."],
  ["e4 d5 exd5 Qxd5", "Scandinavian Defense", "The queen comes out early."],
  ["e4 d6", "Pirc Defense", "Lets White build a center, then attacks it."],
  ["e4 Nf6", "Alekhine's Defense", "Invites White's pawns forward."],
  ["e4 g6", "Modern Defense", "The bishop will aim down the long diagonal."],

  // --- 1. d4 ---
  ["d4", "Queen's Pawn Opening", "Controls the center and opens the queen's bishop."],
  ["d4 d5", "Closed Game", "Both sides claim the center."],
  ["d4 d5 c4", "Queen's Gambit", "Offers a pawn to pull Black's center away."],
  ["d4 d5 c4 e6", "Queen's Gambit Declined", "Solid: Black keeps the center."],
  ["d4 d5 c4 dxc4", "Queen's Gambit Accepted", "Black takes the pawn, and must give it back."],
  ["d4 d5 c4 c6", "Slav Defense", "Supports d5 and keeps the bishop free."],
  ["d4 d5 Nf3", "Queen's Pawn Game", "Develops and watches the center."],
  ["d4 d5 Bf4", "London System", "A simple setup that is easy to learn."],
  ["d4 d5 Nf3 Nf6 Bf4", "London System", "A simple setup that is easy to learn."],
  ["d4 Nf6 Bf4", "London System", "A simple setup that is easy to learn."],
  ["d4 Nf6 Nf3 e6 Bf4", "London System", "Bishop out before the pawns close it in."],
  ["d4 Nf6", "Indian Defense", "Controls e4 with a knight instead of a pawn."],
  ["d4 Nf6 c4", "Indian Game", "Grabs more of the center."],
  ["d4 Nf6 c4 g6", "King's Indian Setup", "Black will fianchetto and strike later."],
  ["d4 Nf6 c4 e6", "Queen's Indian / Nimzo setup", "Flexible and solid."],
  ["d4 f5", "Dutch Defense", "Fights for the e4 square right away."],
  ["d4 f5 g3", "Dutch Defense", "White prepares a bishop on the long diagonal."],
  ["d4 f5 Nf3", "Dutch Defense", "A natural developing move."],

  // --- Flank openings ---
  ["c4", "English Opening", "A flexible way to fight for the center."],
  ["c4 e5", "English Opening, Reversed Sicilian", "Takes the center with a pawn."],
  ["Nf3", "Réti Opening", "Stays flexible; decides on pawns later."],
  ["Nf3 d5", "Réti Opening", "Black takes the center."],
  ["Nf3 d5 c4", "Réti Opening", "Hits the d5 pawn from the side."],
  ["Nf3 Nf6", "Réti Opening", "A symmetrical, flexible start."],
  ["f4", "Bird's Opening", "Controls e5 with the f-pawn."],
  ["b3", "Nimzo-Larsen Attack", "The bishop will watch the long diagonal."],
  ["g3", "King's Fianchetto Opening", "Prepares a bishop on g2."],
];

const NAMES = new Map(); // "e4 e5 Nf3" -> { name, note, length }
const PREFIXES = new Set(); // every prefix of every sequence (for "still in book")
for (const [seq, name, note] of OPENINGS) {
  const moves = seq.split(" ");
  NAMES.set(seq, { name, note, length: moves.length });
  for (let i = 1; i <= moves.length; i++) PREFIXES.add(moves.slice(0, i).join(" "));
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

// Accepts what people actually paste: an array of SAN or UCI moves, or a
// whole PGN / "1. e4 e5 2. Nf3" string / "e2e4 e7e5" string. Returns SAN
// moves. Unparseable or illegal input returns what was understood so far.
export function normalizeMoves(input, startFen) {
  let tokens;
  if (Array.isArray(input)) {
    tokens = input.map(String);
  } else {
    tokens = String(input || "")
      .replace(/\[[^\]]*\]/g, " ") // PGN tag pairs
      .replace(/\{[^}]*\}/g, " ") // comments
      .replace(/\([^)]*\)/g, " ") // variations
      .replace(/\$\d+/g, " ")
      .replace(/\d+\.(\.\.)?/g, " ") // move numbers
      .split(/\s+/)
      .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  }
  const game = startFen ? new Chess(startFen) : new Chess();
  const out = [];
  for (const t of tokens) {
    try {
      const m = UCI_RE.test(t)
        ? game.move({ from: t.slice(0, 2), to: t.slice(2, 4), promotion: t[4] })
        : game.move(t);
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

const key = (sans, n) => sans.slice(0, n).join(" ");

// The most specific opening name covering the first `ply` moves (or null).
export function openingAt(sans, ply = sans.length) {
  for (let n = Math.min(ply, sans.length); n >= 1; n--) {
    const hit = NAMES.get(key(sans, n));
    if (hit) return { name: hit.name, note: hit.note, length: hit.length, exact: n === ply };
  }
  return null;
}

// Is the sequence of the first `ply` moves still a known book line?
export function isBookPly(sans, ply) {
  return ply >= 1 && PREFIXES.has(key(sans, ply));
}

// Name an opening from a move list / UCI string / PGN string.
export function identifyOpening(input, startFen) {
  if (startFen) return null; // custom position: the book doesn't apply
  const sans = normalizeMoves(input);
  // Walk forward while moves stay in book; the deepest named point wins.
  let last = null;
  for (let p = 1; p <= sans.length && isBookPly(sans, p); p++) {
    const hit = NAMES.get(key(sans, p));
    if (hit) last = { name: hit.name, note: hit.note, plies: p };
  }
  return last;
}
