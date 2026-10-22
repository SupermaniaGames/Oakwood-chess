// Spoken commentary through the browser's built-in speech synthesis
// (window.speechSynthesis) — no audio files, no network. Browsers only let a
// page speak after the person has interacted with it, which is always true
// here: review is opened by a tap, and a spectator has tapped to join.
//
// The coach is a man, but phones often default to a female voice. So the voice
// is chosen like this: the one the person picked in the options, else the best
// English voice whose name looks male, else any English voice that doesn't look
// female (and, if all we have is the default, a lower pitch).

const KEY = "oakwood.voice";
const KEY_NAME = "oakwood.voiceName";

const MALE = /\b(male|david|daniel|mark|james|george|alex|fred|guy|ryan|thomas|oliver|arthur|rishi|ravi|aaron|diego|jorge|matthew|paul|eric|tom|henry|richard|brian|christopher|davis|gordon|lee|rocko|reed|eddy|grandpa|ralph|bruce|junior|evan|nathan|steffan|andrew|brandon|iol|iom|rjs|gba|gbb)\b/i;
const FEMALE = /\b(female|zira|samantha|susan|hazel|karen|moira|tessa|victoria|fiona|serena|kate|catherine|linda|heera|aria|jenny|sara|joanna|salli|ivy|kendra|kimberly|amy|emma|shelley|sandy|flo|grandma|nicky|allison|ava|nora|libby|sonia|maisie|natasha|clara|michelle|monica|tpd|tpf|sfg|tpc)\b/i;

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

const english = () =>
  (voiceSupported() ? window.speechSynthesis.getVoices() : []).filter((v) => /^en([-_]|$)/i.test(v.lang || "") || /english/i.test(v.name || ""));

// English voices for the picker (the list can be empty until the browser has loaded them).
export function listVoices() {
  return english().map((v) => ({ name: v.name, lang: v.lang }));
}

export function getVoiceName() {
  return localStorage.getItem(KEY_NAME) || "";
}

export function setVoiceName(name) {
  try {
    if (name) localStorage.setItem(KEY_NAME, name);
    else localStorage.removeItem(KEY_NAME);
  } catch {
    /* ignore */
  }
}

// The voice to use right now, and whether it had to be a guess.
function chooseVoice() {
  const all = english();
  const picked = getVoiceName();
  if (picked) {
    const hit = all.find((v) => v.name === picked);
    if (hit) return { voice: hit, guessed: false };
  }
  const male = all.filter((v) => MALE.test(v.name) && !FEMALE.test(v.name));
  // Prefer a UK/US voice among the male ones.
  const pref = male.find((v) => /en[-_](gb|us)/i.test(v.lang)) || male[0];
  if (pref) return { voice: pref, guessed: false };
  const neutral = all.find((v) => !FEMALE.test(v.name));
  return { voice: neutral || null, guessed: true };
}

// Speaks `text`, cutting off whatever was being said (stepping quickly
// through moves shouldn't queue up a backlog of old commentary).
// With { queue: true } it waits its turn instead of cutting off what is being said.
export function speak(text, opts = {}) {
  if (!text || !isVoiceEnabled()) return false;
  const synth = window.speechSynthesis;
  if (!opts.queue) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const { voice, guessed } = chooseVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = document.documentElement.lang || "en";
  }
  // No clearly male voice on this phone: lower the pitch so the default sounds less high.
  u.pitch = guessed ? 0.7 : 0.95;
  u.rate = 1;
  synth.speak(u);
  return true;
}
