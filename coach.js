// The coach: works out what a move DOES (a fork? a pin? a developing move?)
// and says it the way a teacher would — the move's name, the idea behind it,
// and, for a mistake, what went wrong and what to look for next time.
//
// Everything is written in two voices:
//   "kids"   — short, concrete, friendly words
//   "adults" — the same ideas with the proper terms
// The wording is original; the tactic names (fork, pin, skewer, discovered
// attack, zwischenzug, desperado...) are the standard ones every chess teacher
// uses.
//
// Two halves:
//   moveFacts()   — looks at a position and a move and records facts about it
//   coachLines()  — turns recorded facts (+ the move's quality) into sentences
// Facts are plain data, so the analysis can store them and the screen can pick
// the voice later without re-analysing.

import { Chess } from "./vendor/chess.js";

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fileOf = (sq) => sq.charCodeAt(0) - 97;
const rankOf = (sq) => Number(sq[1]);
const sqAt = (f, r) => (f < 0 || f > 7 || r < 1 || r > 8 ? null : "abcdefgh"[f] + r);
const HOME = { w: { n: ["b1", "g1"], b: ["c1", "f1"] }, b: { n: ["b8", "g8"], b: ["c8", "f8"] } };

function piecesOf(g, color) {
  const out = [];
  for (const row of g.board()) for (const c of row) if (c && c.color === color) out.push(c);
  return out;
}
function kingSquare(g, color) {
  const k = piecesOf(g, color).find((p) => p.type === "k");
  return k ? k.square : null;
}

// ---------- facts ----------

// fenBefore: the position; mv: {from,to,promotion}; ctx: { ply, prevMove, prevOwn, sacrifice }
// (prevMove = the opponent's move just before; prevOwn = this side's previous move).
export function moveFacts(fenBefore, mv, ctx = {}) {
  const gb = new Chess(fenBefore);
  const g = new Chess(fenBefore);
  const mover = g.turn();
  const enemy = mover === "w" ? "b" : "w";
  let m;
  try {
    m = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  } catch {
    return null;
  }
  const ply = ctx.ply || 99;
  const f = {
    color: mover,
    piece: m.piece,
    from: m.from,
    to: m.to,
    san: m.san,
    captured: m.captured || null,
    promotion: m.promotion || null,
    castle: m.flags.includes("k") ? "k" : m.flags.includes("q") ? "q" : null,
    enPassant: m.flags.includes("e"),
    check: g.isCheck(),
    mate: g.isCheckmate(),
    stalemate: g.isStalemate(),
    ply,
  };

  const ek = kingSquare(g, enemy);
  const checkers = f.check && ek ? g.attackers(ek, mover) : [];
  f.doubleCheck = checkers.length >= 2;
  f.discoveredCheck = f.check && checkers.some((sq) => sq !== m.to);

  // ---- mates with names ----
  if (f.mate && ek) {
    const only = checkers[0];
    const ct = only ? g.get(only).type : null;
    const backRank = rankOf(ek) === (mover === "w" ? 8 : 1);
    if (ct && (ct === "r" || ct === "q") && backRank && rankOf(only) === rankOf(ek) && checkers.length === 1) f.backRankMate = true;
    if (m.piece === "n") {
      let boxed = true;
      for (const df of [-1, 0, 1]) {
        for (const dr of [-1, 0, 1]) {
          if (!df && !dr) continue;
          const sq = sqAt(fileOf(ek) + df, rankOf(ek) + dr);
          if (sq && !g.get(sq)) boxed = false;
          if (sq && g.get(sq) && g.get(sq).color === mover) boxed = false;
        }
      }
      if (boxed) f.smotheredMate = true;
    }
  }

  // ---- what the moved piece attacks now ----
  const enemyPieces = piecesOf(g, enemy);
  const targets = [];
  for (const e of enemyPieces) {
    if (e.square === m.to) continue;
    if (!g.attackers(e.square, mover).includes(m.to)) continue;
    const protectedBy = g.attackers(e.square, enemy).length > 0;
    if (VAL[e.type] > VAL[m.piece] || !protectedBy || e.type === "k") targets.push(e);
  }
  const worthy = targets.filter((t) => t.type !== "p" || g.attackers(t.square, enemy).length === 0);
  if (worthy.length >= 2) f.fork = worthy.map((t) => t.type);

  // ---- pins and skewers by a sliding piece ----
  if (["b", "r", "q"].includes(m.piece)) {
    const dirs = [];
    if (m.piece !== "b") dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    if (m.piece !== "r") dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    for (const [df, dr] of dirs) {
      let sq = sqAt(fileOf(m.to) + df, rankOf(m.to) + dr);
      const seen = [];
      while (sq && seen.length < 2) {
        const p = g.get(sq);
        if (p) {
          if (p.color !== enemy) break;
          seen.push({ type: p.type, square: sq });
        }
        sq = sqAt(fileOf(sq) + df, rankOf(sq) + dr);
      }
      if (seen.length === 2) {
        const [front, back] = seen;
        // A pin only counts when what's behind is the king or a rook/queen —
        // a pawn "pinned" to a minor piece can simply move.
        if (VAL[back.type] > VAL[front.type] && (back.type === "k" || VAL[back.type] >= 5)) {
          f.pin = [front.type, back.type];
          break;
        }
        // A skewer needs the piece behind to be really takeable: unprotected,
        // or worth at least as much as the attacker.
        const backGuarded = g.attackers(back.square, enemy).length > 0;
        if (VAL[front.type] > VAL[back.type] && VAL[front.type] >= 5 && (!backGuarded || VAL[back.type] >= VAL[m.piece])) {
          f.skewer = [front.type, back.type];
          break;
        }
      }
    }
  }

  // ---- discovered attacks: another piece's line opens up ----
  for (const e of enemyPieces) {
    if (VAL[e.type] < 3) continue;
    const after = g.attackers(e.square, mover).filter((sq) => sq !== m.to);
    const before = new Set(gb.attackers(e.square, mover));
    const fresh = after.filter((sq) => !before.has(sq) && ["b", "r", "q"].includes(g.get(sq).type));
    if (fresh.length) {
      f.discovered = { slider: g.get(fresh[0]).type, target: e.type };
      break;
    }
  }

  // ---- captures ----
  if (m.captured) {
    const defended = g.attackers(m.to, enemy).length > 0;
    const gain = VAL[m.captured] - (defended ? VAL[m.piece] : 0);
    if (gain >= 2) f.winsMaterial = { piece: m.captured, free: !defended };
    else if (defended && VAL[m.captured] === VAL[m.piece]) f.trade = true;
  }

  // ---- in-between moves and desperadoes ----
  const prev = ctx.prevMove;
  if (prev && prev.captured && m.to !== prev.to && gb.attackers(prev.to, mover).length > 0 && (f.check || m.captured)) {
    f.zwischenzug = true;
  }
  if (m.captured && VAL[m.piece] >= 3 && gb.attackers(m.from, enemy).length > 0 && gb.attackers(m.from, mover).length === 0) {
    f.desperado = true;
  }
  if (ctx.sacrifice) f.sacrifice = true;
  if (prev && prev.captured && prev.to === m.to && m.captured) f.recapture = true;

  // ---- what is left hanging afterwards ----
  const hangs = [];
  for (const p of piecesOf(g, mover)) {
    if (p.type === "k" || p.type === "p") continue;
    const att = g.attackers(p.square, enemy);
    if (!att.length) continue;
    const defended = g.attackers(p.square, mover).length > 0;
    const lowest = Math.min(...att.map((sq) => VAL[g.get(sq).type]));
    if (!defended || lowest < VAL[p.type]) hangs.push({ piece: p.type, square: p.square, free: !defended });
  }
  f.hangs = hangs.slice(0, 2);

  // ---- opening-principle facts (early moves only) ----
  if (ply <= 24) {
    const homes = (HOME[mover] && HOME[mover][m.piece]) || [];
    if (homes.includes(m.from) && !m.captured) f.develops = true;
    if (m.piece === "p" && ["d4", "e4", "d5", "e5"].includes(m.to)) f.centerPawn = true;
    if (m.piece === "q" && !m.captured && ply <= 10) f.earlyQueen = true;
    if (m.piece === "k" && !f.castle && ply <= 24) f.kingWalk = true;
    if (m.piece === "p" && !m.captured && ["a", "h"].includes(m.to[0]) && ply <= 14) f.edgePawn = true;
    const po = ctx.prevOwn;
    if (po && po.piece === m.piece && po.to === m.from && ["n", "b", "q"].includes(m.piece) && !m.captured && !f.check && ply <= 18) {
      f.repeatPiece = true;
    }
  }

  // ---- middlegame / endgame ideas ----
  if (m.piece === "p") {
    const ahead = mover === "w" ? 1 : -1;
    let passed = true;
    for (const df of [-1, 0, 1]) {
      for (let r = rankOf(m.to) + ahead; r >= 1 && r <= 8; r += ahead) {
        const sq = sqAt(fileOf(m.to) + df, r);
        const p = sq && g.get(sq);
        if (p && p.type === "p" && p.color === enemy) passed = false;
      }
    }
    if (passed && ply > 20) f.passedPawn = true;
  }
  if (m.piece === "r" && ply > 12) {
    const file = fileOf(m.to);
    let own = false;
    let any = false;
    for (let r = 1; r <= 8; r++) {
      const p = g.get(sqAt(file, r));
      if (p && p.type === "p") {
        any = true;
        if (p.color === mover) own = true;
      }
    }
    if (!any) f.openFile = "open";
    else if (!own) f.openFile = "half";
  }
  return f;
}

// ---------- phase ----------

export function phaseOf(ply, fenBefore) {
  if (ply <= 20) return "opening";
  const g = new Chess(fenBefore);
  let w = 0;
  let b = 0;
  for (const row of g.board()) for (const c of row) if (c && ["n", "b", "r", "q"].includes(c.type)) (c.color === "w" ? (w += VAL[c.type]) : (b += VAL[c.type]));
  return w <= 13 && b <= 13 ? "endgame" : "middlegame";
}

// ---------- words ----------

const pick = (kid, k, a) => (kid ? k : a);
// Several ways to say the same everyday idea, so a long game doesn't repeat itself word for word.
const vary = (list, seed) => list[Math.abs(seed || 0) % list.length];
const verb = { n: "jumps", p: "steps", b: "slides", r: "slides", q: "glides", k: "steps" };

// "The knight jumps to f3." / "The pawn takes the knight on e5."
function nameLine(f, kid) {
  const P = NAME[f.piece];
  if (f.castle) {
    return f.castle === "k"
      ? pick(kid, "You castle on the king's side.", "Castling kingside.")
      : pick(kid, "You castle on the queen's side.", "Castling queenside.");
  }
  if (f.enPassant) return pick(kid, "A pawn takes another pawn \"en passant\" — a special capture.", "A pawn captures en passant.");
  if (f.promotion) {
    const to = { q: "queen", r: "rook", b: "bishop", n: "knight" }[f.promotion];
    return pick(kid, `The pawn reaches the end of the board and becomes a ${to}!`, `The pawn promotes to a ${to}.`);
  }
  if (f.captured) return `The ${P} takes the ${NAME[f.captured]} on ${f.to}.`;
  return `The ${P} ${kid ? verb[f.piece] : "moves"} to ${f.to}.`;
}

// The idea behind a move, most interesting first. Returns the sentence or null.
function ideaLine(f, kid) {
  if (f.smotheredMate) return pick(kid, "Smothered mate! The king is hemmed in by his own pieces, and only a knight can finish it.", "A smothered mate: the king is boxed in by his own pieces and the knight delivers mate.");
  if (f.backRankMate) return pick(kid, "Back-rank mate! The king is trapped behind his own pawns.", "A back-rank mate: the king can't escape because his own pawns block the way.");
  if (f.mate) return pick(kid, "Checkmate! The king has nowhere to go.", "Checkmate — the king is attacked and has no escape.");
  if (f.doubleCheck) return pick(kid, "Double check! Two pieces attack the king at once, so the king has to run — nothing can block both.", "A double check: two pieces give check at once, so the king must move.");
  if (f.discoveredCheck) return pick(kid, "A discovered check! Moving this piece opens the line for another piece to attack the king.", "A discovered check: moving this piece unleashes another piece's check.");
  if (f.fork) {
    const list = f.fork.map((t) => NAME[t]);
    return pick(kid, `A fork! This ${NAME[f.piece]} attacks your opponent's ${list.join(" and ")} together, so only one can be saved.`, `A fork: the ${NAME[f.piece]} attacks the ${list.join(" and the ")} at once, and only one can be defended.`);
  }
  if (f.pin) return pick(kid, `A pin! The ${NAME[f.pin[0]]} can't move without exposing the ${NAME[f.pin[1]]} behind it.`, `A pin: the ${NAME[f.pin[0]]} is tied to the more valuable ${NAME[f.pin[1]]} behind it.`);
  if (f.skewer) return pick(kid, `A skewer! The ${NAME[f.skewer[0]]} has to run away, and then the ${NAME[f.skewer[1]]} behind it can be taken.`, `A skewer: the ${NAME[f.skewer[0]]} must move, exposing the ${NAME[f.skewer[1]]} behind it.`);
  if (f.discovered) return pick(kid, `A discovered attack! Moving this piece uncovers your ${NAME[f.discovered.slider]}, which now attacks their ${NAME[f.discovered.target]}.`, `A discovered attack: moving aside uncovers the ${NAME[f.discovered.slider]}'s attack on the ${NAME[f.discovered.target]}.`);
  if (f.zwischenzug) return pick(kid, "A zwischenzug — an in-between move! Instead of the obvious recapture, you slip in something stronger first.", "A zwischenzug (in-between move): a forcing move inserted before the expected recapture.");
  if (f.desperado) return pick(kid, "A desperado! This piece was going to be lost anyway, so it grabs something on the way out.", "A desperado: the piece was lost anyway, so it takes material before it goes.");
  if (f.sacrifice) return pick(kid, `You're giving up the ${NAME[f.piece]} on purpose — a sacrifice — to get something bigger.`, `A sacrifice: the ${NAME[f.piece]} is given up for a larger positional or tactical gain.`);
  if (f.promotion) return pick(kid, "A new queen is the biggest prize in chess!", "Promotion usually decides the game.");
  if (f.winsMaterial) {
    const w = NAME[f.winsMaterial.piece];
    return f.winsMaterial.free
      ? pick(kid, `That ${w} wasn't protected, so you win it for free!`, `The ${w} was undefended — a free piece.`)
      : pick(kid, `You win a ${w} and come out ahead in the trade.`, `You win the ${w} and come out ahead in the exchange.`);
  }
  if (f.recapture) return pick(kid, "You take the piece back — that's called a recapture.", "A recapture, restoring the material balance.");
  if (f.check) return pick(kid, "Check! The opponent has to deal with it right now.", "A check, which forces the reply.");
  if (f.trade) return pick(kid, "A fair swap: you take a piece and they take one back.", "An even trade of pieces.");
  if (f.castle) return pick(kid, "Your king hides behind its pawns and your rook joins the game.", "The king is safer and the rook is connected.");
  if (f.develops) {
    const P = NAME[f.piece];
    return pick(
      kid,
      vary([`Bringing the ${P} out early gets another piece into the game — that's an opening rule.`, `The ${P} leaves home so it can start helping. Pieces on their starting squares don't do much!`, `A new piece joins the fight. The more pieces you develop, the stronger you are.`], f.ply),
      vary([`Developing the ${P} follows the opening principle: get your pieces out quickly.`, `The ${P} is developed toward the center, where it influences more squares.`, `Another minor piece enters the game, which also brings castling closer.`], f.ply)
    );
  }
  if (f.centerPawn) return pick(kid, vary(["A pawn in the center takes space and gives your pieces room.", "Controlling the middle squares makes it easier for your pieces to move.", "The center is the most important part of the board, and this pawn fights for it."], f.ply), vary(["A central pawn claims space and opens lines for the pieces.", "It stakes a claim in the center and restricts the opponent's pieces.", "Central control is the first strategic goal of the opening."], f.ply));
  if (f.passedPawn) return pick(kid, "This pawn has no enemy pawns in its way — a passed pawn, and a danger to promote.", "It creates a passed pawn: no enemy pawn can stop it by capture.");
  if (f.openFile === "open") return pick(kid, "The rook takes a file with no pawns on it — an open file where it can be strong.", "The rook seizes an open file.");
  if (f.openFile === "half") return pick(kid, "The rook goes to a file with no pawns of its own in the way, and it can pressure the enemy pawn.", "The rook occupies a half-open file to pressure the enemy pawn.");
  return null;
}

// What to say when the move was weak: the thing that went wrong.
function problemLine(p, kid) {
  const f = p.facts;
  const r = p.replyFacts;
  if (p.kid && p.kid.tag === "Missed Checkmate") return pick(kid, "There was a checkmate available! Always look at every check first.", "A forced mate was available — look at all the checks before anything else.");
  if (p.kid && p.kid.tag === "Walked into Checkmate") return pick(kid, "That lets your opponent checkmate you! Before you move, check what they can do with their checks and captures.", "It allows a forced checkmate. Before moving, list the opponent's checks, captures and threats.");
  if (r) {
    if (r.mate) return pick(kid, "Now your opponent has a checkmate. Look for their checks before every move!", "It allows mate. Always scan the opponent's checks first.");
    if (r.fork) {
      const list = r.fork.map((t) => NAME[t]);
      return pick(kid, `It lets their ${NAME[r.piece]} fork your ${list.join(" and ")} — they attack both at once.`, `It allows a fork: their ${NAME[r.piece]} will attack your ${list.join(" and ")} together.`);
    }
    if (r.pin) return pick(kid, `It lets them pin your ${NAME[r.pin[0]]} to your ${NAME[r.pin[1]]}, so it can't move.`, `It allows a pin of your ${NAME[r.pin[0]]} against the ${NAME[r.pin[1]]}.`);
    if (r.skewer) return pick(kid, `It lets them skewer your ${NAME[r.skewer[0]]} — when it moves, the ${NAME[r.skewer[1]]} behind it is lost.`, `It allows a skewer on your ${NAME[r.skewer[0]]} and the ${NAME[r.skewer[1]]} behind it.`);
    if (r.captured && r.to === f.to) return pick(kid, `Your ${NAME[f.piece]} on ${f.to} can simply be captured.`, `The ${NAME[f.piece]} on ${f.to} can be captured.`);
    if (r.winsMaterial) {
      const w = NAME[r.winsMaterial.piece];
      return r.winsMaterial.free
        ? pick(kid, `You leave your ${w} on ${r.to} with no protection — they can take it for free.`, `It leaves the ${w} undefended, and it can be taken for free.`)
        : pick(kid, `They can win your ${w} in a trade.`, `It allows the opponent to win the ${w} in an exchange.`);
    }
    if (r.discovered || r.discoveredCheck) return pick(kid, "It allows a discovered attack, where one of their pieces steps aside to uncover another.", "It allows a discovered attack.");
  }
  if (f.hangs && f.hangs.length) {
    const h = f.hangs[0];
    return pick(kid, `Your ${NAME[h.piece]} on ${h.square} is ${h.free ? "left without protection" : "in danger"}. Always check that your pieces are protected.`, `It leaves the ${NAME[h.piece]} on ${h.square} ${h.free ? "undefended" : "under-protected"}.`);
  }
  if (f.repeatPiece) return pick(kid, "Moving the same piece again in the opening wastes time. Bring out a new piece instead!", "Moving the same piece twice in the opening loses time — develop another piece.");
  if (f.earlyQueen) return pick(kid, "Bringing the queen out this early lets your opponent attack it and gain time.", "An early queen sortie gives the opponent free developing moves by attacking it.");
  if (f.kingWalk) return pick(kid, "Moving the king out loses your castling and can leave it in danger.", "Walking the king forward gives up castling and exposes it.");
  if (f.edgePawn) return pick(kid, "A pawn on the edge doesn't help much. Pawns in the middle are more useful.", "A rim pawn move does little for the center or development at this stage.");
  if (p.missed && p.missed.mate) return pick(kid, "There was a checkmate available!", "A forced mate was on the board.");
  return null;
}

// The better move, with a reason when we can give one.
function betterLine(p, kid) {
  if (!p.bestSan) return null;
  const b = p.bestFacts;
  const why = b ? ideaLine({ ...b, sacrifice: false, desperado: false }, kid) : null;
  return why ? `${p.bestSan} was better. ${why}` : `${p.bestSan} was better.`;
}
const lowerFirst = (s) => s.replace(/^(A |An )/, (m) => m.toLowerCase()).replace(/^([A-Z])(?![A-Z])/, (m) => m.toLowerCase());

// General reason a good move is good, when it has no named tactic.
function generalReason(p, kid) {
  const f = p.facts;
  const ph = p.phase;
  if (ph === "opening") {
    if (f.piece === "p") return pick(kid, vary(["In the opening, pawns that fight for the center are a great start.", "This pawn helps your pieces by giving them room to come out."], f.ply), vary(["A sound pawn move that serves the center.", "A useful pawn move that supports your development."], f.ply));
    return pick(kid, vary(["In the opening, it's good to bring your pieces toward the middle where they have more power.", "The piece goes to a more active square, where it can do more."], f.ply), vary(["It improves piece activity — a key goal in the opening.", "A natural move that increases the piece's influence on the center."], f.ply));
  }
  if (ph === "endgame") {
    if (f.piece === "k") return pick(kid, "In the endgame the king becomes a fighter. Bring it toward the action!", "In the endgame the king is an active piece — centralising it is correct.");
    return pick(kid, "With fewer pieces left, every move should have a purpose, and this one does.", "A purposeful endgame move that improves your position.");
  }
  return pick(kid, vary(["It makes your pieces work together better without giving anything away.", "A calm, sensible move: nothing is left hanging and your pieces cooperate.", "It keeps your position safe and your plans going."], f.ply), vary(["It improves the coordination of your pieces without creating weaknesses.", "A solid, flexible move that keeps your options open.", "It strengthens your position and leaves no targets."], f.ply));
}

// Lines of the coach's speech for one move. Returns { title, lines[], tag }.
export function coachLines(p, style = "kids") {
  const kid = style !== "adults";
  const f = p.facts;
  const out = { title: p.title, lines: [], tag: p.kid ? p.kid.tag : null };
  if (!f) {
    out.lines = p.detail ? [p.detail] : [];
    return out;
  }
  const cls = p.cls;
  const name = nameLine(f, kid);
  const idea = ideaLine(f, kid);

  if (cls === "book") {
    out.title = pick(kid, `${p.san} is a book move`, `${p.san} is a book move`);
    const note = p.opening ? (kid ? p.openingKid || p.openingNote : p.openingNote) : null;
    out.lines.push(name);
    if (p.opening) out.lines.push(`${p.opening}: ${note || "a well-known opening line"}`);
    else if (note) out.lines.push(note);
    if (idea && !p.openingNote) out.lines.push(idea);
    return out;
  }

  if (cls === "brilliant") {
    out.lines.push(name);
    out.lines.push(pick(kid, "Brilliant! You gave up material on purpose, and it pays off.", "Brilliant: a sacrifice that the position justifies."));
    if (idea && !f.sacrifice) out.lines.push(idea);
    return out;
  }

  if (cls === "great") {
    out.lines.push(name);
    out.lines.push(idea && !f.sacrifice ? idea : pick(kid, "A hard move to find: it was the only way to keep control of the game.", "The only move that keeps the position under control."));
    return out;
  }

  if (cls === "best" || cls === "excellent" || cls === "good") {
    out.lines.push(name);
    out.lines.push(idea || generalReason(p, kid));
    return out;
  }

  // inaccuracy, mistake, miss, blunder
  out.lines.push(name);
  let prob = problemLine(p, kid);
  if (cls === "miss") {
    const b = p.bestFacts;
    const opp = pick(kid, "Your opponent slipped up, but this doesn't take advantage.", "The opponent erred, but this doesn't exploit it.");
    out.lines.push(prob || opp);
    const better = betterLine(p, kid);
    if (better) out.lines.push(better);
    return out;
  }
  if (!prob) {
    prob = cls === "blunder"
      ? pick(kid, "That gives your opponent a big advantage.", "It hands the opponent a decisive advantage.")
      : pick(kid, "There was a stronger move that keeps more of your advantage.", "A stronger option was available.");
  }
  out.lines.push(prob);
  const better = betterLine(p, kid);
  if (better) out.lines.push(better);
  return out;
}

// What the voice says: the headline plus the first idea.
export function coachSpeech(p, style = "kids", spokenTitle) {
  const c = coachLines(p, style);
  const second = c.lines[1] || c.lines[0] || "";
  const head = String(spokenTitle || c.title).replace(/[.!?\s]+$/, "");
  return `${head}. ${second}`.replace(/\s+/g, " ").trim();
}

// ---------- the whole game ----------

// A few warm, concrete sentences for the summary screen. `perspective` is the
// colour the reader played ("w"/"b"), or null when it was both sides.
export function summaryLines(data, style = "kids", perspective = null) {
  const kid = style !== "adults";
  const lines = [];
  const side = (c) => (c === "w" ? "White" : "Black");
  const you = perspective;
  const acc = data.accuracy;

  if (data.opening) lines.push(pick(kid, `The game began as the ${data.opening}.`, `Opening: the ${data.opening}.`));

  if (you && acc[you] != null) {
    const mine = acc[you];
    const theirs = acc[you === "w" ? "b" : "w"];
    lines.push(
      mine >= 85
        ? pick(kid, "You played really accurately — great work!", "A very accurate game from you.")
        : mine >= 65
        ? pick(kid, "A solid game with a few things to improve.", "A decent game with some inaccuracies to learn from.")
        : pick(kid, "This one was tricky. Let's find what to practise.", "A difficult game — the review will show where to improve.")
    );
    if (theirs != null && mine < theirs - 10) lines.push(pick(kid, "Your opponent was more accurate this time.", "Your opponent played more accurately."));
  } else if (acc.w != null && acc.b != null) {
    const diff = acc.w - acc.b;
    lines.push(
      Math.abs(diff) < 6
        ? pick(kid, "Both players played about equally well.", "Evenly matched accuracy on both sides.")
        : pick(kid, `${side(diff > 0 ? "w" : "b")} played more accurately.`, `${side(diff > 0 ? "w" : "b")} was the more accurate side.`)
    );
  }

  if (data.turning) {
    const t = data.turning;
    const num = Math.ceil(t.ply / 2);
    const what = t.kid ? lowerFirst(t.kid.text.replace(/\.$/, "")) : null;
    lines.push(
      pick(kid, `The big turning point was move ${num}${t.color === "w" ? "" : "…"} (${t.san}) — a ${t.cls}.`, `The decisive moment came at move ${num}${t.color === "w" ? "" : "…"} (${t.san}), a ${t.cls}.`)
    );
    if (what && /hanging|fork|pin|checkmate|skewer/i.test(t.kid.tag)) lines.push(`${cap(what)}.`);
  } else {
    lines.push(pick(kid, "There were no big mistakes. Nice clean chess!", "No decisive errors — a clean game."));
  }

  // One learning tip, based on what actually went wrong most often.
  const tips = tipFor(data, perspective, kid);
  if (tips) lines.push(tips);
  return lines;
}

function tipFor(data, you, kid) {
  const plies = data.plies.filter((p) => ["inaccuracy", "mistake", "miss", "blunder"].includes(p.cls) && (!you || p.color === you));
  if (!plies.length) return null;
  const tags = {};
  for (const p of plies) if (p.kid) tags[p.kid.tag] = (tags[p.kid.tag] || 0) + 1;
  const top = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const t = top[0];
    if (/Hanging/.test(t)) return pick(kid, "Tip: before every move, ask “is anything of mine unprotected?”", "Tip: before each move, check every piece is defended.");
    if (/Fork/.test(t)) return pick(kid, "Tip: watch out for forks — knights love to attack two things at once.", "Tip: look for knight and pawn forks before you move.");
    if (/Pin/.test(t)) return pick(kid, "Tip: keep your king and queen off the same line as enemy bishops and rooks.", "Tip: avoid placing valuable pieces on a line behind another piece an enemy slider can attack.");
    if (/Checkmate/.test(t)) return pick(kid, "Tip: always look at every check before you move.", "Tip: scan all checks, captures and threats — in that order.");
  }
  const early = plies.filter((p) => p.facts && (p.facts.repeatPiece || p.facts.earlyQueen || p.facts.kingWalk || p.facts.edgePawn));
  if (early.length) return pick(kid, "Tip: in the opening, bring out new pieces, fight for the center and castle.", "Tip: stick to the opening principles — develop, claim the center, castle.");
  return pick(kid, "Tip: slow down and ask what your opponent is threatening each move.", "Tip: before each move, ask what the opponent's last move threatens.");
}

// The most notable named idea in a move, for a short live comment:
// { name: "Fork", sentence: (style) => "..." } or null.
export function tacticOf(f) {
  const order = [
    ["smotheredMate", "Smothered mate"],
    ["backRankMate", "Back-rank mate"],
    ["mate", "Checkmate"],
    ["doubleCheck", "Double check"],
    ["discoveredCheck", "Discovered check"],
    ["fork", "Fork"],
    ["pin", "Pin"],
    ["skewer", "Skewer"],
    ["discovered", "Discovered attack"],
    ["zwischenzug", "In-between move"],
    ["desperado", "Desperado"],
    ["sacrifice", "Sacrifice"],
  ];
  for (const [key, name] of order) {
    if (f[key]) return { name, sentence: (style) => ideaLine(f, style !== "adults") };
  }
  return null;
}

// A whole-move sentence for live commentary: "The knight jumps to f3." + the idea.
export function liveSentence(f, style) {
  const kid = style !== "adults";
  return [nameLine(f, kid), ideaLine(f, kid)].filter(Boolean).join(" ");
}
