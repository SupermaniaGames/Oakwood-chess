// The coach's face: it reacts to each move and "talks" while the voice speaks.
//
// Pictures (all optional except neutral; put them in icons/, ~256 px square,
// transparent background):
//   coach_neutral.png  — default; book moves, good moves, inaccuracies
//   coach_happy.png    — best / brilliant / great / excellent moves
//   coach_shocked.png  — mistakes, misses and blunders
//   coach_talk.png     — open mouth; swapped in while the coach is talking
// A missing picture is handled gracefully: no shocked picture -> the neutral one
// shakes instead; no talk picture -> the face gently bounces; no neutral picture
// at all -> the drawn face from index.html stays.

const FILES = {
  neutral: "icons/coach_neutral.png",
  happy: "icons/coach_happy.png",
  shocked: "icons/coach_shocked.png",
  talk: "icons/coach_talk.png",
};
const avail = {};
let probed = false;
let mood = "neutral";
let talkToken = 0;
let talkTimer = null;
let mouthTimer = null;

// Which face goes with which kind of move.
export function moodForClass(cls) {
  if (["brilliant", "great", "best", "excellent"].includes(cls)) return "happy";
  if (["mistake", "miss", "blunder"].includes(cls)) return "shocked";
  return "neutral";
}

const boxes = () => document.querySelectorAll(".coach-avatar");

function ensureImages() {
  for (const box of boxes()) {
    if (!avail.neutral) return;
    if (!box.querySelector("img.coach-img")) {
      box.innerHTML = "";
      const img = document.createElement("img");
      img.className = "coach-img";
      img.alt = "";
      img.draggable = false;
      box.appendChild(img);
      box.classList.add("has-img");
    }
  }
}

function srcFor(m) {
  if (avail[m]) return FILES[m];
  return avail.neutral ? FILES.neutral : null;
}

function paint(mouthOpen = false) {
  ensureImages();
  const base = srcFor(mood);
  // The open-mouth picture is a cheerful pose, so a shocked coach keeps the shocked face (it just bobs).
  const src = mouthOpen && avail.talk && mood !== "shocked" ? FILES.talk : base;
  for (const box of boxes()) {
    const img = box.querySelector("img.coach-img");
    if (img && src && img.getAttribute("src") !== src) img.setAttribute("src", src);
    box.classList.toggle("mood-shocked", mood === "shocked");
    box.classList.toggle("mood-happy", mood === "happy");
    box.classList.toggle("no-shock-pic", mood === "shocked" && !avail.shocked); // shake instead
  }
}

// Check which pictures exist (once), then show the current mood.
export function initCoach() {
  if (probed) return;
  probed = true;
  for (const [key, url] of Object.entries(FILES)) {
    const probe = new Image();
    probe.onload = () => {
      avail[key] = true;
      paint();
    };
    probe.src = url;
  }
}

export function setMood(m) {
  mood = m;
  // restart the one-shot reaction animation
  for (const box of boxes()) {
    box.classList.remove("react");
    void box.offsetWidth;
    box.classList.add("react");
  }
  paint();
}

function stopTalking() {
  clearTimeout(talkTimer);
  clearInterval(mouthTimer);
  talkTimer = null;
  mouthTimer = null;
  for (const box of boxes()) box.classList.remove("coach-speaking");
  paint(false);
}

// Call when the voice starts speaking `text`. Returns the callbacks to hand to
// speak(): the face stops "talking" when the speech ends. A timer based on the
// text length is the safety net for browsers that don't report the end.
export function talkHooks(text) {
  const token = ++talkToken;
  clearTimeout(talkTimer);
  clearInterval(mouthTimer);
  for (const box of boxes()) box.classList.add("coach-speaking");
  let open = false;
  mouthTimer = setInterval(() => {
    open = !open;
    paint(open);
  }, 160);
  talkTimer = setTimeout(() => token === talkToken && stopTalking(), Math.min(14000, 700 + String(text).length * 62));
  return {
    onEnd: () => {
      if (token === talkToken) stopTalking();
    },
  };
}

export function stopCoachTalking() {
  talkToken++;
  stopTalking();
}
