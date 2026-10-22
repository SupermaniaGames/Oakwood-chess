// The coach's face: it reacts to each move.
//
// Pictures (in icons/, ~256 px square, transparent background):
//   coach_neutral.png   — default; book moves, good moves, inaccuracies
//   coach_happy.png     — best / great / brilliant / excellent moves
//   coach_shocked.png   — mistakes, misses and blunders
//   coach_thinking.png  — while the coach is "thinking" (its move, a hint)
// A missing picture is handled gracefully: no shocked picture -> the neutral one
// shakes with a red glow; no thinking picture -> neutral; no neutral picture at
// all -> the drawn face from index.html stays.

const FILES = {
  neutral: "icons/coach_neutral.png",
  happy: "icons/coach_happy.png",
  shocked: "icons/coach_shocked.png",
  thinking: "icons/coach_thinking.png",
};
const avail = {};
let probed = false;
let mood = "neutral";

// Which face goes with which kind of move.
export function moodForClass(cls) {
  if (["brilliant", "great", "best", "excellent"].includes(cls)) return "happy";
  if (["mistake", "miss", "blunder"].includes(cls)) return "shocked";
  return "neutral";
}

const boxes = () => document.querySelectorAll(".coach-avatar");

function ensureImages() {
  if (!avail.neutral) return;
  for (const box of boxes()) {
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

const srcFor = (m) => (avail[m] ? FILES[m] : avail.neutral ? FILES.neutral : null);

function paint() {
  ensureImages();
  const src = srcFor(mood);
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
