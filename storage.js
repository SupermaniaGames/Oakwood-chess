// Everything here is plain localStorage — no server, no account. It lives
// only in this browser, on this device.

const KEY_INPROGRESS = "oakwood.local.inprogress";
const KEY_HISTORY = "oakwood.history";
const MAX_HISTORY = 100;

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveInProgressLocalGame(state) {
  try {
    localStorage.setItem(KEY_INPROGRESS, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {
    /* storage full or unavailable — silently skip, it's not critical */
  }
}

export function loadInProgressLocalGame() {
  return safeParse(localStorage.getItem(KEY_INPROGRESS), null);
}

export function clearInProgressLocalGame() {
  localStorage.removeItem(KEY_INPROGRESS);
}

export function addHistoryEntry(entry) {
  const list = getHistory();
  list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...entry });
  localStorage.setItem(KEY_HISTORY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

export function getHistory() {
  return safeParse(localStorage.getItem(KEY_HISTORY), []);
}

export function clearHistory() {
  localStorage.removeItem(KEY_HISTORY);
}

const KEY_PROFILE = "oakwood.profile";
const DEFAULT_PROFILE = { name: "", rating: 1200, games: 0 };

export function getProfile() {
  return { ...DEFAULT_PROFILE, ...safeParse(localStorage.getItem(KEY_PROFILE), {}) };
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(KEY_PROFILE, JSON.stringify(profile));
  } catch {
    /* storage full or unavailable — silently skip */
  }
}

// ---- Analysis options (Game Review) ----

const KEY_ANALYSIS = "oakwood.analysis";
export const ANALYSIS_DEFAULTS = {
  quick: true, // faster, shallower engine search when a review starts
  evalBar: true,
  suggestionArrows: true,
  threatArrows: false,
  engineLines: true,
  moveFeedback: true, // coach bubble + badge on each move
  coachStyle: "kids", // how the coach explains: "kids" (simple words) or "adults" (proper terms)
};

export function getAnalysisSettings() {
  return { ...ANALYSIS_DEFAULTS, ...safeParse(localStorage.getItem(KEY_ANALYSIS), {}) };
}

export function saveAnalysisSettings(settings) {
  try {
    localStorage.setItem(KEY_ANALYSIS, JSON.stringify(settings));
  } catch {
    /* storage full or unavailable — the options just won't persist */
  }
}

// ---- Puzzles per day ----
//
// A puzzle uses one of today's slots when you make its FIRST move (so just
// looking, or leaving, is free; retrying the same puzzle after a wrong answer
// is free too). The day is the device's local calendar day, and the count lives
// in this browser — clearing site data resets it.

export const DAILY_PUZZLE_LIMIT = 5;
const KEY_PUZZLE_DAY = "oakwood.puzzles.day";

function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function puzzleUsage() {
  const saved = safeParse(localStorage.getItem(KEY_PUZZLE_DAY), null);
  return saved && saved.day === localDay() ? saved : { day: localDay(), used: 0 };
}

export function puzzlesLeftToday() {
  return Math.max(0, DAILY_PUZZLE_LIMIT - puzzleUsage().used);
}

// Takes one slot if any are left. Returns false (and changes nothing) if not.
export function usePuzzleSlot() {
  const u = puzzleUsage();
  if (u.used >= DAILY_PUZZLE_LIMIT) return false;
  try {
    localStorage.setItem(KEY_PUZZLE_DAY, JSON.stringify({ day: u.day, used: u.used + 1 }));
  } catch {
    /* can't store: allow it rather than lock the person out */
  }
  return true;
}
