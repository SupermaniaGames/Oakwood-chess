// The post-match Game Review, in two phases like chess.com's:
//   1. Summary: the coach, the evaluation graph, accuracy, and how many moves
//      of each quality each side played. "Start Review" begins phase 2.
//   2. Steps: the coach's bubble above the board, a quality badge on the move's
//      square, a best-move arrow for mistakes, the move strip, and a bottom bar
//      (Back / Best / Flip / Voice / Next).
// main.js owns the board element; this module hands it a "hook" describing
// what to draw (see renderBoard in main.js).

import { Chess } from "./vendor/chess.js";
import { analyzeGame, CLASS_INFO, CLASS_ORDER, stopAnalysis } from "./analysis.js";
import { MATE_THRESHOLD } from "./bot.js";
import { speak, stopSpeaking, isVoiceEnabled, setVoiceEnabled, voiceSupported } from "./voice.js";

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

  const fenAt = (i) => (i === 0 ? data.plies[0].fenBefore : data.plies[i - 1].fenAfter);
  const cur = () => (data && index > 0 ? data.plies[index - 1] : null);

  // The arrow is drawn for a move that was NOT best (what to play instead);
  // the Best button draws it for any move.
  function arrow() {
    const p = cur();
    if (!p || phase !== "steps") return null;
    if (!(ERRORS.has(p.cls) || showBest)) return null;
    if (p.bestFrom === p.from && p.bestTo === p.to) return null;
    return { from: p.bestFrom, to: p.bestTo };
  }

  const hook = {
    get game() {
      return board;
    },
    get cssFlip() {
      return cssFlip;
    },
    classes(square) {
      const p = cur();
      return p && (square === p.from || square === p.to) ? ["last-move"] : [];
    },
    badge(square) {
      const p = cur();
      if (!p || square !== p.to || phase !== "steps") return null;
      const info = CLASS_INFO[p.cls];
      return { mark: info.mark, color: info.color, label: info.label };
    },
    arrow,
  };

  function evalLabel(cp) {
    if (Math.abs(cp) >= MATE_THRESHOLD) return cp > 0 ? "+M" : "-M";
    const v = cp / 100;
    return (v >= 0 ? "+" : "") + v.toFixed(2);
  }

  function setPhase(p) {
    phase = p;
    document.body.dataset.reviewPhase = p;
    $("review-summary").classList.toggle("hidden", p !== "summary");
    $("review-steps").classList.toggle("hidden", p !== "steps");
  }

  // ----- summary phase -----
  function summaryText() {
    if (data.turning) {
      const t = data.turning;
      const num = Math.ceil(t.ply / 2);
      return `The biggest turning point was move ${num}${t.color === "w" ? "" : "…"} (${t.san}) — it was a ${CLASS_INFO[t.cls].label.toLowerCase()}. Tap Start Review to go through it.`;
    }
    return "Both sides played very accurately. Tap Start Review to go through the game.";
  }

  function renderSummary() {
    $("summary-bubble").textContent = summaryText();
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
      rows.appendChild(row);
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
    // White's share: filled from the bottom up to the curve.
    ctx.beginPath();
    ctx.moveTo(0, H);
    data.winSeries.forEach((w, i) => ctx.lineTo(xAt(i), yAt(w)));
    ctx.lineTo(xAt(n), H);
    ctx.closePath();
    ctx.fillStyle = "#f1f1ee";
    ctx.fill();
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

  function renderCoach() {
    const p = cur();
    const badge = $("coach-badge");
    if (!p) {
      badge.style.display = "none";
      $("coach-title").textContent = "Start position";
      $("coach-eval").textContent = "0.00";
      $("coach-detail").textContent = data.opening
        ? `We'll go through the game together. It started as the ${data.opening}.`
        : "We'll go through the game together.";
      return;
    }
    const info = CLASS_INFO[p.cls];
    badge.style.display = "";
    badge.style.background = info.color;
    badge.textContent = info.mark;
    $("coach-title").textContent = p.title;
    $("coach-eval").textContent = evalLabel(p.evalWhite);
    $("coach-detail").textContent = p.detail;
  }

  function refresh({ say = false } = {}) {
    if (!data) return;
    board = new Chess(fenAt(index));
    if (phase === "steps") {
      renderCoach();
      renderStrip();
      $("btn-review-prev").disabled = index <= 0;
      $("btn-review-next").disabled = index >= data.plies.length;
      $("btn-mv-rprev").disabled = index <= 0;
      $("btn-mv-rnext").disabled = index >= data.plies.length;
      $("btn-review-best").classList.toggle("on", showBest);
    }
    drawGraph();
    rerender();
    if (say && index > 0) speak(data.plies[index - 1].speech);
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

  function wire() {
    wired = true;
    $("btn-review-start").onclick = () => startSteps(1);
    $("btn-review-prev").onclick = () => goTo(index - 1, { say: true });
    $("btn-review-next").onclick = () => goTo(index + 1, { say: true });
    $("btn-mv-rprev").onclick = () => goTo(index - 1, { say: true });
    $("btn-mv-rnext").onclick = () => goTo(index + 1, { say: true });
    $("btn-review-best").onclick = () => {
      showBest = !showBest;
      refresh();
    };
    $("btn-review-flip").onclick = () => {
      cssFlip = !cssFlip;
      rerender(); // re-render only: step position is untouched
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
  async function open({ moves, startFen = null, whiteName = "White", blackName = "Black", orientation = "w" }) {
    if (!wired) wire();
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
    onClose();
  }

  // Stop everything without navigating (used when leaving to Home).
  function abort() {
    active = false;
    if (cancel) cancel.cancelled = true;
    stopSpeaking();
    delete document.body.dataset.reviewPhase;
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
