// The post-match Game Review, in two phases like chess.com's:
//   1. Summary: the coach, the evaluation graph, accuracy, and how many moves
//      of each quality each side played. "Start Review" begins phase 2.
//   2. Steps: the coach's bubble above the board, a quality badge on the move's
//      square, a best-move arrow for mistakes, the move strip, and a bottom bar
//      (Back / Best / Flip / Voice / Next).
// main.js owns the board element; this module hands it a "hook" describing
// what to draw (see renderBoard in main.js).

import { Chess } from "./vendor/chess.js";
import { analyzeGame, analyzeThreat, winPercent, engineProblem, CLASS_INFO, CLASS_ORDER, stopAnalysis } from "./analysis.js";
import { getAnalysisSettings, saveAnalysisSettings } from "./storage.js";
import { coachLines, coachSpeech, summaryLines } from "./coach.js";
import { initCoach, setMood, moodForClass } from "./coach-avatar.js";
import { MATE_THRESHOLD } from "./bot.js";
import { speak, stopSpeaking, isVoiceEnabled, setVoiceEnabled, voiceSupported, listVoices, getVoiceName, setVoiceName } from "./voice.js";

const $ = (id) => document.getElementById(id);
const NOTABLE = new Set(["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"]);
const ERRORS = new Set(["inaccuracy", "mistake", "miss", "blunder"]);

export function createReview({ rerender, onClose }) {
  let data = null; // result of analyzeGame
  let index = 0; // 0 = start position, i = after ply i
  let phase = "summary"; // "summary" | "steps"
  let cssFlip = false;
  let showBest = false; // the Best button: draw the best-move arrow for any move
  let cancel = null;
  let board = new Chess();
  let active = false;
  let wired = false;
  let settings = getAnalysisSettings();
  const threats = new Map(); // fen -> {from,to} | null, filled in lazily
  let retry = null; // { game, selected, targets, ply, solved } while the player retries a move
  const jumpCursor = {}; // per move-quality: which one the summary row jumped to last
  let perspective = null; // the colour the reader played, or null when it was both sides

  const fenAt = (i) => (i === 0 ? data.plies[0].fenBefore : data.plies[i - 1].fenAfter);
  const cur = () => (data && index > 0 ? data.plies[index - 1] : null);

  // Arrows on the board, in drawing order:
  //   green  — the better move, shown after a mistake (the move feedback)
  //   blue   — the engine's suggestion for the side to move (if enabled)
  //   red    — the threat: what the other side would do if it could move (if enabled)
  function arrows() {
    const p = cur();
    if (phase !== "steps" || !data || retry) return [];
    const out = [];
    if (p && settings.moveFeedback && (ERRORS.has(p.cls) || showBest) && !(p.bestFrom === p.from && p.bestTo === p.to)) {
      out.push({ from: p.bestFrom, to: p.bestTo, color: "rgba(129,182,76,0.85)" });
    }
    const pos = data.positions[index];
    if (settings.suggestionArrows && pos && pos.best && !(out[0] && out[0].from === pos.best.from && out[0].to === pos.best.to)) {
      out.push({ from: pos.best.from, to: pos.best.to, color: "rgba(72,140,210,0.85)" });
    }
    const t = pos ? threats.get(pos.fen) : null;
    if (settings.threatArrows && t) out.push({ from: t.from, to: t.to, color: "rgba(205,70,60,0.85)" });
    return out;
  }

  const hook = {
    get game() {
      return retry ? retry.game : board;
    },
    get cssFlip() {
      return cssFlip;
    },
    classes(square) {
      if (retry) {
        const out = [];
        if (retry.selected === square) out.push("selected");
        const t = retry.targets.find((m) => m.to === square);
        if (t) out.push("legal", ...(t.captured ? ["capture"] : []));
        return out;
      }
      const p = cur();
      return p && (square === p.from || square === p.to) ? ["last-move"] : [];
    },
    badge(square) {
      const p = cur();
      if (retry || !p || square !== p.to || phase !== "steps" || !settings.moveFeedback) return null;
      const info = CLASS_INFO[p.cls];
      return { mark: info.mark, color: info.color, label: info.label };
    },
    arrows,
    get onSquare() {
      return retry && !retry.solved ? retrySquare : undefined;
    },
  };

  function evalLabel(cp, digits = 2) {
    if (Math.abs(cp) >= MATE_THRESHOLD) return `${cp > 0 ? "" : "-"}#${100000 - Math.abs(cp)}`;
    const v = cp / 100;
    return (v >= 0 ? "+" : "") + v.toFixed(digits);
  }

  function setPhase(p) {
    phase = p;
    document.body.dataset.reviewPhase = p;
    $("review-summary").classList.toggle("hidden", p !== "summary");
    $("review-steps").classList.toggle("hidden", p !== "steps");
  }

  // ----- summary phase -----
  // The coach's opening remarks: a few warm sentences about the whole game.
  function renderSummaryBubble() {
    const box = $("summary-bubble");
    box.innerHTML = "";
    for (const line of summaryLines(data, settings.coachStyle, perspective)) {
      const p = document.createElement("span");
      p.className = "coach-line";
      p.textContent = line;
      box.appendChild(p);
    }
    const hint = document.createElement("span");
    hint.className = "coach-line coach-hint";
    hint.textContent = "Tap Start Review and I'll walk you through the moves.";
    box.appendChild(hint);
  }

  function summaryMood() {
    const a = perspective ? data.accuracy[perspective] : Math.max(data.accuracy.w || 0, data.accuracy.b || 0);
    return a != null && a >= 85 ? "happy" : "neutral";
  }

  function renderSummary() {
    renderSummaryBubble();
    setMood(summaryMood());
    $("acc-w").textContent = data.accuracy.w == null ? "–" : data.accuracy.w.toFixed(1);
    $("acc-b").textContent = data.accuracy.b == null ? "–" : data.accuracy.b.toFixed(1);
    const rows = $("review-table");
    rows.innerHTML = "";
    for (const key of CLASS_ORDER) {
      const info = CLASS_INFO[key];
      const row = document.createElement("div");
      row.className = "rv-row";
      row.dataset.cls = key;
      row.innerHTML =
        '<span class="rv-name"></span><b class="rv-count"></b><span class="rv-dot"></span><b class="rv-count"></b>';
      const [name, cw, dot, cb] = row.children;
      name.textContent = info.label;
      name.style.color = info.color;
      cw.textContent = data.counts.w[key];
      cw.style.color = info.color;
      dot.style.background = info.color;
      dot.textContent = info.mark;
      cb.textContent = data.counts.b[key];
      cb.style.color = info.color;
      // Tap a row to jump to those moves one after another ("learn from your mistakes").
      const hits = data.plies.filter((p) => p.cls === key);
      if (hits.length) {
        row.classList.add("clickable");
        row.title = `Go to ${info.label.toLowerCase()} moves`;
        row.onclick = () => {
          jumpCursor[key] = ((jumpCursor[key] ?? -1) + 1) % hits.length;
          startSteps(hits[jumpCursor[key]].ply);
        };
      } else row.classList.add("zero");
      rows.appendChild(row);
    }
    renderExtra();
    const note = $("review-engine-note");
    if (data.engine === "Stockfish 16") {
      note.textContent = `Analysed with Stockfish 16${data.depth && data.depth < 99 ? ` (depth ${data.depth}+)` : ""}.`;
    } else {
      // Say so plainly: the built-in engine only looks a few moves ahead, so verdicts are rougher.
      const why = engineProblem();
      note.textContent = `⚠ Analysed with the built-in engine, which is much weaker than Stockfish, so some verdicts may be wrong. Stockfish couldn't start${why ? ` (${why})` : ""}. Check that the folder vendor/stockfish/ on your site has both stockfish-nnue-16-single.js and stockfish-nnue-16-single.wasm.`;
    }
  }

  // Average centipawn loss and accuracy by phase of the game.
  function renderExtra() {
    const box = $("review-extra");
    box.innerHTML = "";
    const row = (label, w, b, sub) => {
      const r = document.createElement("div");
      r.className = "rv-grid";
      r.innerHTML = '<span class="rv-label"></span><div class="rv-num"></div><span></span><div class="rv-num"></div>';
      r.children[0].textContent = label;
      if (sub) r.children[0].className = "rv-label rv-sub";
      r.children[1].textContent = w == null ? "–" : w;
      r.children[3].textContent = b == null ? "–" : b;
      box.appendChild(r);
    };
    row("Avg. centipawn loss", data.acpl.w, data.acpl.b);
    const names = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
    for (const k of ["opening", "middlegame", "endgame"]) {
      const ph = data.phases[k];
      if (ph.w == null && ph.b == null) continue;
      row(`${names[k]} accuracy`, ph.w == null ? null : ph.w.toFixed(1), ph.b == null ? null : ph.b.toFixed(1), true);
    }
  }

  function drawGraph() {
    const canvas = $("review-graph");
    if (!data || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = data.winSeries.length - 1;
    const xAt = (i) => (n === 0 ? 0 : (i / n) * W);
    const yAt = (win) => H - (win / 100) * H;

    ctx.fillStyle = "#4b4847";
    ctx.fillRect(0, 0, W, H);
    // A smooth curve through the evaluation after every move (Catmull-Rom
    // turned into Bezier segments; the control points are kept inside the
    // graph so the curve never overshoots the top or bottom).
    const pts = data.winSeries.map((w, i) => [xAt(i), yAt(w)]);
    const clampY = (y) => Math.max(0, Math.min(H, y));
    const curve = () => {
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        ctx.bezierCurveTo(
          p1[0] + (p2[0] - p0[0]) / 6,
          clampY(p1[1] + (p2[1] - p0[1]) / 6),
          p2[0] - (p3[0] - p1[0]) / 6,
          clampY(p2[1] - (p3[1] - p1[1]) / 6),
          p2[0],
          p2[1]
        );
      }
    };
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(pts[0][0], pts[0][1]);
    curve();
    ctx.lineTo(xAt(n), H);
    ctx.closePath();
    ctx.fillStyle = "#f1f1ee";
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(120,120,115,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    if (index > 0 && phase === "steps") {
      ctx.strokeStyle = "#f2c84b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xAt(index), 0);
      ctx.lineTo(xAt(index), H);
      ctx.stroke();
    }
    data.plies.forEach((p, k) => {
      const i = k + 1;
      if (!NOTABLE.has(p.cls) && p.cls !== "book" && i !== index) return; // keep the graph readable
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(data.winSeries[i]), i === index ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = CLASS_INFO[p.cls].color;
      ctx.fill();
      if (i === index) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    });
  }

  // ----- steps phase -----
  function pieceIcon(color, type) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 40 40");
    svg.setAttribute("class", "mv-icon");
    const use = document.createElementNS(ns, "use");
    use.setAttribute("href", `#${color}${type}`);
    svg.appendChild(use);
    return svg;
  }

  function renderStrip() {
    const list = $("review-move-list");
    list.innerHTML = "";
    const moves = data.plies;
    const mk = (p) => {
      const span = document.createElement("span");
      span.className = "mv" + (p.ply === index ? " current" : "");
      span.dataset.ply = String(p.ply);
      if (!p.san.startsWith("O-O") && !/^[a-h]/.test(p.san)) {
        span.appendChild(pieceIcon(p.color, p.san[0].toLowerCase()));
        span.appendChild(document.createTextNode(p.san.slice(1)));
      } else {
        span.textContent = p.san;
      }
      if (ERRORS.has(p.cls) || p.cls === "brilliant" || p.cls === "great") span.style.color = CLASS_INFO[p.cls].color;
      span.onclick = () => goTo(p.ply, { say: true });
      return span;
    };
    for (let i = 0; i < moves.length; i += 2) {
      const li = document.createElement("li");
      const num = document.createElement("b");
      num.textContent = `${i / 2 + 1}.`;
      li.append(num, " ", mk(moves[i]));
      if (moves[i + 1]) li.appendChild(mk(moves[i + 1]));
      list.appendChild(li);
    }
    const c = list.querySelector(".mv.current");
    if (c) {
      list.scrollLeft = c.offsetLeft - list.clientWidth / 2 + c.offsetWidth / 2;
      list.scrollTop = c.offsetTop - list.clientHeight / 2 + c.offsetHeight / 2;
    } else {
      list.scrollLeft = 0;
      list.scrollTop = 0;
    }
  }

  function setCoachLines(lines) {
    const box = $("coach-detail");
    box.innerHTML = "";
    for (const line of lines) {
      const span = document.createElement("span");
      span.className = "coach-line";
      span.textContent = line;
      box.appendChild(span);
    }
  }

  function renderCoach() {
    const p = cur();
    const badge = $("coach-badge");
    if (!p) {
      badge.style.display = "none";
      $("coach-title").textContent = "Start position";
      $("coach-eval").textContent = "0.00";
      setCoachLines([data.opening ? `We'll go through the game together. It started as the ${data.opening}.` : "We'll go through the game together."]);
      return;
    }
    const info = CLASS_INFO[p.cls];
    $("coach-eval").textContent = evalLabel(p.evalWhite);
    if (!settings.moveFeedback) {
      // Feedback off: just say which move this is, no verdict.
      badge.style.display = "none";
      $("coach-title").textContent = `${Math.ceil(p.ply / 2)}${p.color === "w" ? "." : "..."} ${p.san}`;
      setCoachLines(["Move feedback is turned off in the analysis options."]);
      return;
    }
    const c = coachLines(p, settings.coachStyle);
    badge.style.display = "";
    badge.style.background = info.color;
    badge.textContent = info.mark;
    $("coach-title").textContent = c.title;
    setCoachLines(c.lines);
  }

  // The evaluation bar beside the board — Game Review only.
  function updateEvalBar() {
    const bar = $("eval-bar");
    const show = active && phase === "steps" && !!data && settings.evalBar;
    bar.classList.toggle("hidden", !show);
    const root = document.documentElement.style;
    if (!show) {
      root.removeProperty("--evalbar-w");
      return;
    }
    root.setProperty("--evalbar-w", "24px"); // bar + gap: the board gives up this much width
    const cp = data.positions[index].evalWhite;
    const white = winPercent(cp);
    bar.classList.toggle("flipped", cssFlip); // black at the bottom -> white's share grows from the top
    $("eval-bar-fill").style.height = `${white}%`;
    const label = $("eval-bar-score");
    label.textContent = evalLabel(Math.abs(cp), 1).replace("+", "");
    // The number sits at the end of the side that is ahead.
    const whiteAhead = cp >= 0;
    const atBottom = whiteAhead !== cssFlip;
    label.className = "eval-bar-score " + (atBottom ? "at-bottom" : "at-top");
    if (whiteAhead !== atBottom) label.style.color = "";
    label.style.color = whiteAhead ? "#262522" : "#f1f1ee";
  }

  // The engine's top lines for the position on the board (lichess-style).
  function renderLines() {
    const box = $("review-lines");
    const pos = data && data.positions[index];
    const show = settings.engineLines && phase === "steps" && pos && pos.lines.length > 0;
    box.classList.toggle("hidden", !show);
    if (!show) return;
    box.innerHTML = "";
    const parts = pos.fen.split(" ");
    let number = Number(parts[5]) || 1;
    for (const line of pos.lines) {
      const row = document.createElement("div");
      row.className = "eng-line";
      const sc = document.createElement("span");
      sc.className = "eng-score " + (line.score >= 0 ? "w" : "b");
      sc.textContent = evalLabel(line.score, 2);
      const mv = document.createElement("span");
      mv.className = "eng-moves";
      let n = number;
      let whiteToMove = parts[1] === "w";
      mv.textContent = line.san
        .map((san, i) => {
          const out = whiteToMove ? `${n}. ${san}` : i === 0 ? `${n}... ${san}` : san;
          if (!whiteToMove) n++;
          whiteToMove = !whiteToMove;
          return out;
        })
        .join(" ");
      row.append(sc, mv);
      box.appendChild(row);
    }
  }

  // Red "threat" arrow: searched on demand for the position being viewed.
  function requestThreat() {
    if (!settings.threatArrows || phase !== "steps" || !data) return;
    const fen = data.positions[index].fen;
    if (threats.has(fen)) return;
    threats.set(fen, null);
    analyzeThreat(fen).then((t) => {
      if (!t) return;
      threats.set(fen, t);
      if (active && data && data.positions[index].fen === fen) rerender();
    });
  }

  function refresh({ say = false } = {}) {
    if (!data) return;
    board = new Chess(fenAt(index));
    if (phase === "steps") {
      if (retry) exitRetry(false);
      renderCoach();
      renderStrip();
      renderLines();
      requestThreat();
      const cp = cur();
      $("btn-review-retry").disabled = !(cp && ERRORS.has(cp.cls));
      $("btn-review-prev").disabled = index <= 0;
      $("btn-review-next").disabled = index >= data.plies.length;
      $("btn-mv-rprev").disabled = index <= 0;
      $("btn-mv-rnext").disabled = index >= data.plies.length;
      $("btn-review-best").classList.toggle("on", showBest);
    }
    drawGraph();
    updateEvalBar();
    rerender();
    if (index > 0) setMood(moodForClass(data.plies[index - 1].cls));
    else setMood("neutral");
    if (say && index > 0) sayAloud(speechFor(data.plies[index - 1]));
  }

  function sayAloud(text) {
    if (isVoiceEnabled() && voiceSupported()) speak(text);
  }

  // The voice: the short headline, then the first thing the coach explains.
  function speechFor(p) {
    return settings.moveFeedback ? coachSpeech(p, settings.coachStyle, p.speech || undefined) : p.san;
  }

  // ----- Retry: try to find the better move yourself -----
  function retrySquare(square) {
    if (!retry || retry.solved) return;
    const g = retry.game;
    if (retry.selected) {
      const mv = retry.targets.find((m) => m.to === square);
      if (mv) {
        const made = g.move({ from: retry.selected, to: square, promotion: mv.promotion ? "q" : undefined });
        retry.selected = null;
        retry.targets = [];
        const p = data.plies[retry.ply - 1];
        const ok = p.acceptable.some((a) => a.from === made.from && a.to === made.to);
        if (ok) {
          retry.solved = true;
          setRetryMessage("That's it!", `${made.san} is ${made.san === p.bestSan ? "the best move" : "one of the best moves"} here.`, "#81b64c", "✓");
          setMood("happy");
        } else {
          setRetryMessage("Not quite", `${made.san} isn't the move. Try again.`, "#e58f2a", "?");
          setMood("shocked");
          const undoMe = retry;
          setTimeout(() => {
            if (retry === undoMe && !undoMe.solved) {
              undoMe.game.undo();
              rerender();
              setRetryMessage("Find a better move", "Play your move on the board.", "#7d9b6a", "↻");
            }
          }, 900);
        }
        rerender();
        return;
      }
    }
    const piece = g.get(square);
    if (piece && piece.color === g.turn()) {
      retry.selected = square;
      retry.targets = g.moves({ square, verbose: true });
    } else {
      retry.selected = null;
      retry.targets = [];
    }
    rerender();
  }

  function setRetryMessage(title, detail, color, mark) {
    const badge = $("coach-badge");
    badge.style.display = "";
    badge.style.background = color;
    badge.textContent = mark;
    $("coach-title").textContent = title;
    $("coach-detail").textContent = detail;
  }

  function startRetry() {
    const p = cur();
    if (!p || !ERRORS.has(p.cls)) return;
    retry = { game: new Chess(p.fenBefore), selected: null, targets: [], ply: p.ply, solved: false };
    $("btn-review-retry").classList.add("on");
    setRetryMessage("Find a better move", "Play your move on the board.", "#7d9b6a", "↻");
    rerender();
  }

  function exitRetry(redraw = true) {
    retry = null;
    $("btn-review-retry").classList.remove("on");
    if (redraw) {
      renderCoach();
      rerender();
    }
  }

  function goTo(i, opts) {
    if (!data) return;
    index = Math.max(0, Math.min(data.plies.length, i));
    refresh(opts);
  }

  function setVoiceButton() {
    const b = $("btn-review-voice");
    b.hidden = !voiceSupported();
    const on = isVoiceEnabled();
    b.querySelector(".rv-glyph").textContent = on ? "🔊" : "🔇";
    b.setAttribute("aria-pressed", String(on));
  }

  function startSteps(at = 1) {
    setPhase("steps");
    showBest = false;
    setVoiceButton();
    goTo(at, { say: true });
  }

  // The header arrow: from the steps, back to the summary; from the summary,
  // out of the review.
  function backFromHeader() {
    if (phase === "steps") {
      stopSpeaking();
      setPhase("summary");
      index = 0;
      if (retry) exitRetry(false);
      updateEvalBar();
      requestAnimationFrame(() => {
        board = new Chess(fenAt(0));
        drawGraph();
        rerender();
      });
    } else {
      close();
    }
  }

  function onKey(e) {
    if (!active || !data || phase !== "steps") return;
    if (e.key === "ArrowLeft") goTo(index - 1, { say: true });
    else if (e.key === "ArrowRight") goTo(index + 1, { say: true });
  }

  // ----- the options sheet (the gear) -----
  const OPTIONS = [
    ["quick", "Quick Analysis", "Faster review. Turn off for a deeper, slower one (applies to the next review)."],
    ["evalBar", "Show Evaluation Bar", "Who is ahead, beside the board."],
    ["suggestionArrows", "Show Suggestion Arrows", "A blue arrow for the engine's best move."],
    ["threatArrows", "Show Threat Arrows", "A red arrow for what the other side threatens."],
    ["engineLines", "Show Engine Lines", "The engine's top three lines."],
    ["moveFeedback", "Show Move Feedback", "The coach's comments and the badge on each move."],
  ];

  function renderSettings() {
    const list = $("rv-settings-list");
    list.innerHTML = "";
    // Who the coach is talking to.
    const who = document.createElement("div");
    who.className = "rv-set-row";
    who.innerHTML = '<div class="rv-set-text"><b>Coach explains for</b><small>Simple words for kids, or the proper chess terms.</small></div><div class="rv-seg" role="group"><button type="button" data-style="kids">Kids</button><button type="button" data-style="adults">Adults</button></div>';
    for (const btn of who.querySelectorAll("button")) {
      btn.setAttribute("aria-pressed", String(settings.coachStyle === btn.dataset.style));
      btn.onclick = () => {
        settings = { ...settings, coachStyle: btn.dataset.style };
        saveAnalysisSettings(settings);
        for (const b2 of who.querySelectorAll("button")) b2.setAttribute("aria-pressed", String(b2 === btn));
        if (data) {
          renderSummaryBubble();
          refresh();
        }
      };
    }
    list.appendChild(who);
    // Which voice the coach speaks with (phones often default to a woman's voice).
    if (voiceSupported()) {
      const vrow = document.createElement("div");
      vrow.className = "rv-set-row";
      vrow.innerHTML = '<div class="rv-set-text"><b>Coach voice</b><small>Pick any voice installed on your phone. "Auto" chooses a man\'s voice.</small></div><select class="rv-select" aria-label="Coach voice"></select>';
      const sel = vrow.querySelector("select");
      const opts = [["", "Auto (male)"], ...listVoices().map((v) => [v.name, v.name])];
      for (const [val, label] of opts) {
        const o = document.createElement("option");
        o.value = val;
        o.textContent = label;
        sel.appendChild(o);
      }
      sel.value = getVoiceName();
      sel.onchange = () => {
        setVoiceName(sel.value);
        speak("Hello, I'm your chess coach.");
      };
      list.appendChild(vrow);
    }
    for (const [key, title, hint] of OPTIONS) {
      const row = document.createElement("div");
      row.className = "rv-set-row";
      row.innerHTML = '<div class="rv-set-text"><b></b><small></small></div><button type="button" class="rv-switch" role="switch"></button>';
      row.querySelector("b").textContent = title;
      row.querySelector("small").textContent = hint;
      const sw = row.querySelector("button");
      sw.setAttribute("aria-checked", String(!!settings[key]));
      sw.setAttribute("aria-label", title);
      sw.dataset.option = key;
      sw.onclick = () => {
        settings = { ...settings, [key]: !settings[key] };
        saveAnalysisSettings(settings);
        sw.setAttribute("aria-checked", String(!!settings[key]));
        if (data) refresh();
      };
      list.appendChild(row);
    }
  }

  function openSettings() {
    renderSettings();
    $("review-settings").classList.remove("hidden");
  }
  function closeSettings() {
    $("review-settings").classList.add("hidden");
    if (data) refresh();
  }

  function wire() {
    wired = true;
    $("btn-review-start").onclick = () => startSteps(1);
    $("btn-review-prev").onclick = () => goTo(index - 1, { say: true });
    $("btn-review-next").onclick = () => goTo(index + 1, { say: true });
    $("btn-mv-rprev").onclick = () => goTo(index - 1, { say: true });
    $("btn-mv-rnext").onclick = () => goTo(index + 1, { say: true });
    $("btn-review-retry").onclick = () => (retry ? exitRetry() : startRetry());
    $("btn-review-settings").onclick = openSettings;
    $("btn-settings-back").onclick = closeSettings;
    $("btn-review-best").onclick = () => {
      showBest = !showBest;
      refresh();
    };
    $("btn-review-voice").onclick = () => {
      setVoiceEnabled(!isVoiceEnabled());
      setVoiceButton();
    };
    $("btn-review-close").onclick = backFromHeader;
    $("review-graph").onclick = (e) => {
      if (!data) return;
      const r = e.currentTarget.getBoundingClientRect();
      const n = data.winSeries.length - 1;
      const i = Math.round(((e.clientX - r.left) / r.width) * n);
      startSteps(Math.max(1, i));
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", () => active && data && drawGraph());
  }

  // moves: chess.js verbose history. orientation: whose side is at the bottom
  // ("w" or "b").
  async function open({ moves, startFen = null, whiteName = "White", blackName = "Black", orientation = "w", side = null }) {
    if (!wired) {
      wire();
      initCoach();
    }
    settings = getAnalysisSettings();
    perspective = side; // whose game this was, if one person played it
    retry = null;
    threats.clear();
    active = true;
    data = null;
    index = 0;
    showBest = false;
    cssFlip = orientation === "b";
    board = new Chess(startFen || undefined);
    $("review-white-name").textContent = whiteName;
    $("review-black-name").textContent = blackName;
    $("review-body").classList.add("hidden");
    $("review-error").classList.add("hidden");
    $("review-progress").classList.remove("hidden");
    $("review-progress-bar").style.width = "0%";
    $("review-progress-text").textContent = "Getting ready…";
    setPhase("summary");
    rerender();

    if (moves.length === 0) {
      $("review-progress").classList.add("hidden");
      $("review-error").textContent = "There are no moves to review in this game.";
      $("review-error").classList.remove("hidden");
      return;
    }
    cancel = { cancelled: false };
    const mine = cancel;
    try {
      data = await analyzeGame({
        moves,
        startFen,
        preset: settings.quick ? "quick" : "deep",
        cancel: mine,
        onProgress: (done, total) => {
          $("review-progress-bar").style.width = `${Math.round((done / total) * 100)}%`;
          $("review-progress-text").textContent = `Looking at move ${done} of ${total}…`;
        },
      });
    } catch (e) {
      if (mine.cancelled) return;
      $("review-progress").classList.add("hidden");
      $("review-error").textContent = "Sorry — the review couldn't be finished. Please try again.";
      $("review-error").classList.remove("hidden");
      return;
    }
    if (mine.cancelled) return;
    $("review-progress").classList.add("hidden");
    $("review-body").classList.remove("hidden");
    $("review-opening").textContent = data.opening ? `Opening: ${data.opening}` : "";
    renderSummary();
    // The canvas only has a size once it is visible.
    requestAnimationFrame(() => {
      drawGraph();
      board = new Chess(fenAt(0));
      rerender();
    });
  }

  function close() {
    active = false;
    if (cancel) cancel.cancelled = true;
    stopAnalysis();
    stopSpeaking();
    delete document.body.dataset.reviewPhase;
    document.documentElement.style.removeProperty("--evalbar-w");
    $("eval-bar").classList.add("hidden");
    onClose();
  }

  // Stop everything without navigating (used when leaving to Home).
  function abort() {
    active = false;
    if (cancel) cancel.cancelled = true;
    stopSpeaking();
    delete document.body.dataset.reviewPhase;
    document.documentElement.style.removeProperty("--evalbar-w");
    $("eval-bar").classList.add("hidden");
  }

  return {
    hook,
    open,
    close,
    abort,
    isActive: () => active,
    goTo,
    // Exposed for the test harness.
    _state: () => ({ index, cssFlip, phase, data, showBest }),
  };
}
