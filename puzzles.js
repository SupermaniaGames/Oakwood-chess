// Three small puzzle games that share the main board:
//   - Pawn Race: kings and pawns only; first to promote a pawn to a queen wins.
//   - Knight's Tour: one knight, visit every square exactly once.
//   - Checkmate puzzles: "mate in 1" and "mate in 2".
// Like review.js, this hands main.js a "hook" that renderBoard draws from.

import { Chess } from "./vendor/chess.js";
import { MATE_PUZZLES } from "./puzzle-data.js";

const $ = (id) => document.getElementById(id);
const PAWN_RACE_FEN = "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1";
const sqName = (file, rank) => "abcdefgh"[file] + (rank + 1);
const sqFile = (s) => s.charCodeAt(0) - 97;
const sqRank = (s) => Number(s[1]) - 1;

export function createPuzzles({ rerender, onLeave }) {
  let mode = null; // "pawnrace" | "knight" | "mate"
  let game = new Chess();
  let selected = null;
  let targets = [];
  let lastMove = null;
  let over = false;
  let busy = false; // computer is "thinking" / a wrong answer is being undone
  let flipped = false;
  let timers = [];

  // pawn race
  let opponent = "computer"; // or "two"
  // knight's tour
  let path = []; // squares in visiting order
  // mate puzzles
  let filter = "all";
  let pool = [];
  let puzzle = null;
  let stage = 0; // for mate in 2: 0 = first move expected, 1 = second
  let solverColor = "w";
  let order = [];

  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers = timers.filter((x) => x !== t);
      fn();
    }, ms);
    timers.push(t);
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  function setStatus(text, kind = "") {
    const s = $("pz-status");
    s.textContent = text;
    s.dataset.kind = kind;
  }

  // ---------- board hook (see renderBoard in main.js) ----------

  const hook = {
    get game() {
      return game;
    },
    get flipped() {
      return flipped;
    },
    cssFlip: false,
    get noCheck() {
      return mode === "knight";
    },
    cells() {
      if (mode !== "knight") return null;
      const rows = [];
      const cur = path[path.length - 1];
      for (let rank = 7; rank >= 0; rank--) {
        const row = [];
        for (let file = 0; file < 8; file++) {
          row.push(sqName(file, rank) === cur ? { color: "w", type: "n", square: sqName(file, rank) } : null);
        }
        rows.push(row);
      }
      return rows;
    },
    classes(square) {
      const out = [];
      if (mode === "knight") {
        if (path.includes(square) && square !== path[path.length - 1]) out.push("tour-visited");
        if (targets.includes(square)) out.push("legal");
        return out;
      }
      if (selected === square) out.push("selected");
      const t = targets.find((m) => m.to === square);
      if (t) {
        out.push("legal");
        if (t.captured) out.push("capture");
      }
      if (lastMove && (lastMove.from === square || lastMove.to === square)) out.push("last-move");
      return out;
    },
    label(square) {
      if (mode !== "knight") return null;
      const i = path.indexOf(square);
      return i >= 0 && i < path.length - 1 ? String(i + 1) : null;
    },
    badge: () => null,
    onSquare(square) {
      if (over || busy) return;
      if (mode === "knight") return knightClick(square);
      return chessClick(square);
    },
  };

  // ---------- shared click handling for the Chess-based puzzles ----------

  function chessClick(square) {
    const piece = game.get(square);
    if (selected) {
      const mv = targets.find((m) => m.to === square);
      if (mv) return playMove(mv);
    }
    if (piece && piece.color === game.turn() && canControl(piece.color)) {
      selected = square;
      targets = game.moves({ square, verbose: true });
    } else {
      selected = null;
      targets = [];
    }
    rerender();
  }

  const canControl = (color) => {
    if (mode === "pawnrace") return opponent === "two" || color === "w";
    if (mode === "mate") return color === solverColor;
    return false;
  };

  function playMove(mv) {
    selected = null;
    targets = [];
    const promotion = mv.promotion ? "q" : undefined; // always a queen here
    const made = game.move({ from: mv.from, to: mv.to, promotion });
    lastMove = { from: made.from, to: made.to };
    if (mode === "pawnrace") afterPawnRaceMove(made);
    else afterMateMove(made);
    rerender();
  }

  // ---------- Pawn Race ----------

  function startPawnRace() {
    clearTimers();
    mode = "pawnrace";
    game = new Chess(PAWN_RACE_FEN);
    selected = null;
    targets = [];
    lastMove = null;
    over = false;
    busy = false;
    flipped = false;
    $("pz-title").textContent = "Pawn Race";
    $("pz-hint").textContent = "Only kings and pawns. The first player to turn a pawn into a queen wins!";
    buildOptions([
      { label: "vs Computer", on: () => ((opponent = "computer"), startPawnRace()), active: opponent === "computer" },
      { label: "2 players", on: () => ((opponent = "two"), startPawnRace()), active: opponent === "two" },
    ]);
    showButtons({ restart: true });
    setStatus(opponent === "two" ? "White to move." : "Your move — you are White.");
    rerender();
  }

  function afterPawnRaceMove(made) {
    const who = made.color === "w" ? "White" : "Black";
    if (made.promotion) {
      over = true;
      const mine = opponent === "computer" ? made.color === "w" : null;
      setStatus(mine === true ? "You made a queen first — you win! 🎉" : mine === false ? "The computer made a queen first." : `${who} made a queen first — ${who} wins! 🎉`, mine === false ? "lose" : "win");
      return;
    }
    if (game.isCheckmate()) {
      over = true;
      setStatus(opponent === "computer" ? (made.color === "w" ? "Checkmate — you win! 🎉" : "Checkmate — the computer wins.") : `Checkmate — ${who} wins! 🎉`, "win");
      return;
    }
    if (game.isGameOver()) {
      over = true;
      setStatus("It's a draw — nobody can make a queen.", "draw");
      return;
    }
    const turn = game.turn() === "w" ? "White" : "Black";
    if (opponent === "computer") {
      if (game.turn() === "b") {
        busy = true;
        setStatus("The computer is thinking…");
        later(computerMove, 450);
      } else {
        setStatus(game.inCheck() ? "Check! Your move." : "Your move.");
      }
    } else {
      setStatus(`${turn} to move.${game.inCheck() ? " Check!" : ""}`);
    }
  }

  function computerMove() {
    busy = false;
    if (over || mode !== "pawnrace") return;
    const mv = pawnRaceAi(game);
    if (!mv) return;
    const made = game.move({ from: mv.from, to: mv.to, promotion: mv.promotion ? "q" : undefined });
    lastMove = { from: made.from, to: made.to };
    afterPawnRaceMove(made);
    rerender();
  }

  // Tiny alpha-beta over pawn moves. Promotion is worth more than anything;
  // otherwise it prefers being closer to a queen than the other side, with a
  // little randomness so games differ.
  function pawnRaceAi(g) {
    const dist = (color) => {
      let best = 9;
      for (const row of g.board()) {
        for (const c of row) {
          if (c && c.type === "p" && c.color === color) {
            const rank = sqRank(c.square);
            best = Math.min(best, color === "w" ? 7 - rank : rank);
          }
        }
      }
      return best;
    };
    const pawns = (color) => g.board().flat().filter((c) => c && c.type === "p" && c.color === color).length;
    const evalFor = (color) => (dist(color === "w" ? "b" : "w") - dist(color)) * 100 + (pawns(color) - pawns(color === "w" ? "b" : "w")) * 30;
    const search = (depth, alpha, beta, color) => {
      // returns score for `color` (the side to move)
      const moves = g.moves({ verbose: true });
      if (g.isCheckmate()) return -9000 - depth;
      if (moves.length === 0 || g.isDraw()) return 0;
      if (depth === 0) return evalFor(color);
      let best = -Infinity;
      for (const m of moves) {
        let s;
        if (m.promotion) {
          s = 10000 + depth;
        } else {
          g.move(m);
          s = -search(depth - 1, -beta, -alpha, color === "w" ? "b" : "w");
          g.undo();
        }
        if (s > best) best = s;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    };
    const color = g.turn();
    const scored = [];
    for (const m of g.moves({ verbose: true })) {
      let s;
      if (m.promotion) s = 50000; // winning right now beats any win found deeper in the search
      else {
        g.move(m);
        s = -search(2, -Infinity, Infinity, color === "w" ? "b" : "w");
        g.undo();
      }
      scored.push({ m, s: s + Math.random() * 20 });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.length ? scored[0].m : null;
  }

  // ---------- Knight's Tour ----------

  function knightTargets(from) {
    const f = sqFile(from);
    const r = sqRank(from);
    const out = [];
    for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const s = sqName(nf, nr);
      if (!path.includes(s)) out.push(s);
    }
    return out;
  }

  function startKnight() {
    clearTimers();
    mode = "knight";
    path = [];
    targets = [];
    selected = null;
    lastMove = null;
    over = false;
    busy = false;
    flipped = false;
    game = new Chess(); // only used so the board has something to read
    $("pz-title").textContent = "Knight's Tour";
    $("pz-hint").textContent = "Move the knight like a knight. Visit every square once — never the same square twice!";
    buildOptions([]);
    showButtons({ restart: true, undo: true });
    setStatus("Tap any square to place your knight.");
    rerender();
  }

  function knightClick(square) {
    if (path.length === 0) {
      path = [square];
    } else if (targets.includes(square)) {
      path.push(square);
    } else {
      return;
    }
    targets = knightTargets(path[path.length - 1]);
    if (path.length === 64) {
      over = true;
      targets = [];
      setStatus("You visited all 64 squares — amazing! 🎉", "win");
    } else if (targets.length === 0) {
      setStatus(`Stuck after ${path.length} squares. Press Undo to step back, or Restart.`, "lose");
    } else {
      setStatus(`${path.length} of 64 squares visited.`);
    }
    rerender();
  }

  function knightUndo() {
    if (mode !== "knight" || path.length === 0) return;
    over = false;
    path.pop();
    targets = path.length ? knightTargets(path[path.length - 1]) : [];
    setStatus(path.length ? `${path.length} of 64 squares visited.` : "Tap any square to place your knight.");
    rerender();
  }

  // ---------- Checkmate puzzles ----------

  function matesIn1(g) {
    return g.moves({ verbose: true }).filter((m) => {
      g.move(m);
      const mate = g.isCheckmate();
      g.undo();
      return mate;
    });
  }

  // Does the move just played force mate next move, whatever Black replies?
  function forcesMate(g) {
    if (g.isGameOver()) return false;
    const replies = g.moves({ verbose: true });
    if (replies.length === 0) return false;
    for (const r of replies) {
      g.move(r);
      const ok = matesIn1(g).length > 0;
      g.undo();
      if (!ok) return false;
    }
    return true;
  }

  function startMate(f) {
    clearTimers();
    mode = "mate";
    if (f) filter = f;
    pool = MATE_PUZZLES.filter((p) => filter === "all" || p.mate === Number(filter));
    order = pool.map((_, i) => i).sort(() => Math.random() - 0.5);
    $("pz-title").textContent = "Checkmate Puzzles";
    buildOptions([
      { label: "Mate in 1", on: () => startMate("1"), active: filter === "1" },
      { label: "Mate in 2", on: () => startMate("2"), active: filter === "2" },
      { label: "All", on: () => startMate("all"), active: filter === "all" },
    ]);
    nextMate();
  }

  function nextMate() {
    clearTimers();
    if (pool.length === 0) {
      setStatus("No puzzles in this group yet.");
      return;
    }
    const i = order.shift();
    order.push(i); // cycle: the list repeats once every puzzle has been shown
    puzzle = pool[i];
    loadMate();
  }

  function loadMate() {
    game = new Chess(puzzle.fen);
    solverColor = game.turn();
    flipped = solverColor === "b";
    stage = 0;
    selected = null;
    targets = [];
    lastMove = null;
    over = false;
    busy = false;
    $("pz-hint").textContent = `${solverColor === "w" ? "White" : "Black"} to move — checkmate in ${puzzle.mate}.`;
    showButtons({ restart: true, next: true });
    setStatus("Find the checkmate!");
    rerender();
  }

  function wrong(msg, undoCount) {
    busy = true;
    setStatus(msg, "lose");
    later(() => {
      for (let i = 0; i < undoCount; i++) game.undo();
      lastMove = null;
      busy = false;
      setStatus("Try again!");
      rerender();
    }, 900);
  }

  function afterMateMove(made) {
    if (puzzle.mate === 1) {
      if (game.isCheckmate()) {
        over = true;
        setStatus("Checkmate! Well done! 🎉", "win");
      } else {
        wrong("That's not checkmate.", 1);
      }
      return;
    }
    // mate in 2
    if (stage === 0) {
      // A move from the stored list is right; anything else is checked by
      // brute force so a valid alternative key move is never rejected.
      const ok = puzzle.first.includes(made.san) || forcesMate(game);
      if (!ok) return wrong("That doesn't force checkmate.", 1);
      busy = true;
      setStatus("Good move! The other side replies…");
      later(() => {
        const replies = game.moves({ verbose: true });
        const reply = replies[Math.floor(Math.random() * replies.length)];
        const r = game.move(reply);
        lastMove = { from: r.from, to: r.to };
        stage = 1;
        busy = false;
        setStatus("Now deliver checkmate!");
        rerender();
      }, 600);
    } else if (game.isCheckmate()) {
      over = true;
      setStatus("Checkmate in 2! Brilliant! 🎉", "win");
    } else {
      wrong("That's not checkmate.", 1);
    }
  }

  // ---------- UI plumbing ----------

  function buildOptions(opts) {
    const box = $("pz-options");
    box.innerHTML = "";
    box.classList.toggle("hidden", opts.length === 0);
    for (const o of opts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (o.active ? " active" : "");
      b.textContent = o.label;
      b.onclick = o.on;
      box.appendChild(b);
    }
  }

  function showButtons({ restart = false, undo = false, next = false }) {
    $("pz-restart").classList.toggle("hidden", !restart);
    $("pz-undo").classList.toggle("hidden", !undo);
    $("pz-next").classList.toggle("hidden", !next);
  }

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $("pz-restart").onclick = () => {
      if (mode === "pawnrace") startPawnRace();
      else if (mode === "knight") startKnight();
      else if (mode === "mate") loadMate();
    };
    $("pz-undo").onclick = knightUndo;
    $("pz-next").onclick = () => mode === "mate" && nextMate();
    $("pz-back").onclick = () => {
      clearTimers();
      onLeave();
    };
  }

  return {
    hook,
    start(kind) {
      wire();
      if (kind === "pawnrace") startPawnRace();
      else if (kind === "knight") startKnight();
      else startMate();
    },
    stop() {
      clearTimers();
      mode = null;
    },
    // Test hooks.
    _state: () => ({ mode, over, path: [...path], fen: game.fen(), puzzle, stage, targets }),
    _game: () => game,
  };
}
