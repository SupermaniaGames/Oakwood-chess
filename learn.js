// The Learn tab: a row of topics, each rendered from learn-data.js (and the
// opening dictionary). Small static boards show the examples; the tactic
// cards let you reveal the winning move, and the opening and game cards let
// you step through the moves.

import { Chess } from "./vendor/chess.js";
import { TACTICS, MATES, PRINCIPLES, STRATEGY, ENDGAMES, GLOSSARY, GAMES } from "./learn-data.js";
import { allOpenings } from "./openings.js";

// id, label, one-line blurb, tile colours (background, icon), icon.
const TOPICS = [
  ["basics", "Basics", "How the pieces move, and how to win", "#E3EDD3", "#477747", "piece:wp"],
  ["tactics", "Tactics", "Forks, pins and tricks that win material", "#F5EBCB", "#8A6A12", "bolt"],
  ["mates", "Checkmates", "The patterns that end the game", "#F3DDD3", "#A4472F", "piece:wk"],
  ["openings", "Openings", "How to start a game well", "#DCE8EC", "#3B6B7D", "book"],
  ["strategy", "Strategy", "Plans for quiet positions", "#E6EBD0", "#5C6B1E", "compass"],
  ["endgames", "Endgames", "Few pieces left, big decisions", "#EFE4D6", "#7A5A32", "flag"],
  ["games", "Famous games", "Classic games with the coach's notes", "#F6E6C8", "#9A6A12", "trophy"],
  ["glossary", "Glossary", "Chess words, explained simply", "#E4E8E1", "#4A5D4A", "text:Aa"],
];

const ICON_PATHS = {
  bolt: "M7 2v11h3v9l7-12h-4l4-8z",
  book: "M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z",
  compass: "M12 10.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z",
  flag: "M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z",
  trophy: "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z",
};

function topicIcon(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  if (kind.startsWith("piece:")) {
    svg.setAttribute("viewBox", "0 0 40 40");
    svg.setAttribute("class", "learn-ic-piece");
    const use = document.createElementNS(ns, "use");
    use.setAttribute("href", "#" + kind.slice(6));
    svg.appendChild(use);
  } else if (kind.startsWith("text:")) {
    svg.setAttribute("viewBox", "0 0 24 24");
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", "12"); t.setAttribute("y", "17"); t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "13"); t.setAttribute("font-weight", "800"); t.setAttribute("fill", "currentColor");
    t.textContent = kind.slice(5);
    svg.appendChild(t);
  } else {
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", ICON_PATHS[kind]);
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
  }
  return svg;
}

// Openings seen in games by these champions (from chess.com's game collections).
const PLAYED_BY = [
  [/Najdorf/, ["Kasparov", "Carlsen"]],
  [/King's Indian/, ["Kasparov"]],
  [/Grünfeld/, ["Kasparov"]],
  [/Alapin|Canal/, ["Kasparov"]],
  [/Pirc|Alekhine/, ["Kasparov"]],
  [/Queen's Gambit Accepted|Semi-Slav|^Slav/, ["Kasparov", "Carlsen"]],
  [/London/, ["Kasparov", "Carlsen"]],
  [/Caro-Kann/, ["Kasparov", "Carlsen"]],
  [/French/, ["Kasparov", "Carlsen"]],
  [/Scotch/, ["Kasparov"]],
  [/Ruy Lopez|Petrov|Vienna|Giuoco|Bishop's Opening|Wayward|Queen's Gambit Declined|English|King's Indian Attack|Réti/, ["Carlsen"]],
];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ---------- little boards ----------

function pieceSvg(color, type) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("class", "mini-piece");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `#${color}${type}`);
  svg.appendChild(use);
  return svg;
}

function arrowSvg(from, to) {
  const ns = "http://www.w3.org/2000/svg";
  const pt = (sq) => [sq.charCodeAt(0) - 97 + 0.5, 8 - Number(sq[1]) + 0.5];
  const [x1, y1] = pt(from);
  const [x2, y2] = pt(to);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * 0.55;
  const by = y2 - uy * 0.55;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 8 8");
  svg.setAttribute("class", "mini-arrow");
  const line = document.createElementNS(ns, "line");
  for (const [k, v] of [["x1", x1 + ux * 0.2], ["y1", y1 + uy * 0.2], ["x2", bx], ["y2", by], ["stroke", "rgba(129,182,76,0.9)"], ["stroke-width", "0.24"]]) line.setAttribute(k, v);
  const tri = document.createElementNS(ns, "polygon");
  tri.setAttribute("points", `${x2},${y2} ${bx - uy * 0.32},${by + ux * 0.32} ${bx + uy * 0.32},${by - ux * 0.32}`);
  tri.setAttribute("fill", "rgba(129,182,76,0.9)");
  svg.append(line, tri);
  return svg;
}

// A static board from a FEN. opts: { arrow: {from,to}, marks: [squares] }.
export function miniBoard(fen, opts = {}) {
  const g = new Chess(fen);
  const box = el("div", "mini-board");
  box.setAttribute("role", "img");
  const rows = g.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = "abcdefgh"[c] + (8 - r);
      const cell = el("div", "mini-sq " + ((r + c) % 2 === 0 ? "light" : "dark"));
      if (opts.marks && opts.marks.includes(sq)) cell.classList.add("mark");
      const p = rows[r][c];
      if (p) cell.appendChild(pieceSvg(p.color, p.type));
      box.appendChild(cell);
    }
  }
  if (opts.arrow) box.appendChild(arrowSvg(opts.arrow.from, opts.arrow.to));
  return box;
}

// A board you can step through: `sans` from `startFen`. onStep(index, san, ply).
function stepper(sans, onStep, startFen) {
  const wrap = el("div", "stepper");
  const boardBox = el("div", "stepper-board");
  const bar = el("div", "stepper-bar");
  const prev = el("button", "btn btn-ghost btn-small", "‹");
  const label = el("span", "stepper-label", "Start");
  const next = el("button", "btn btn-ghost btn-small", "›");
  prev.setAttribute("aria-label", "Previous move");
  next.setAttribute("aria-label", "Next move");
  bar.append(prev, label, next);
  wrap.append(boardBox, bar);
  const fens = [];
  const history = [];
  const g = startFen ? new Chess(startFen) : new Chess();
  fens.push(g.fen());
  for (const s of sans) {
    const m = g.move(s);
    history.push(m);
    fens.push(g.fen());
  }
  let i = 0;
  const show = () => {
    boardBox.innerHTML = "";
    const last = i > 0 ? history[i - 1] : null;
    boardBox.appendChild(miniBoard(fens[i], { marks: last ? [last.from, last.to] : [] }));
    label.textContent = i === 0 ? "Start" : `${Math.ceil(i / 2)}${history[i - 1].color === "w" ? "." : "..."} ${history[i - 1].san}`;
    prev.disabled = i === 0;
    next.disabled = i === history.length;
    if (onStep) onStep(i, last ? last.san : null);
  };
  prev.onclick = () => {
    i = Math.max(0, i - 1);
    show();
  };
  next.onclick = () => {
    i = Math.min(history.length, i + 1);
    show();
  };
  show();
  wrap.go = (n) => {
    i = Math.max(0, Math.min(history.length, n));
    show();
  };
  return wrap;
}

// ---------- cards ----------

// A small highlighted note with a bold label ("Tip", "Seen in games").
function callout(label, text) {
  const p = el("p", "learn-tip");
  p.appendChild(el("b", null, label));
  p.appendChild(document.createTextNode(" " + text));
  return p;
}

function textBlock(kid, adult) {
  const box = el("div");
  if (kid) box.appendChild(el("p", "learn-kid", kid));
  if (adult) box.appendChild(el("p", "muted learn-adult", adult));
  return box;
}

function exampleBlock(ex) {
  const g = new Chess(ex.fen);
  const from = ex.move.slice(0, 2);
  const to = ex.move.slice(2, 4);
  const wrap = el("div", "learn-example");
  const holder = el("div", "learn-board");
  const caption = el("p", "muted learn-caption", "Look at the arrow — what does this move do?");
  const btn = el("button", "btn btn-primary btn-small", "Show the move");
  let shown = false;
  const draw = () => {
    holder.innerHTML = "";
    if (!shown) {
      holder.appendChild(miniBoard(ex.fen, { arrow: { from, to } }));
      caption.textContent = "Look at the arrow — what does this move do?";
      btn.textContent = "Show the move";
    } else {
      const after = new Chess(ex.fen);
      after.move({ from, to, promotion: ex.move[4] });
      holder.appendChild(miniBoard(after.fen(), { marks: [from, to] }));
      caption.textContent = ex.caption;
      btn.textContent = "Back to the puzzle";
    }
  };
  btn.onclick = () => {
    shown = !shown;
    draw();
  };
  draw();
  void g;
  wrap.append(holder, caption, btn);
  return wrap;
}

function conceptCard(item) {
  const card = el("div", "card learn-card");
  card.appendChild(el("h3", null, item.name));
  card.appendChild(textBlock(item.kid, item.adult));
  if (item.example) card.appendChild(exampleBlock(item.example));
  if (item.sequence) {
    const cap = el("p", "muted learn-caption", item.sequence.caption);
    card.append(stepper(item.sequence.moves.split(" "), null), cap);
  }
  if (item.tip) card.appendChild(callout("Tip", item.tip));
  return card;
}

// ---------- sections ----------

function renderTactics(root) {
  root.appendChild(el("p", "muted learn-intro", "A tactic is a short trick that wins material or checkmates. Learn to spot these and you'll win a lot more games."));
  for (const t of TACTICS) root.appendChild(conceptCard(t));
}

function renderMates(root) {
  root.appendChild(el("p", "muted learn-intro", "These checkmate patterns show up again and again. Learning them helps you find mates — and avoid them."));
  for (const t of MATES) root.appendChild(conceptCard(t));
}

function renderOpenings(root) {
  root.appendChild(el("p", "muted learn-intro", "An opening is the first few moves of a game. Tap one to step through the moves and read the idea behind them."));
  const lines = allOpenings();
  const seen = new Set();
  const groups = { "1. e4": [], "1. d4": [], "Other first moves": [] };
  for (const o of lines) {
    const first = o.moves.split(" ")[0];
    // One entry per opening name: the longest line that has that name.
    const key = o.name;
    if (seen.has(key)) {
      const arr = groups[first === "e4" ? "1. e4" : first === "d4" ? "1. d4" : "Other first moves"];
      const idx = arr.findIndex((x) => x.name === key);
      if (idx >= 0 && o.moves.split(" ").length > arr[idx].moves.split(" ").length) arr[idx] = o;
      continue;
    }
    seen.add(key);
    groups[first === "e4" ? "1. e4" : first === "d4" ? "1. d4" : "Other first moves"].push(o);
  }
  for (const [title, list] of Object.entries(groups)) {
    root.appendChild(el("h3", "learn-group", title));
    for (const o of list) {
      const card = el("div", "card learn-card learn-opening");
      const head = el("button", "learn-opening-head");
      head.appendChild(el("b", null, o.name));
      head.appendChild(el("span", "muted", o.moves.replace(/(\d+)\./g, "$1.")));
      const body = el("div", "learn-opening-body hidden");
      head.onclick = () => {
        const open = body.classList.toggle("hidden") === false;
        head.setAttribute("aria-expanded", String(open));
        if (open && !body.firstChild) {
          const players = PLAYED_BY.filter(([re]) => re.test(o.name)).flatMap(([, who]) => who);
          const who = [...new Set(players)];
          const note = textBlock(o.kidNote, o.note);
          const st = stepper(o.moves.split(" "), null);
          body.append(st, note);
          if (who.length) body.appendChild(callout("Seen in games", `by ${who.join(" and ")}.`));
          const sans = o.moves.split(" ");
          st.go(sans.length);
        }
      };
      head.setAttribute("aria-expanded", "false");
      card.append(head, body);
      root.appendChild(card);
    }
  }
}

function renderList(root, intro, items) {
  if (intro) root.appendChild(el("p", "muted learn-intro", intro));
  for (const it of items) {
    const card = el("div", "card learn-card");
    card.appendChild(el("h3", null, it.name));
    card.appendChild(el("p", "learn-kid", it.text));
    if (it.fen) {
      const holder = el("div", "learn-board");
      holder.appendChild(miniBoard(it.fen, it.move ? { arrow: { from: it.move.slice(0, 2), to: it.move.slice(2, 4) } } : {}));
      card.appendChild(holder);
      if (it.caption) card.appendChild(el("p", "muted learn-caption", it.caption));
    }
    root.appendChild(card);
  }
}

function renderGames(root, onReviewGame) {
  root.appendChild(el("p", "muted learn-intro", `${GAMES.length} classic games. Step through them, then open the Game Review to hear the coach explain every move.`));
  for (const gm of GAMES) {
    const card = el("div", "card learn-card");
    card.appendChild(el("h3", null, gm.title));
    card.appendChild(el("p", "muted learn-caption", `${gm.players} · ${gm.year}`));
    card.appendChild(el("p", "learn-kid", gm.why));
    const note = el("p", "learn-note muted", "Step through the game with ‹ ›.");
    const st = stepper(gm.moves.split(" "), (i) => {
      note.textContent = gm.notes[i] || (i === 0 ? "Step through the game with ‹ ›." : "");
    });
    const btn = el("button", "btn btn-primary btn-small", "Review this game with the coach");
    btn.onclick = () => onReviewGame(gm);
    card.append(st, note, btn);
    root.appendChild(card);
  }
}

function renderGlossary(root) {
  const card = el("div", "card learn-card");
  for (const [term, def] of GLOSSARY) {
    const row = el("div", "glossary-row");
    row.append(el("b", null, term), el("span", "muted", def));
    card.appendChild(row);
  }
  root.appendChild(card);
}

// ---------- the tab ----------
//
// Phone: a hub of topic tiles; tapping one opens that topic as its own page
// (with a back button). Desktop: the tiles become a rail on the left and the
// topic fills the right, so something is always open.

export function createLearn({ tabsEl, basicsEl, contentEl, onReviewGame }) {
  const screen = tabsEl.parentElement;
  const wide = window.matchMedia("(min-width: 900px)");
  let current = null;

  // The banner above the tiles.
  const hero = el("section", "learn-hero");
  const heroText = el("div", "learn-hero-text");
  heroText.append(el("h2", null, "Learn chess"), el("p", null, "Short lessons for beginners, tricks that win games, openings, and the great games of the past."));
  const heroArt = el("img", "learn-hero-art");
  heroArt.src = "assets/chess-decoration.png";
  heroArt.alt = "";
  heroArt.setAttribute("aria-hidden", "true");
  hero.append(heroText, heroArt);
  screen.insertBefore(hero, tabsEl);

  tabsEl.className = "learn-tiles";
  tabsEl.removeAttribute("role");

  function topicHeader(t) {
    const [, label, blurb, bg, fg, icon] = t;
    const h = el("header", "learn-topic-header");
    const back = el("button", "learn-back", "‹  Topics");
    back.type = "button";
    back.onclick = showHub;
    const ic = el("span", "learn-ic");
    ic.style.cssText = `--tile-bg:${bg};--tile-fg:${fg}`;
    ic.appendChild(topicIcon(icon));
    const txt = el("div", "learn-topic-text");
    txt.append(el("h2", null, label), el("p", "muted", blurb));
    h.append(back, ic, txt);
    return h;
  }

  function markTiles() {
    for (const b of tabsEl.children) b.classList.toggle("active", b.dataset.topic === current);
  }

  function showHub() {
    current = null;
    screen.dataset.view = "hub";
    screen.dataset.topic = "";
    basicsEl.classList.add("hidden");
    contentEl.classList.add("hidden");
    markTiles();
    window.scrollTo(0, 0);
  }

  function show(topic) {
    const t = TOPICS.find((x) => x[0] === topic);
    if (!t) return;
    current = topic;
    screen.dataset.view = "topic";
    screen.dataset.topic = topic;
    markTiles();
    basicsEl.classList.toggle("hidden", topic !== "basics");
    contentEl.classList.toggle("hidden", topic === "basics");
    if (topic === "basics") {
      basicsEl.querySelectorAll(":scope > .learn-topic-header").forEach((n) => n.remove());
      basicsEl.prepend(topicHeader(t));
    } else {
      contentEl.innerHTML = "";
      contentEl.dataset.topic = topic;
      contentEl.appendChild(topicHeader(t));
      if (topic === "tactics") renderTactics(contentEl);
      else if (topic === "mates") renderMates(contentEl);
      else if (topic === "openings") renderOpenings(contentEl);
      else if (topic === "strategy") {
        renderList(contentEl, "Big ideas that help you decide what to do when there's no immediate tactic.", [
          ...PRINCIPLES.map((p) => ({ name: p.name, text: p.text })),
          ...STRATEGY,
        ]);
      } else if (topic === "endgames") renderList(contentEl, "Few pieces left, big decisions. These ideas win and save endgames.", ENDGAMES);
      else if (topic === "games") renderGames(contentEl, onReviewGame);
      else if (topic === "glossary") renderGlossary(contentEl);
    }
    window.scrollTo(0, 0);
  }

  for (const t of TOPICS) {
    const [id, label, blurb, bg, fg, icon] = t;
    const b = el("button", "learn-tile");
    b.type = "button";
    b.dataset.topic = id;
    b.style.cssText = `--tile-bg:${bg};--tile-fg:${fg}`;
    const ic = el("span", "learn-ic");
    ic.appendChild(topicIcon(icon));
    const txt = el("span", "learn-tile-text");
    txt.append(el("b", null, label), el("small", null, blurb));
    b.append(ic, txt);
    b.onclick = () => show(id);
    tabsEl.appendChild(b);
  }

  // Desktop always has a topic open; phones start at the hub.
  const settle = () => {
    if (wide.matches && !current) show("basics");
  };
  wide.addEventListener("change", settle);
  screen.dataset.view = "hub";
  basicsEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  settle();

  return { show, showHub, current: () => current };
}
