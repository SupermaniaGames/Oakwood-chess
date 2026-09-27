// Paste your Firebase project's config below, then set firebaseEnabled to
// true. Find these values in the Firebase console:
// Project settings (gear icon) → General → Your apps → SDK setup and
// configuration → Config.
//
// Until you do that, the app runs entirely local-only (no error, no
// network calls) — this file being left as-is is a supported state, not
// a broken one.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

export const firebaseEnabled = false; // flip to true once the config above is filled in
