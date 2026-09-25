// A small countdown clock for two sides. Time is tracked against wall-clock
// timestamps (not by counting ticks) so it stays accurate even if the tab
// is backgrounded for a while.

export const TIME_CONTROLS = {
  untimed: { label: "Untimed", ms: null },
  b3: { label: "3 min", ms: 3 * 60 * 1000 },
  b5: { label: "5 min", ms: 5 * 60 * 1000 },
  b10: { label: "10 min", ms: 10 * 60 * 1000 },
  b15: { label: "15 min", ms: 15 * 60 * 1000 },
};

export function formatMs(ms) {
  if (ms == null) return "";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export class Clock {
  constructor(timeControlKey, onTick, onFlag) {
    this.key = timeControlKey;
    this.enabled = timeControlKey !== "untimed";
    const base = (TIME_CONTROLS[timeControlKey] || TIME_CONTROLS.untimed).ms;
    this.remaining = { w: base, b: base };
    this.active = null; // 'w' | 'b' | null
    this.turnStarted = 0;
    this.onTick = onTick;
    this.onFlag = onFlag;
    this.timer = null;
  }

  // Restore exact remaining times (e.g. resuming a saved game).
  setRemaining(w, b) {
    this.remaining.w = w;
    this.remaining.b = b;
  }

  start(color) {
    if (!this.enabled) return;
    this.active = color;
    this.turnStarted = Date.now();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this._tick(), 200);
  }

  // Call right after a move: commits elapsed time to the side that just
  // moved, then starts the clock for the other side.
  switchTo(nextColor) {
    if (!this.enabled) return;
    this._commit();
    this.start(nextColor);
  }

  stop() {
    this._commit();
    this.active = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _commit() {
    if (!this.enabled || !this.active) return;
    const elapsed = Date.now() - this.turnStarted;
    this.remaining[this.active] = Math.max(0, this.remaining[this.active] - elapsed);
    this.turnStarted = Date.now();
  }

  _tick() {
    if (!this.active) return;
    const flaggedColor = this.active;
    const elapsed = Date.now() - this.turnStarted;
    const left = Math.max(0, this.remaining[flaggedColor] - elapsed);
    this.onTick && this.onTick({ ...this.remaining, [flaggedColor]: left });
    if (left <= 0) {
      this.stop();
      this.onFlag && this.onFlag(flaggedColor);
    }
  }

  snapshot() {
    if (this.active) this._commit();
    return { w: this.remaining.w, b: this.remaining.b };
  }
}
