// Optional shared leaderboard + accounts. If firebase-config.js hasn't
// been filled in (firebaseEnabled === false), every function here is a
// safe no-op — the rest of the app never needs to know whether this is
// wired up.
//
// Identity model: everyone starts as an anonymous Firebase user (so local
// play always has a stable id and can appear on the leaderboard). Signing
// in with Google or email *links* that same anonymous account to the
// provider where possible, so the uid — and therefore the rating history
// already stored under it — carries over rather than resetting.

import { firebaseConfig, firebaseEnabled } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.13.1/";

let state = null; // { db, auth, store, authFns } once ready
let readyPromise = null;
const authListeners = [];

function currentUserInfo() {
  const user = state?.auth?.currentUser;
  if (!user) return null;
  return {
    uid: user.uid,
    isAnonymous: user.isAnonymous,
    displayName: user.displayName || null,
    email: user.email || null,
  };
}

function notifyAuthListeners() {
  const info = currentUserInfo();
  authListeners.forEach((cb) => cb(info));
}

async function init() {
  if (!firebaseEnabled) return null;
  try {
    const [{ initializeApp }, authMod, storeMod] = await Promise.all([
      import(/* webpackIgnore: true */ SDK + "firebase-app.js"),
      import(/* webpackIgnore: true */ SDK + "firebase-auth.js"),
      import(/* webpackIgnore: true */ SDK + "firebase-firestore.js"),
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    const db = storeMod.getFirestore(app);

    const result = { db, auth, store: storeMod, authFns: authMod };

    await new Promise((resolve, reject) => {
      let settled = false;
      authMod.onAuthStateChanged(
        auth,
        async (user) => {
          if (!user) {
            // No session yet (or just signed out) — start a fresh anonymous one.
            try {
              await authMod.signInAnonymously(auth);
            } catch (err) {
              if (!settled) {
                settled = true;
                reject(err);
              }
            }
            return;
          }
          if (!settled) {
            settled = true;
            resolve();
          }
          notifyAuthListeners();
        },
        (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        }
      );
    });

    return result;
  } catch (err) {
    console.warn("Oakwood Chess: Firebase unavailable, staying local-only.", err);
    return null;
  }
}

function ready() {
  if (!readyPromise) readyPromise = init().then((s) => (state = s));
  return readyPromise;
}

export function isConfigured() {
  return firebaseEnabled;
}

// Subscribe to sign-in/sign-out/link changes. Calls back immediately with
// the current state (or null if not configured/ready yet), then again on
// every future change. Returns an unsubscribe function.
export function onAuthChange(cb) {
  authListeners.push(cb);
  ready().then(() => cb(currentUserInfo()));
  return () => {
    const i = authListeners.indexOf(cb);
    if (i >= 0) authListeners.splice(i, 1);
  };
}

export function getCurrentUser() {
  return currentUserInfo();
}

function describeAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/email-already-in-use": "That email already has an account — try signing in instead.",
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "No account found with that email — try creating one instead.",
    "auth/popup-closed-by-user": "Sign-in was closed before finishing.",
    "auth/network-request-failed": "Network problem — check your connection and try again.",
    "auth/unauthorized-domain": "This site isn't authorized for sign-in yet — add it under Authentication → Settings → Authorized domains in the Firebase console.",
  };
  return map[code] || err?.message || "Something went wrong signing in.";
}

export async function signInWithGoogle() {
  await ready();
  if (!state) return { ok: false, error: "Firebase isn't configured yet." };
  const { GoogleAuthProvider, linkWithPopup, signInWithPopup } = state.authFns;
  const provider = new GoogleAuthProvider();
  try {
    if (state.auth.currentUser?.isAnonymous) {
      const result = await linkWithPopup(state.auth.currentUser, provider);
      notifyAuthListeners();
      return { ok: true, user: currentUserInfo(), _raw: result.user };
    }
    const result = await signInWithPopup(state.auth, provider);
    notifyAuthListeners();
    return { ok: true, user: currentUserInfo(), _raw: result.user };
  } catch (err) {
    // This Google account is already tied to a different existing user —
    // sign into that pre-existing account instead of failing outright.
    if (err?.code === "auth/credential-already-in-use") {
      try {
        const result = await signInWithPopup(state.auth, provider);
        notifyAuthListeners();
        return { ok: true, user: currentUserInfo(), _raw: result.user };
      } catch (err2) {
        return { ok: false, error: describeAuthError(err2) };
      }
    }
    return { ok: false, error: describeAuthError(err) };
  }
}

// Creates a new permanent account from the current (anonymous) session —
// this is the path that preserves your existing local rating history.
export async function signUpWithEmail(email, password) {
  await ready();
  if (!state) return { ok: false, error: "Firebase isn't configured yet." };
  const { EmailAuthProvider, linkWithCredential } = state.authFns;
  try {
    const cred = EmailAuthProvider.credential(email, password);
    await linkWithCredential(state.auth.currentUser, cred);
    notifyAuthListeners();
    return { ok: true, user: currentUserInfo() };
  } catch (err) {
    if (err?.code === "auth/email-already-in-use" || err?.code === "auth/credential-already-in-use") {
      return { ok: false, error: "That email already has an account — try signing in instead." };
    }
    return { ok: false, error: describeAuthError(err) };
  }
}

// Signs into a pre-existing email/password account — this intentionally
// switches to that account's own uid and history, since that's the point.
export async function signInWithEmail(email, password) {
  await ready();
  if (!state) return { ok: false, error: "Firebase isn't configured yet." };
  try {
    await state.authFns.signInWithEmailAndPassword(state.auth, email, password);
    notifyAuthListeners();
    return { ok: true, user: currentUserInfo() };
  } catch (err) {
    return { ok: false, error: describeAuthError(err) };
  }
}

export async function signOutUser() {
  await ready();
  if (!state) return;
  await state.authFns.signOut(state.auth);
  // onAuthStateChanged above will notice the signed-out state and start a
  // fresh anonymous session automatically, so gameplay keeps working.
}

// Reads this account's saved profile from Firestore, if any. Used to make
// sign-in restore your real username/rating instead of showing whatever
// (or nothing) happens to be cached locally on this particular device.
export async function fetchMyProfile() {
  await ready();
  if (!state) return null;
  try {
    const { doc, getDoc } = state.store;
    const snap = await getDoc(doc(state.db, "players", state.auth.currentUser.uid));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("Oakwood Chess: couldn't load your saved profile.", err);
    return null;
  }
}

// Read-only check, no claiming — lets the UI show "available"/"taken"
// before someone commits to signing up with a name.
export async function checkUsernameAvailable(name) {
  await ready();
  if (!state) return { ok: false, error: "Firebase isn't configured yet." };
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, error: "Enter a username first." };
  try {
    const { doc, getDoc } = state.store;
    const snap = await getDoc(doc(state.db, "usernames", trimmed.toLowerCase()));
    if (!snap.exists()) return { ok: true, available: true };
    const takenByMe = state.auth.currentUser && snap.data().uid === state.auth.currentUser.uid;
    return { ok: true, available: !!takenByMe, mine: !!takenByMe };
  } catch (err) {
    return { ok: false, error: err?.message || "Couldn't check that right now." };
  }
}

// Claims a username with case-insensitive uniqueness enforced by Firestore
// rules + a transaction (see the "usernames" collection in the README's
// security rules). Releases any previous username this account held.
export async function claimUsername(name) {
  await ready();
  if (!state) return { ok: false, error: "Firebase isn't configured yet." };
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, error: "Enter a username first." };
  if (trimmed.length > 24) return { ok: false, error: "Keep it under 24 characters." };
  const key = trimmed.toLowerCase();
  const uid = state.auth.currentUser.uid;
  const { doc, runTransaction } = state.store;
  try {
    await runTransaction(state.db, async (tx) => {
      const claimRef = doc(state.db, "usernames", key);
      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists() && claimSnap.data().uid !== uid) {
        throw new Error("taken");
      }
      const playerRef = doc(state.db, "players", uid);
      const playerSnap = await tx.get(playerRef);
      const prevName = playerSnap.exists() ? playerSnap.data().name : null;
      const prevKey = prevName ? prevName.toLowerCase() : null;
      // Firestore transactions need every read before any write, so look
      // up the old claim now rather than blindly deleting it: if it was
      // never claimed (older data), there's nothing to release, and a
      // delete on a missing doc would be rejected by the security rules.
      let prevClaimSnap = null;
      let prevRef = null;
      if (prevKey && prevKey !== key) {
        prevRef = doc(state.db, "usernames", prevKey);
        prevClaimSnap = await tx.get(prevRef);
      }
      if (prevClaimSnap && prevClaimSnap.exists() && prevClaimSnap.data().uid === uid) {
        tx.delete(prevRef);
      }
      tx.set(claimRef, { uid });
      tx.set(playerRef, { name: trimmed, uid }, { merge: true });
    });
    return { ok: true, name: trimmed };
  } catch (err) {
    if (err?.message === "taken") return { ok: false, error: "That username is already taken." };
    return { ok: false, error: err?.message || "Couldn't save that username right now." };
  }
}

// Upserts this account's player doc. Fire-and-forget is fine — it never
// blocks gameplay, and failures are logged, not thrown.
export async function pushProfile(profile) {
  await ready();
  if (!state) return false;
  const name = (profile.name || "").trim();
  if (!name) return false; // don't clutter the leaderboard with nameless entries
  // A name should only ever reach the leaderboard through the unique-claim
  // path — otherwise one typed while Firebase was off (or from older data)
  // could be pushed unchecked and duplicate someone else's. Claiming your
  // own existing name is a harmless no-op.
  const claim = await claimUsername(name);
  if (!claim.ok) return false;
  try {
    const { doc, setDoc, serverTimestamp } = state.store;
    await setDoc(
      doc(state.db, "players", state.auth.currentUser.uid),
      {
        rating: profile.rating,
        games: profile.games,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn("Oakwood Chess: couldn't sync rating.", err);
    return false;
  }
}

// Returns an array of top players, or null if the leaderboard couldn't be
// reached (not configured, offline, rules issue, etc).
export async function fetchLeaderboard(max = 20) {
  await ready();
  if (!state) return null;
  try {
    const { collection, query, orderBy, limit, getDocs } = state.store;
    const q = query(collection(state.db, "players"), orderBy("rating", "desc"), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Oakwood Chess: couldn't load leaderboard.", err);
    return null;
  }
}

// Why the last live-games / lobby call failed (e.g. "permission-denied" when
// the Firestore rules for that collection haven't been published). The UI
// uses this to tell people the real problem instead of an empty list.
const lastErrorCode = {};
export function getFirestoreErrorCode(kind) {
  return lastErrorCode[kind] || null;
}

// --- Live games directory (for the Watch tab's spectator list) ---
//
// This is deliberately a thin "presence" list, not a game-state relay:
// Firestore only ever stores who's playing and the room code. The actual
// moves still travel peer-to-peer once a spectator connects — Firestore
// just helps them find the room in the first place, the same job PeerJS's
// broker does for the two players.

export async function registerLiveGame(code, info) {
  await ready();
  if (!state) return false;
  try {
    const { doc, setDoc, serverTimestamp } = state.store;
    await setDoc(doc(state.db, "liveGames", code), {
      hostName: (info.hostName || "Someone").slice(0, 24),
      guestName: (info.guestName || "Someone").slice(0, 24),
      timeControl: info.timeControl || "untimed",
      // Lets the security rules restrict changes/deletes to this listing's
      // own host, so nobody else can wipe or overwrite it.
      hostUid: state.auth.currentUser.uid,
      startedAt: serverTimestamp(),
    });
    lastErrorCode.liveWrite = null;
    return true;
  } catch (err) {
    lastErrorCode.liveWrite = err?.code || "unknown";
    console.warn("Oakwood Chess: couldn't list this game as live.", err);
    return false;
  }
}

export async function unregisterLiveGame(code) {
  await ready();
  if (!state) return;
  try {
    const { doc, deleteDoc } = state.store;
    await deleteDoc(doc(state.db, "liveGames", code));
  } catch {
    /* best-effort cleanup — a stale entry will just look like a dead room
       to a spectator, who gets a normal "room not open" message */
  }
}

export async function fetchLiveGames(max = 20) {
  await ready();
  if (!state) return null;
  try {
    const { collection, query, orderBy, limit, getDocs } = state.store;
    const q = query(collection(state.db, "liveGames"), orderBy("startedAt", "desc"), limit(max));
    const snap = await getDocs(q);
    lastErrorCode.live = null;
    return snap.docs.map((d) => ({ code: d.id, ...d.data() }));
  } catch (err) {
    lastErrorCode.live = err?.code || "unknown";
    console.warn("Oakwood Chess: couldn't load live games.", err);
    return null;
  }
}

// --- Open games lobby (Online tab) ---
//
// Same idea as the live-games list: Firestore only records "this room is
// open and waiting"; the game itself still runs peer-to-peer. A listing is
// removed as soon as an opponent joins or the host leaves.

export async function registerOpenGame(code, info) {
  await ready();
  if (!state) return false;
  try {
    const { doc, setDoc, serverTimestamp } = state.store;
    await setDoc(doc(state.db, "openGames", code), {
      hostName: (info.hostName || "Player").slice(0, 24),
      rating: typeof info.rating === "number" ? info.rating : 1200,
      timeControl: info.timeControl || "untimed",
      hostUid: state.auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });
    lastErrorCode.openWrite = null;
    return true;
  } catch (err) {
    lastErrorCode.openWrite = err?.code || "unknown";
    console.warn("Oakwood Chess: couldn't list this room in the lobby.", err);
    return false;
  }
}

export async function unregisterOpenGame(code) {
  await ready();
  if (!state) return;
  try {
    const { doc, deleteDoc } = state.store;
    await deleteDoc(doc(state.db, "openGames", code));
  } catch {
    /* best-effort: a stale listing just fails to connect and is skipped */
  }
}

// Oldest first, so whoever has waited longest gets matched first.
export async function fetchOpenGames(max = 30) {
  await ready();
  if (!state) return null;
  try {
    const { collection, query, orderBy, limit, getDocs } = state.store;
    const q = query(collection(state.db, "openGames"), orderBy("createdAt", "asc"), limit(max));
    const snap = await getDocs(q);
    lastErrorCode.open = null;
    return snap.docs.map((d) => ({ code: d.id, ...d.data() }));
  } catch (err) {
    lastErrorCode.open = err?.code || "unknown";
    console.warn("Oakwood Chess: couldn't load open games.", err);
    return null;
  }
}
