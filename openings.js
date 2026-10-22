// A small opening book: enough to name the openings people actually meet
// and to tell "still in book" from "left the book". It is deliberately
// short — a lookup of move sequences, not an engine — and it matches by
// exact move order (so a transposition into a named opening won't be
// recognised).
//
// Keys are SAN move sequences without move numbers. `note` is the one-line
// explanation the coach says for the last move of that sequence.

import { Chess } from "./vendor/chess.js";

// [moves, name, note, kidNote?]
//   note    — one line about the idea, written for anyone
//   kidNote — the same idea in simpler words (falls back to `note`)
const OPENINGS = [
  // --- 1. e4 ---
  ["e4", "King's Pawn Opening", "Takes space in the center and opens lines for the queen and the king's bishop.", "A big first step: the pawn grabs the center and lets your bishop and queen out."],
  ["e4 e5", "Open Game", "Both sides claim the center, and the game opens up quickly.", "Both players take the center. Pieces will have lots of room to move."],
  ["e4 e5 Nf3", "King's Knight Opening", "Develops a knight and attacks the e5 pawn at the same time.", "The knight comes out and attacks the pawn on e5."],
  ["e4 e5 Nf3 Nc6", "King's Knight Opening", "Black defends the pawn and develops with one move.", "Black protects the pawn and brings out a knight too."],
  ["e4 e5 Nf3 Nc6 Bc4", "Italian Game", "The bishop eyes f7, the weakest square near Black's king, and White gets ready to castle.", "The bishop looks at f7, a weak spot next to Black's king."],
  ["e4 e5 Nf3 Nc6 Bc4 Bc5", "Giuoco Piano", "A calm, classic setup: both bishops aim at the enemy king's side.", "Both bishops point at each other's kings. A calm, classic setup."],
  ["e4 e5 Nf3 Nc6 Bc4 Bc5 b4", "Evans Gambit", "White offers a pawn to gain time and a big center.", "White gives a pawn away to get quick, active pieces."],
  ["e4 e5 Nf3 Nc6 Bc4 Nf6", "Two Knights Defense", "Black counterattacks at once instead of defending passively.", "Black attacks right away instead of just defending."],
  ["e4 e5 Nf3 Nc6 Bb5", "Ruy Lopez", "One of the oldest openings: White pressures the knight that guards e5.", "The bishop pins down the knight that helps protect e5."],
  ["e4 e5 Nf3 Nc6 Bb5 a6", "Ruy Lopez, Morphy Defense", "Black asks the bishop what it wants to do.", "Black asks the bishop: will you take the knight or retreat?"],
  ["e4 e5 Nf3 Nc6 Bb5 Nf6", "Ruy Lopez, Berlin Defense", "A solid reply that leads to quiet, technical games, often into the endgame.", "A very solid reply that's hard to break down."],
  ["e4 e5 Nf3 Nc6 d4", "Scotch Game", "White opens the center straight away.", "White opens the middle of the board right now."],
  ["e4 e5 Nf3 Nc6 d4 exd4", "Scotch Game", "Black takes the pawn, and White will recapture with a lead in activity.", "Black takes a pawn, but White will win it back with active pieces."],
  ["e4 e5 Nf3 Nf6", "Petrov's Defense", "Black counterattacks the e4 pawn instead of defending e5.", "Black attacks White's pawn instead of defending its own."],
  ["e4 e5 Nf3 d6", "Philidor Defense", "Solid but a little passive: Black protects e5 with a pawn.", "Black protects the e5 pawn with a pawn. Solid, but a bit cramped."],
  ["e4 e5 f4", "King's Gambit", "A bold pawn offer to open the f-file and attack fast.", "White gives a pawn to attack quickly. Exciting but risky!"],
  ["e4 e5 Nc3", "Vienna Game", "Develops a knight and keeps the option of f4 later.", "A flexible knight move that prepares to attack with the f-pawn."],
  ["e4 e5 Bc4", "Bishop's Opening", "The bishop comes out first and eyes f7.", "The bishop jumps out first and looks at f7."],
  ["e4 e5 Qh5", "Wayward Queen Attack", "An early queen sortie that threatens a quick mate, but it can be chased away.", "The queen comes out very early to threaten, but it can get chased away."],
  ["e4 c5", "Sicilian Defense", "The most popular fighting reply to 1.e4: Black fights for d4 and unbalances the game.", "Black doesn't copy White. This leads to sharp, exciting games."],
  ["e4 c5 c3", "Alapin Sicilian", "White prepares d4 to build a strong pawn center.", "White prepares to push d4 and take the center."],
  ["e4 c5 Nf3", "Sicilian Defense", "White develops and prepares to open the center with d4.", "A knight comes out, and White gets ready for d4."],
  ["e4 c5 Nf3 d6", "Sicilian Defense, ...d6 setup", "Black builds a solid pawn chain and keeps options open.", "Black builds a solid wall of pawns."],
  ["e4 c5 Nf3 d6 Bb5+", "Sicilian, Canal Attack", "An early check to disturb Black's development.", "White checks the king right away to bother Black."],
  ["e4 c5 Nf3 d6 d4", "Open Sicilian", "White opens the center and trades a wing pawn for a center pawn.", "White opens the center."],
  ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "Sicilian, Najdorf Variation", "One of the sharpest, most studied lines in chess; ...a6 stops White's pieces coming to b5.", "A famous sharp line. The little pawn move stops White's knight and bishop from using b5."],
  ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6", "Sicilian, Dragon Variation", "Black's bishop will rule the long diagonal like a dragon.", "Black's bishop will guard the long diagonal."],
  ["e4 c5 Nf3 Nc6", "Sicilian Defense, Classical", "Develops and eyes the d4 square.", "Black develops and watches the d4 square."],
  ["e4 c5 Nf3 e6", "Sicilian Defense, Paulsen", "Flexible and solid; Black keeps many setups available.", "A flexible, solid choice."],
  ["e4 c5 Nc3", "Closed Sicilian", "A slower plan: White builds up and attacks on the kingside.", "A slower plan where White builds up first."],
  ["e4 e6", "French Defense", "Solid, with a plan to challenge the center with ...d5 next.", "Black builds a solid base and will challenge the center with ...d5."],
  ["e4 e6 d4 d5", "French Defense", "Black challenges the e4 pawn at once.", "Black strikes at the center pawn."],
  ["e4 e6 d4 d5 e5", "French, Advance Variation", "White gains space and locks the center.", "White pushes forward and gets lots of space."],
  ["e4 e6 d4 d5 Nd2", "French, Tarrasch Variation", "White keeps the pawn on e4 protected and avoids doubled pawns.", "A careful knight move that protects the e4 pawn."],
  ["e4 e6 d4 d5 Nc3 Bb4", "French, Winawer Variation", "Black pins the knight and fights hard for the e4 square.", "Black pins White's knight to start a fight."],
  ["e4 e6 d4 d5 exd5 exd5", "French, Exchange Variation", "The pawns are traded and the position is symmetrical and quiet.", "The center pawns are traded, so the game becomes calm and even."],
  ["e4 c6", "Caro-Kann Defense", "Very solid: Black prepares ...d5 with a safe pawn structure.", "A very safe setup that gets ready for ...d5."],
  ["e4 c6 d4 d5", "Caro-Kann Defense", "Black challenges the center while keeping the bishop free.", "Black challenges the center in a safe way."],
  ["e4 c6 d4 d5 e5", "Caro-Kann, Advance Variation", "White gains space; Black will attack the pawn chain.", "White grabs space, and Black plans to attack the pawn chain."],
  ["e4 c6 d4 d5 Nc3 dxe4 Nxe4", "Caro-Kann, Classical Variation", "Pawns are traded and Black plans to bring the bishop out.", "A trade of pawns, then Black's bishop comes out happily."],
  ["e4 d5", "Scandinavian Defense", "Black attacks e4 immediately; the queen often comes out early.", "Black attacks the center pawn on move one."],
  ["e4 d5 exd5 Qxd5", "Scandinavian Defense", "The queen is developed early, so White gains time by attacking it.", "Black's queen comes out early, so White can chase it."],
  ["e4 d6", "Pirc Defense", "Black lets White build a center, then attacks it.", "Black lets White take the center, then attacks it later."],
  ["e4 d6 d4 Nf6 Nc3 g6", "Pirc Defense", "Black will fianchetto the bishop and strike at the center later.", "The bishop will go to g7 and aim down the long diagonal."],
  ["e4 Nf6", "Alekhine's Defense", "Black invites White's pawns forward, hoping to attack them.", "Black tempts White's pawns to run forward so they can be attacked."],
  ["e4 Nf6 e5 Nd5", "Alekhine's Defense", "The knight is chased, but White's advanced pawns may become targets.", "White chases the knight, but those pawns might become weak."],
  ["e4 g6", "Modern Defense", "The bishop will aim down the long diagonal.", "Black will place the bishop on g7 to watch the long diagonal."],

  // --- 1. d4 ---
  ["d4", "Queen's Pawn Opening", "Controls the center and frees the queen's bishop.", "A solid start: the pawn takes the center and protects itself with the queen."],
  ["d4 d5", "Closed Game", "Both sides claim the center with a pawn.", "Both players take a center square."],
  ["d4 d5 c4", "Queen's Gambit", "White offers a pawn to pull Black's d-pawn away from the center.", "White seems to give a pawn, but really wants to win the center."],
  ["d4 d5 c4 e6", "Queen's Gambit Declined", "Solid: Black keeps the center and declines the pawn.", "Black says no thanks to the pawn and stays solid."],
  ["d4 d5 c4 dxc4", "Queen's Gambit Accepted", "Black takes the pawn but must give it back to avoid trouble.", "Black takes the pawn, but will have to give it back."],
  ["d4 d5 c4 c6", "Slav Defense", "Supports d5 and keeps the light-squared bishop free.", "Black protects d5 and keeps the bishop out of jail."],
  ["d4 d5 c4 c6 Nf3 Nf6 Nc3 e6", "Semi-Slav Defense", "A very solid, complex setup with a strong center for Black.", "A tricky, solid setup for Black."],
  ["d4 d5 Nf3", "Queen's Pawn Game", "Develops a knight and watches the center.", "A knight comes out and watches the middle."],
  ["d4 d5 Bf4", "London System", "A simple, reliable setup that's easy to learn: bishop out before the pawns close it in.", "An easy setup: get the bishop out first, then build."],
  ["d4 d5 Nf3 Nf6 Bf4", "London System", "A simple, reliable setup that's easy to learn.", "An easy setup: bishop out, pawns behind it."],
  ["d4 Nf6 Bf4", "London System", "A flexible version of the London System.", "The bishop comes out early before the pawns block it."],
  ["d4 Nf6 Nf3 e6 Bf4", "London System", "The bishop develops before the pawn chain closes it in.", "Bishop out before it gets locked in."],
  ["d4 Nf6", "Indian Defense", "Controls e4 with a knight instead of a pawn.", "Black controls the center with a piece, not a pawn."],
  ["d4 Nf6 c4", "Indian Game", "White takes even more of the center.", "White grabs more space."],
  ["d4 Nf6 c4 g6", "King's Indian Setup", "Black will fianchetto and strike at White's center later.", "Black lets White build a big center, then attacks it."],
  ["d4 Nf6 c4 g6 Nc3 Bg7 e4 d6", "King's Indian Defense", "A fighting defense where Black counterattacks White's big center.", "A fighting setup: Black attacks the big White center."],
  ["d4 Nf6 c4 g6 Nc3 d5", "Grünfeld Defense", "Black allows a big center, then attacks it with pieces and ...d5.", "Black hits the center right away with a pawn push."],
  ["d4 Nf6 c4 e6", "Queen's Indian / Nimzo setup", "Flexible and solid.", "A flexible, solid choice."],
  ["d4 Nf6 c4 e6 g3", "Catalan Opening", "The bishop on g2 puts long-term pressure on the queenside.", "White's bishop will watch the long diagonal."],
  ["d4 Nf6 c4 e6 Nc3 Bb4", "Nimzo-Indian Defense", "Black pins the knight and fights for e4.", "Black pins White's knight to control e4."],
  ["d4 Nf6 c4 e6 Nf3 b6", "Queen's Indian Defense", "Black's bishop will control the long diagonal.", "The bishop will go to b7 and look across the board."],
  ["d4 Nf6 c4 e6 Nf3 Bb4+", "Bogo-Indian Defense", "Black checks first and develops with tempo.", "Black checks the king early."],
  ["d4 Nf6 c4 c5 d5 b5", "Benko Gambit", "Black sacrifices a pawn for lasting pressure on the queenside.", "Black gives a pawn away to attack on the side of the board."],
  ["d4 Nf6 Bg5", "Trompowsky Attack", "White pins or harasses the knight and avoids heavy theory.", "The bishop jumps out to bother Black's knight."],
  ["d4 d5 Nf3 Nf6 e3", "Colle System", "A solid setup with pawns on d4 and e3 and a plan for e4.", "A simple setup with a plan to push e4 later."],
  ["d4 f5", "Dutch Defense", "Fights for the e4 square right away, with an attacking spirit.", "Black takes the e4 square right away."],
  ["d4 f5 g3", "Dutch Defense", "White prepares a bishop on the long diagonal.", "White's bishop will go to g2."],
  ["d4 f5 Nf3", "Dutch Defense", "A natural developing move.", "A knight comes out."],

  // --- Flank openings ---
  ["c4", "English Opening", "A flexible way to fight for the center from the side.", "White watches the center from the side."],
  ["c4 e5", "English Opening, Reversed Sicilian", "Black takes the center with a pawn.", "Black takes the center right away."],
  ["Nf3", "Réti Opening", "Stays flexible; White decides on the pawn structure later.", "A knight comes out and White waits to see what Black does."],
  ["Nf3 d5", "Réti Opening", "Black takes the center, and White will challenge it from the flanks.", "Black takes the center; White will attack it from the side."],
  ["Nf3 d5 c4", "Réti Opening", "Hits the d5 pawn from the side.", "White attacks the center pawn from the side."],
  ["Nf3 Nf6", "Réti Opening", "A symmetrical, flexible start.", "Both sides copy each other."],
  ["Nf3 d5 g3", "King's Indian Attack", "A flexible setup with the bishop on g2 and a quick castle.", "White builds a safe setup around the bishop on g2."],
  ["f4", "Bird's Opening", "Controls e5 with the f-pawn.", "White's pawn watches e5."],
  ["b3", "Nimzowitsch-Larsen Attack", "The bishop will watch the long diagonal.", "The bishop will look down the long diagonal."],
  ["g3", "King's Fianchetto Opening", "Prepares a bishop on g2.", "The bishop will go to g2."],
  ["b4", "Polish Opening", "A flank pawn move that grabs space on the queenside.", "A side pawn grabs space."],
  ["g4", "Grob Opening", "An unusual and aggressive wing pawn push.", "A surprising pawn push on the edge."],
];

const NAMES = new Map(); // "e4 e5 Nf3" -> { name, note, length }
const PREFIXES = new Set(); // every prefix of every sequence (for "still in book")
for (const [seq, name, note, kidNote] of OPENINGS) {
  const moves = seq.split(" ");
  NAMES.set(seq, { name, note, kidNote: kidNote || note, length: moves.length });
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
    if (hit) return { name: hit.name, note: hit.note, kidNote: hit.kidNote, length: hit.length, exact: n === ply };
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
    if (hit) last = { name: hit.name, note: hit.note, kidNote: hit.kidNote, plies: p };
  }
  return last;
}

// The whole dictionary, for the Learn tab: [{ moves: "e4 e5 Nf3", name, note, kidNote }].
export function allOpenings() {
  return OPENINGS.map(([moves, name, note, kidNote]) => ({ moves, name, note, kidNote: kidNote || note }));
}

// Where an opening's name comes from — the "story" the coach tells when a game
// goes into it. Only names with a well-documented origin are listed. Matched
// against the opening name (first match wins).
const ORIGINS = [
  [/Sicilian/, "named after the Italian island of Sicily — Italian players studied this reply to 1.e4 more than 400 years ago."],
  [/Italian Game|Giuoco Piano/, "named after Italy, where players of the 1500s and 1600s loved it. \"Giuoco Piano\" is Italian for \"quiet game\"."],
  [/Ruy Lopez/, "named after Ruy López, a Spanish priest who wrote about it in 1561. It's also called the Spanish Game."],
  [/French Defense/, "named after a famous 1834 match between London and Paris, where the Paris players used it."],
  [/Caro-Kann/, "named after two players, Horatio Caro and Marcus Kann, who studied it in the 1880s."],
  [/Scandinavian/, "named after the Scandinavian players who explored it. It's also called the Center Counter."],
  [/Pirc/, "named after the Slovenian grandmaster Vasja Pirc, who played it in the 1930s and 40s."],
  [/Alekhine/, "named after Alexander Alekhine, the world champion who made it famous in the 1920s."],
  [/Scotch/, "named after a 1824 correspondence match between the Edinburgh and London chess clubs."],
  [/Vienna/, "named after Vienna, where it was popular with 19th-century players."],
  [/Petrov/, "named after Alexander Petrov, a Russian master who analysed it in the 1820s."],
  [/Philidor/, "named after François-André Danican Philidor, the 18th-century French master (and composer) who championed it."],
  [/Evans Gambit/, "named after Captain William Evans, a Welsh sailor who invented it around 1827."],
  [/King's Gambit/, "one of the oldest openings. \"Gambit\" comes from an Italian wrestling word meaning \"to trip someone up\"."],
  [/Queen's Gambit/, "a \"gambit\" means offering a pawn on purpose — here the queen's-side c-pawn. It's the most famous opening of the 1900s."],
  [/London System/, "named after the London 1922 tournament, where players used this setup a lot."],
  [/Dutch/, "named after the Netherlands — a Dutch player, Elias Stein, analysed it in 1789."],
  [/English Opening/, "named after Howard Staunton, an English master who played 1.c4 in the 1840s."],
  [/Réti/, "named after Richard Réti, a Czech-Hungarian master who made it popular in the 1920s."],
  [/Catalan/, "named after Catalonia, the region of Spain, after a tournament in Barcelona in 1929."],
  [/Grünfeld/, "named after the Austrian grandmaster Ernst Grünfeld, who first played it in 1922."],
  [/Nimzo-Indian/, "named after Aron Nimzowitsch, the Latvian grandmaster who invented the idea."],
  [/Bogo-Indian/, "named after Efim Bogoljubov, the grandmaster who played it often."],
  [/Najdorf/, "named after Miguel Najdorf, a Polish-Argentine grandmaster who played it all his life."],
  [/Dragon/, "named because Black's pawns and bishop look like the dragon constellation, Draco."],
  [/Alapin/, "named after the Russian master Semyon Alapin, who analysed it in the 1890s."],
  [/Winawer/, "named after Szymon Winawer, a Polish master who played it in the 1800s."],
  [/Tarrasch/, "named after Siegbert Tarrasch, a German master who loved this line."],
  [/Berlin Defense/, "named after the Berlin school of players who analysed it in the 1800s."],
  [/Trompowsky/, "named after Octávio Trompowsky, a Brazilian player who used it in the 1930s."],
  [/Benko/, "named after Pál Benko, a Hungarian-American grandmaster who made it famous."],
  [/Colle/, "named after Edgard Colle, a Belgian master who played it in the 1920s."],
  [/Bird's Opening/, "named after Henry Bird, an English master who played 1.f4 in the 1800s."],
  [/Grob/, "named after Henri Grob, a Swiss player who loved this unusual move."],
  [/Slav/, "named after the Slavic masters, such as Czech players, who analysed it."],
  [/Modern Defense/, "called \"modern\" because it follows the ideas of 20th-century hypermodern players, who let the opponent build a center and attack it later."],
  [/Wayward Queen/, "named because the queen \"wanders\" out into the open very early."],
  [/Bishop's Opening/, "named after the bishop, which comes out first instead of the knight."],
  [/King's Indian/, "one of the \"Indian\" defences, where Black's pieces fight for the center from the sides rather than with pawns."],
];

// The story behind an opening's name, or null when we don't have a reliable one.
export function openingOrigin(name) {
  if (!name) return null;
  for (const [re, text] of ORIGINS) if (re.test(name)) return text;
  return null;
}
