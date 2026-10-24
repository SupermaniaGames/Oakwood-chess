// Play with Coach: a game against the computer where the coach watches every
// move you make and talks to you about it.
//
// What happens on each turn:
//   1. You move. The coach's face turns thoughtful while Stockfish judges the
//      move (the same judgement as Game Review: Brilliant … Blunder).
//   2. A speech bubble gives feedback — the move's name, the idea, and, for a
//      mistake, what went wrong. The face reacts (happy / shocked) and the
//      voice reads it aloud.
//   3. After a real mistake the coach pauses and shows what he can now do
//      (a red arrow): you can "Continue" or "Retry" the move.
//   4. Then the coach plays his own move, with a short first-person comment
//      ("I capture back!").
// Hint draws the engine's best move on the board; Undo takes moves back.
// Whenever a game enters a named opening the coach tells you its name and where
// the name comes from.
//
// The computer's strength is set by an Elo level, which maps onto Stockfish's
// "Skill Level" (0-20) plus a limit on how far it may look. The mapping is a
// reasonable guide, not a measured rating.

import { Chess } from "./vendor/chess.js";
import { createStockfish } from "./stockfish.js";
import { chooseBotMove } from "./bot.js";
import { judgeLastMove, bestMoveFor, analyzeCached } from "./analysis.js";
import { coachLines, coachSpeech, liveSentence, botSays, moveFacts } from "./coach.js";
import { openingAt, openingOrigin } from "./openings.js";
import { speak, stopSpeaking } from "./voice.js";
import { setMood, moodForClass } from "./coach-avatar.js";
import { getAnalysisSettings } from "./storage.js";

export const COACH_LEVELS = [
  { elo: 400, name: "New to Chess" },
  { elo: 700, name: "Beginner" },
  { elo: 900, name: "Novice" },
  { elo: 1100, name: "Intermediate" },
  { elo: 1300, name: "Improving" },
  { elo: 1600, name: "Advanced" },
  { elo: 1900, name: "Strong" },
];
export const DEFAULT_COACH_ELO = 1100;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Elo -> Stockfish "Skill Level" 0..20 (400 -> 0, 1200 -> 9, 2000 -> 18, 2200 -> 20).
export function eloToSkill(elo) {
  return clamp(Math.round((elo - 400) / 90), 0, 20);
}

// Elo -> how hard Stockfish may think. A weaker level also looks fewer moves ahead,
// which is what makes it miss tactics like a club player would.
export function eloToLimits(elo) {
  return {
    skill: eloToSkill(elo),
    depth: clamp(Math.round(1 + (elo - 400) / 260), 1, 10),
    movetime: Math.round(clamp(120 + (elo - 400) * 0.4, 120, 800)),
  };
}

// The built-in engine's nearest rung, used only if Stockfish can't start.
const BOT_RUNGS = [250, 400, 600, 800, 1000, 1200, 1400, 1600, 1800];
function nearestRung(elo) {
  return BOT_RUNGS.reduce((best, r) => (Math.abs(r - elo) < Math.abs(best - elo) ? r : best), BOT_RUNGS[0]);
}

const $ = (id) => document.getElementById(id);
const ARROW_GREEN = "rgba(129,182,76,0.9)";
const ARROW_RED = "rgba(205,70,60,0.9)";
const NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

export function createCoachGame(deps) {
  let botSf = null;
  let sfBroken = false;
  let running = false;
  let elo = DEFAULT_COACH_ELO;
  let busy = false; // the coach is judging or moving
  let prompt = null; // the Continue / Retry choice, when showing
  let prevDrop = 0;
  let botToken = 0;
  let counts = {};
  let counted = null; // class of the last judged player move (so Retry can take it back)
  let shownOrigins = new Set();
  let lastPlayerMove = null;

  const style = () => getAnalysisSettings().coachStyle;

  // ----- speech bubbles -----
  function fill(el, title, lines) {
    el.innerHTML = "";
    if (title) {
      const t = document.createElement("b");
      t.className = "coach-bubble-title";
      t.textContent = title;
      el.appendChild(t);
    }
    for (const line of lines) {
      const s = document.createElement("span");
      s.className = "coach-line";
      s.textContent = line;
      el.appendChild(s);
    }
    el.classList.toggle("hidden", !title && lines.length === 0);
    // The speech area has a fixed height: a new comment about your move starts at its top.
    if (el.id === "coach-b1" && el.parentElement) el.parentElement.scrollTop = 0;
  }
  const bubble1 = (title, lines = []) => fill($("coach-b1"), title, lines); // about your move
  const bubble2 = (lines = []) => {
    fill($("coach-b2"), null, lines); // the coach's own move
    // The coach's reply is the newest line: scroll down to it if the area is full.
    const box = $("coach-b2").parentElement;
    if (lines.length && box) box.scrollTop = box.scrollHeight;
  };
  const showActions = (on) => {
    $("coach-actions").classList.toggle("hidden", !on);
    // With Continue / Retry showing, bring the coach's "Take a look…" line into view above them.
    if (on) $("coach-actions").parentElement.scrollTop = $("coach-actions").parentElement.scrollHeight;
  };

  function clearHint() {
    deps.setArrows([]);
  }

  // ----- opening names and their stories -----
  function openingStory(who) {
    const sans = deps.game().history();
    const op = openingAt(sans, sans.length);
    if (!op || !op.exact) return null;
    const origin = openingOrigin(op.name);
    if (!origin || shownOrigins.has(origin)) return null;
    shownOrigins.add(origin);
    return who === "you" ? `You're playing the ${op.name} — ${origin}` : `I'm playing the ${op.name} — ${origin}`;
  }

  // ----- the computer's move -----
  async function pickBotMove(fen) {
    const hook = typeof window !== "undefined" && window.__oakwoodTest && window.__oakwoodTest.botMove;
    if (hook) {
      const m = hook(fen);
      if (m) return m;
    }
    if (!sfBroken) {
      try {
        if (!botSf) botSf = createStockfish();
        const uci = await botSf.play(fen, eloToLimits(elo));
        if (uci) {
          const mv = { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
          new Chess(fen).move(mv); // throws if illegal
          return mv;
        }
      } catch {
        sfBroken = true; // Stockfish couldn't start: use the built-in engine from now on
      }
    }
    const m = chooseBotMove(new Chess(fen), nearestRung(elo));
    return m;
  }

  async function requestBotMove() {
    if (!running) return;
    const token = ++botToken;
    busy = true;
    clearHint();
    setMood("thinking");
    deps.setThinking(true);
    const g = deps.game();
    const fenBefore = g.fen();
    const started = Date.now();
    let mv = null;
    try {
      mv = await pickBotMove(fenBefore);
    } catch {
      mv = null;
    }
    // feel natural: never answer instantly
    const wait = 450 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!running || token !== botToken) return;
    deps.setThinking(false);
    if (!mv) {
      busy = false;
      return;
    }
    const applied = deps.applyBotMove(mv);
    if (!applied) {
      busy = false;
      return;
    }
    const facts = moveFacts(fenBefore, mv, { ply: deps.game().history().length, prevMove: lastPlayerMove });
    const lines = [botSays(facts, style())];
    const story = openingStory("me");
    if (story) lines.push(story);
    setMood("neutral");
    bubble2(lines);
    speak(lines.join(" "), { queue: true });
    busy = false;
    // Analyse the new position while you think, so Hint and the next judgement are quick.
    analyzeCached(deps.game().fen()).catch(() => {});
  }

  // ----- judging your move -----
  const MISTAKES = new Set(["mistake", "blunder", "miss"]);

  function threatLine(ply) {
    const r = ply.replyFacts;
    if (r) {
      if (r.mate) return "Take a look. I can checkmate you now.";
      if (r.winsMaterial) return `Take a look. I can now take your ${r.winsMaterial.free ? "undefended " : ""}${NAME[r.winsMaterial.piece]}.`;
      if (r.fork) return "Take a look. I have a fork coming — one piece attacking two of yours.";
      if (r.pin) return `Take a look. I can pin your ${NAME[r.pin[0]]}.`;
      if (r.skewer) return `Take a look. I can skewer your ${NAME[r.skewer[0]]}.`;
    }
    return "Take a look. There was a stronger move here.";
  }

  async function onPlayerMove() {
    if (!running) return;
    busy = true;
    clearHint();
    showActions(false);
    const g = deps.game();
    const moves = g.history({ verbose: true });
    lastPlayerMove = moves[moves.length - 1];
    setMood("thinking");
    bubble2([]);
    bubble1(null, ["…"]);
    let res = null;
    try {
      res = await judgeLastMove({ moves, prevDrop, preset: "live" });
    } catch {
      res = null; // no engine: carry on without feedback
    }
    if (!running || deps.game().history().length !== moves.length) return; // undone while judging
    if (res) {
      const ply = res.ply;
      prevDrop = res.drop;
      counted = ply.cls;
      counts[ply.cls] = (counts[ply.cls] || 0) + 1;
      const c = coachLines(ply, style());
      // Keep the bubble short: for a mistake, the move, what went wrong, and just
      // the name of the better move (the full idea is in Game Review).
      const firstSentence = (s) => (s || "").split(/(?<=[.!?])\s/)[0];
      const lines = MISTAKES.has(ply.cls) ? [c.lines[0], c.lines[1], firstSentence(c.lines[2])].filter(Boolean) : c.lines.slice(0, 2);
      const story = openingStory("you");
      if (story) lines.push(story);
      bubble1(c.title, lines);
      setMood(moodForClass(ply.cls));
      speak(coachSpeech(ply, style(), ply.speech || undefined) + (story ? ` ${story}` : ""));
      if (MISTAKES.has(ply.cls) && res.drop >= 12 && !g.isGameOver()) {
        // Pause: show what the coach can now do, and let the player Continue or Retry.
        prompt = { ply };
        const r = ply.replyFacts;
        deps.setArrows(r ? [{ from: r.from, to: r.to, color: ARROW_RED }] : []);
        bubble2([threatLine(ply)]);
        speak(threatLine(ply), { queue: true });
        showActions(true);
        busy = false;
        return;
      }
    } else {
      bubble1(null, []);
      setMood("neutral");
    }
    if (g.isGameOver()) {
      busy = false;
      return;
    }
    await requestBotMove();
  }

  // ----- the buttons -----
  async function hint() {
    if (!running || busy || prompt) return;
    const g = deps.game();
    if (g.turn() !== deps.myColor() || g.isGameOver()) return;
    setMood("thinking");
    bubble1("Let me think…", []);
    let best = null;
    try {
      best = await bestMoveFor(g.fen(), "live");
    } catch {
      best = null;
    }
    if (!running || deps.game().fen() !== g.fen()) return;
    if (!best) {
      bubble1("Sorry, I can't find a hint right now.", []);
      setMood("neutral");
      return;
    }
    deps.setArrows([{ from: best.from, to: best.to, color: ARROW_GREEN }]);
    const why = best.facts ? liveSentence(best.facts, style()) : "";
    const lines = [`Try ${best.san}.`, ...(why ? [why] : [])];
    bubble1("Here's a hint", lines);
    setMood("neutral");
    speak(lines.join(" "));
  }

  function continueAfterPrompt() {
    if (!prompt) return;
    prompt = null;
    showActions(false);
    clearHint();
    requestBotMove();
  }

  function retry() {
    if (!prompt) return;
    if (counted) counts[counted] = Math.max(0, (counts[counted] || 1) - 1);
    prompt = null;
    showActions(false);
    clearHint();
    deps.undoPlies(1); // take back just your move; the coach hasn't replied yet
    prevDrop = 0;
    busy = false;
    setMood("neutral");
    bubble2([]);
    bubble1("No problem — try another move!", []);
    speak("No problem. Try another move.");
    deps.render();
  }

  function undo() {
    if (!running) return;
    const g = deps.game();
    if (busy && !prompt) return; // the coach is mid-thought; wait a moment
    const mine = deps.myColor();
    const n = prompt ? 1 : g.turn() === mine ? 2 : 1;
    if (g.history().length < n) return;
    botToken++; // forget any move still being computed
    prompt = null;
    showActions(false);
    clearHint();
    deps.setThinking(false);
    deps.undoPlies(n);
    prevDrop = 0;
    busy = false;
    setMood("neutral");
    bubble2([]);
    bubble1("Sure — take it back.", []);
    deps.render();
  }

  // ----- starting and finishing -----
  function start({ elo: level }) {
    running = true;
    elo = level || DEFAULT_COACH_ELO;
    busy = false;
    prompt = null;
    prevDrop = 0;
    counts = {};
    counted = null;
    shownOrigins = new Set();
    lastPlayerMove = null;
    botToken++;
    showActions(false);
    $("coach-end").classList.add("hidden");
    clearHint();
    setMood("neutral");
    bubble2([]);
    bubble1("Let's play!", ["Good luck. I'll tell you how you're doing as we go."]);
    speak("Let's play! Good luck.");
    analyzeCached(deps.game().fen()).catch(() => {});
  }

  function stop() {
    running = false;
    botToken++;
    prompt = null;
    busy = false;
    showActions(false);
    clearHint();
    $("coach-end").classList.add("hidden");
    stopSpeaking();
  }

  function outcomeFor(text) {
    const g = deps.game();
    const mine = deps.myColor();
    if (/resign/i.test(text)) return { result: "loss", how: "by resignation" };
    if (g.isCheckmate()) return { result: g.turn() === mine ? "loss" : "win", how: "by checkmate" };
    if (g.isStalemate()) return { result: "draw", how: "by stalemate" };
    return { result: "draw", how: "" };
  }

  // The result card (chess.com's "Coach … Won"), after a moment so the last move is visible.
  function onGameEnd(text) {
    if (!running) return;
    const { result, how } = outcomeFor(text || "");
    prompt = null;
    showActions(false);
    clearHint();
    deps.setThinking(false);
    botToken++;
    const title = result === "win" ? "You won!" : result === "loss" ? "Coach won" : "It's a draw";
    const comment =
      result === "win"
        ? "Well played — you beat me! Let's look at how it went in the game review."
        : result === "loss"
        ? "Defending from a worse position is one of the harder things to do in chess. Let's see how you could have bounced back."
        : "A fair result. Let's see if either of us missed something.";
    setTimeout(() => {
      if (!running) return;
      setMood(result === "win" ? "shocked" : result === "loss" ? "happy" : "neutral");
      $("coach-end-title").textContent = title;
      $("coach-end-sub").textContent = how;
      $("coach-end-bubble").textContent = comment;
      const chips = [
        ["great", "!", "Great"],
        ["best", "⭐", "Best"],
        ["excellent", "👍", "Excellent"],
        ["mistake", "?", "Mistakes"],
        ["blunder", "??", "Blunders"],
      ];
      const box = $("coach-end-counts");
      box.innerHTML = "";
      for (const [key, mark, label] of chips) {
        const n = counts[key] || 0;
        if (!n && ["mistake", "blunder"].includes(key)) continue;
        const d = document.createElement("div");
        d.className = "coach-count";
        d.innerHTML = '<span class="cc-mark"></span><b></b><small></small>';
        d.querySelector(".cc-mark").textContent = mark;
        d.querySelector("b").textContent = String(n);
        d.querySelector("small").textContent = label;
        box.appendChild(d);
      }
      $("coach-end").classList.remove("hidden");
      speak(comment);
    }, 900);
  }

  return {
    start,
    stop,
    onPlayerMove,
    requestBotMove,
    hint,
    undo,
    retry,
    continueAfterPrompt,
    onGameEnd,
    isRunning: () => running,
    isBusy: () => busy || !!prompt,
    elo: () => elo,
  };
}
