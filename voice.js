// Spoken commentary through the browser's built-in speech synthesis
// (window.speechSynthesis) — no audio files, no network. Browsers only let a
// page speak after the person has interacted with it, which is always true
// here: review is opened by a tap, and a spectator has tapped to join.

const KEY = "oakwood.voice";

export function voiceSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function isVoiceEnabled() {
  if (!voiceSupported()) return false;
  const v = localStorage.getItem(KEY);
  return v === null ? true : v === "1";
}

export function setVoiceEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the toggle just won't persist */
  }
  if (!on) stopSpeaking();
}

export function stopSpeaking() {
  if (voiceSupported()) window.speechSynthesis.cancel();
}

// Speaks `text`, cutting off whatever was being said (stepping quickly
// through moves shouldn't queue up a backlog of old commentary).
// hooks.onEnd runs when this utterance finishes (or is cut off).
export function speak(text, hooks = {}) {
  if (!text || !isVoiceEnabled()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.pitch = 1;
  u.lang = document.documentElement.lang || "en";
  if (hooks.onStart) u.onstart = hooks.onStart;
  if (hooks.onEnd) {
    u.onend = hooks.onEnd;
    u.onerror = hooks.onEnd;
  }
  synth.speak(u);
  return true;
}
