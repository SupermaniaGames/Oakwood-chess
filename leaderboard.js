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
//
// Where a profile lives:
//   users/{uid}        the account's own profile (name, rating, games) — the
//                      permanent record, keyed by the Firebase uid, so the
//                      same Google account sees the same name on every device.
//   usernames/{name}   a lock on the lower-cased name so two accounts can't
//                      share one (written together with users/{uid}).
//   players/{uid}      a public copy of name/rating/games that the
//                      leaderboard reads. Written alongside users/{uid}.
// Profiles saved before users/ existed live only in players/{uid}; they are
// read from there and copied into users/{uid} the first time they're seen.

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
  const { GoogleAuthProvider, linkWithPopup, signInWithPopup, signInWithCredential } = state.authFns;
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
    // This Google account already belongs to a different (earlier) user —
    // e.g. it was set up on another device. Sign into THAT account using the
    // credential the failed link already obtained. (Opening a second popup
    // here is what phones tend to block, which used to leave the person on a
    // fresh guest account with a different username.)
    if (err?.code === "auth/credential-already-in-use") {
      try {
        const credential = GoogleAuthProvider.credentialFromError(err);
        if (!credential) return { ok: false, error: "Couldn't finish signing in — please try again." };
        await releaseGuestProfile();
        const result = await signInWithCredential(state.auth, credential);
        notifyAuthListeners();
        return { ok: true, user: currentUserInfo(), _raw: result.user };
      } catch (err2) {
        return { ok: false, error: describeAuthError(err2) };
      }
    }
    return { ok: false, error: describeAuthError(err) };
  }
}

// The guest account we're about to walk away from still owns a username lock
// and a leaderboard row. While we're still signed in as it, hand both back,
// so the name isn't stuck on an abandoned account and no ghost entry stays
// on the leaderboard.
async function releaseGuestProfile() {
  const user = state?.auth?.currentUser;
  if (!user || !user.isAnonymous) return;
  const { doc, getDoc, deleteDoc } = state.store;
  try {
    const [u, p] = await Promise.all([
      getDoc(doc(state.db, "users", user.uid)),
      getDoc(doc(state.db, "players", user.uid)),
    ]);
    const name = (u.exists() && u.data().name) || (p.exists() && p.data().name) || null;
    if (name) {
      const claim = await getDoc(doc(state.db, "usernames", name.toLowerCase()));
      if (claim.exists() && claim.data().uid === user.uid) {
        await deleteDoc(doc(state.db, "usernames", name.toLowerCase()));
      }
    }
    if (u.exists()) await deleteDoc(doc(state.db, "users", user.uid));
    if (p.exists()) await deleteDoc(doc(state.db, "players", user.uid));
  } catch (err) {
    console.warn("Oakwood Chess: couldn't tidy the guest profile.", err);
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

// Reads this account's saved profile (users/{uid}), so signing in — or just
// reopening the app — shows the account's real name and rating instead of
// whatever is cached on this device. A profile that only exists in the older
// players/{uid} record is copied across the first time it's read.
export async function fetchMyProfile() {
  await ready();
  if (!state || !state.auth.currentUser) return null;
  const uid = state.auth.currentUser.uid;
  try {
    const { doc, getDoc, setDoc } = state.store;
    const snap = await getDoc(doc(state.db, "users", uid));
    if (snap.exists()) return snap.data();
    const legacy = await getDoc(doc(state.db, "players", uid));
    if (!legacy.exists()) return null;
    const d = legacy.data();
    const profile = { name: d.name || "", rating: d.rating ?? 1200, games: d.games ?? 0, uid };
    try {
      await setDoc(doc(state.db, "users", uid), profile, { merge: true });
    } catch {
      /* copying is best-effort; the legacy record still answers */
    }
    return profile;
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
  if (!state || !state.auth.currentUser) return { ok: false, error: "Firebase isn't configured yet." };
  return claimUsernameFor(state.auth.currentUser.uid, name);
}

// Same, but for a specific account: if the signed-in account changes while
// this is running (a sign-in finishing, say) it stops instead of attaching the
// name to whoever happens to be signed in by then.
async function claimUsernameFor(uid, name) {
  const stillMe = () => state?.auth?.currentUser?.uid === uid;
  if (!stillMe()) return { ok: false, error: "The account changed — try again." };
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, error: "Enter a username first." };
  if (trimmed.length > 24) return { ok: false, error: "Keep it under 24 characters." };
  const key = trimmed.toLowerCase();
  const { doc, runTransaction } = state.store;
  try {
    await runTransaction(state.db, async (tx) => {
      if (!stillMe()) throw new Error("account-changed");
      const claimRef = doc(state.db, "usernames", key);
      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists() && claimSnap.data().uid !== uid) {
        throw new Error("taken");
      }
      const userRef = doc(state.db, "users", uid);
      const playerRef = doc(state.db, "players", uid);
      const userSnap = await tx.get(userRef);
      const playerSnap = await tx.get(playerRef);
      const prevName =
        (userSnap.exists() && userSnap.data().name) || (playerSnap.exists() && playerSnap.data().name) || null;
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
      // Dual write: lock the handle, save it on the account's own profile,
      // and mirror it onto the public leaderboard row.
      tx.set(claimRef, { uid, name: trimmed });
      tx.set(userRef, { name: trimmed, uid }, { merge: true });
      tx.set(playerRef, { name: trimmed, uid }, { merge: true });
    });
    return { ok: true, name: trimmed };
  } catch (err) {
    if (err?.message === "taken") return { ok: false, error: "That username is already taken." };
    if (err?.message === "account-changed") return { ok: false, error: "The account changed — try again." };
    return { ok: false, error: err?.message || "Couldn't save that username right now." };
  }
}

// Saves rating/games for this account (users/{uid} + the public players/{uid}
// row). The NAME is never taken from this device's cache if the account
// already has one in the cloud — a device whose copy is out of date must not
// overwrite a name chosen on another. Only an account with no name yet claims
// the one passed in. Returns { ok, name } (the name the account really has),
// so the caller can update its local copy. Never throws.
export async function pushProfile(profile) {
  await ready();
  if (!state || !state.auth.currentUser) return { ok: false, name: "" };
  const uid = state.auth.currentUser.uid; // this call is for THIS account only
  const stillMe = () => state.auth.currentUser?.uid === uid;
  const cloud = await fetchMyProfile();
  if (!stillMe()) return { ok: false, name: "" };
  let name = (cloud && cloud.name) || "";
  if (!name) {
    const wanted = (profile.name || "").trim();
    if (!wanted) return { ok: false, name: "" }; // no nameless leaderboard entries
    const claim = await claimUsernameFor(uid, wanted); // unique-claim path only
    if (!claim.ok) return { ok: false, name: "" };
    name = wanted;
  }
  if (!stillMe()) return { ok: false, name };
  try {
    const { doc, setDoc, serverTimestamp } = state.store;
    const data = { rating: profile.rating, games: profile.games, updatedAt: serverTimestamp() };
    await setDoc(doc(state.db, "users", uid), { ...data, name, uid }, { merge: true });
    await setDoc(doc(state.db, "players", uid), { ...data, name, uid }, { merge: true });
    return { ok: true, name };
  } catch (err) {
    console.warn("Oakwood Chess: couldn't sync rating.", err);
    return { ok: false, name };
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
