// Short synthesized sound effects for moves, captures, check, and game end
// — similar in spirit to chess.com's move sounds, but generated tones
// rather than sampled audio, so there's nothing to fetch or license.
//
// Browsers require a user gesture before audio can play; since every sound
// here is triggered by a click (a move on the board), that requirement is
// naturally satisfied.

const STORAGE_KEY = "oakwood.soundEnabled";
let ctx = null;

function getContext() {
  if (ctx) return ctx;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  ctx = new AudioContextClass();
  return ctx;
}

export function isSoundEnabled() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === "1";
}

export function setSoundEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

// Plays one tone: a short envelope (quick attack, exponential decay) so it
// reads as a percussive "tock" rather than a sustained beep.
function tone(audioCtx, { freq, start, duration, type = "sine", gain = 0.22 }) {
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// A brief burst of filtered noise, layered under a tone for captures so
// they read as more of an "impact" than a plain note.
function noiseHit(audioCtx, { start, duration, gain = 0.15 }) {
  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1200;
  const amp = audioCtx.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(audioCtx.destination);
  src.start(start);
}

const SOUNDS = {
  move(audioCtx, t) {
    tone(audioCtx, { freq: 420, start: t, duration: 0.09, type: "sine", gain: 0.18 });
  },
  capture(audioCtx, t) {
    tone(audioCtx, { freq: 300, start: t, duration: 0.1, type: "square", gain: 0.12 });
    noiseHit(audioCtx, { start: t, duration: 0.08, gain: 0.16 });
  },
  check(audioCtx, t) {
    tone(audioCtx, { freq: 640, start: t, duration: 0.09, type: "triangle", gain: 0.16 });
    tone(audioCtx, { freq: 880, start: t + 0.09, duration: 0.12, type: "triangle", gain: 0.16 });
  },
  gameEnd(audioCtx, t) {
    tone(audioCtx, { freq: 520, start: t, duration: 0.14, type: "sine", gain: 0.16 });
    tone(audioCtx, { freq: 390, start: t + 0.13, duration: 0.16, type: "sine", gain: 0.14 });
    tone(audioCtx, { freq: 260, start: t + 0.27, duration: 0.26, type: "sine", gain: 0.14 });
  },
};

export function playSound(kind) {
  if (!isSoundEnabled()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const fn = SOUNDS[kind] || SOUNDS.move;
  fn(audioCtx, audioCtx.currentTime);
}
