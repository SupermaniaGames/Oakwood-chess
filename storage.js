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
