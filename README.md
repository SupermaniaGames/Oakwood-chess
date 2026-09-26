# Oakwood Chess

A small, self-contained chess app: play locally on one computer, or create a
room and send the link to a friend for a live online game. No accounts, no
backend server to run — it's a handful of static files.

## Play it

- **Pick a time control** on the home screen (untimed, 5, 10 or 15 minutes)
  before starting either kind of game.
- **Locally on one PC:** click "Play locally, one board two players" and pass
  the device back and forth, taking turns clicking the board.
- **Online with a friend:** click "Create a room for a friend", then copy the
  link and send it (text, Discord, email, whatever) to your friend. When they
  open it, you're connected and playing. You're White, they're Black.

Moves travel directly between the two browsers over WebRTC (peer-to-peer) —
the only outside service involved is PeerJS's free public broker, which just
helps the two browsers find each other.

## Install it as an app

Oakwood Chess is a installable PWA. Once it's hosted (GitHub Pages or
anywhere with HTTPS — installability needs a secure origin):

- **Android / desktop Chrome or Edge:** an "Install" banner appears
  automatically; tapping it adds a real app icon with no browser chrome.
- **iPhone / iPad (Safari):** browsers don't allow the automatic prompt, so
  the banner instead explains: tap the Share icon, then "Add to Home Screen."
- Once installed it also works offline for local games (the board, rules and
  your saved history are all cached on the device — only online multiplayer
  needs a live connection).

## Multiplayer: codes, links, and connection problems

- Creating a room now gives you a short 4-character code (e.g. `K7QX`) *and*
  a link with that code baked in — share whichever is easier.
- On the home screen, "Join a friend's room" takes the code directly, so
  your friend doesn't need to open a link at all if you just read it out.
- If you saw "peer-unavailable" or a network error before: I added a public
  TURN relay (in addition to the STUN server PeerJS uses by default) so
  connections can complete even when one of you is on a restrictive network
  (school/office wifi, some mobile carriers). This won't fix everything —
  a network that blocks WebRTC outright still will — but it resolves the
  most common cause. If a code shows "doesn't match an open room," the room
  most likely wasn't open yet or the host closed the tab; ask them to
  re-share the current code.

## Rating & leaderboard

- There's a simple personal Elo rating (starts at 1200), updated after each
  *online* game based on your result and the opponent's rating at the time.
  It's shown on the home screen and noted in your game history.
- This rating lives only on your device right now — it's "yours," not a
  shared leaderboard between you and your friend. A real shared leaderboard
  (or cross-device history) needs a small database, which is the next
  section.

## Look & feel

- Pieces are now proper vector artwork (the well-known "Cburnett" Staunton
  set used by most chess sites) instead of text glyphs, on the classic
  green-and-cream board. See the attribution note in `LICENSE` — this
  specific artwork is CC BY-SA 3.0, everything else in the project is MIT.
- The home screen shows the app icon (`icons/icon-512.png`) instead of a
  text title — once you drop in your own logo (see "Using your own logo /
  icon" below), it'll show there automatically.

## If you left the app to share the code and it broke

Backgrounding the browser tab (switching to WhatsApp/SMS to send the code,
or the OS suspending the tab) commonly drops the signaling connection to
the matchmaking server — that's the "network problem" some people hit right
after sharing a code. Two things now handle this:

- The connection automatically tries to reconnect on its own once it's
  able to.
- Coming back to the app (switching back to the tab) also triggers a
  reconnect attempt immediately, rather than waiting.

One thing this can't fix: some messaging apps (Instagram, Facebook, etc.)
open shared links in their own in-app browser, which occasionally blocks
the WebRTC connection outright. If a link opened that way doesn't connect,
try opening it in the actual browser (Chrome/Safari) instead.

## Getting updates to an already-installed app

If you'd installed this before and new deploys weren't showing up: that was
a real bug in the service worker (it was serving the cached version first
instead of checking the network). It's fixed now — an installed copy checks
for updates whenever it's brought to the foreground, and reloads itself
once a new version is ready. If you have an older install that's stuck, a
manual pull-to-refresh (or uninstall/reinstall) once will get it onto the
fixed version.

## Saving & history

- **Resume:** if you leave a local game partway through (the "Home" button),
  it's saved automatically and a "Resume" card appears next time you're on
  the home screen — including the clock, if you're using one.
- **History:** every finished game — local or online — is logged on the home
  screen (result, date, mode). Click one to step through it move by move in
  a read-only replay.
- This is all stored in this browser's `localStorage`, on this device only.
  There's no account and nothing is sent to a server, so clearing your
  browser data or switching devices will lose it. If you'd rather have games
  saved centrally (so they follow you across devices), that needs a small
  backend and sign-in — happy to add that as a next step if useful.

## While playing

- **Clock:** shown next to each player when a time control is selected; a
  side that runs out loses automatically.
- **Chat:** a simple text chat is available in online games.
- **Undo:** in a local game it's instant. In an online game it's a request —
  your friend has to accept it, since it affects both of you.
- **Rematch:** local restarts instantly; online sends a request the same way
  undo does, and swaps who plays White each time.

## Run it locally

Because the app uses ES modules (`import`/`export`), open it through a local
web server rather than double-clicking the HTML file (browsers block module
imports over `file://`). Any static server works, for example:

```bash
cd oakwood-chess
python3 -m http.server 8000
# then open http://localhost:8000
```

or, with Node installed:

```bash
npx serve .
```

## A shared database (for a real leaderboard) — set up now

This is wired up and ready — you just need a free Firebase project and to
paste six values into one file. No credit card required.

1. Go to [console.firebase.google.com](https://console.firebase.google.com),
   sign in, and click **Add project** (any name is fine; you can skip
   Google Analytics).
2. In the left sidebar: **Build → Authentication → Get started**, then
   enable these sign-in providers (under "Sign-in method"):
   - **Anonymous** — lets each device play/sync without an account.
   - **Google** — for "Sign in with Google."
   - **Email/Password** — for the email + password option.
   For Google, you may need to set a "public-facing name" and support email
   the first time — any values work, it's just for the consent screen.
3. In the left sidebar: **Build → Firestore Database → Create database**.
   Choose **production mode**, pick any region, and create it.
4. Once created, go to the **Rules** tab of Firestore and replace the
   contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /players/{uid} {
         allow read: if true;
         allow write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
   This makes the leaderboard publicly readable, but each player can only
   ever write their own rating — publish that with the **Publish** button.
5. Back in **Project settings** (gear icon, top left) → **General** → scroll
   to "Your apps" → click the **</>** (web) icon to register a web app
   (nickname doesn't matter, skip Firebase Hosting). It'll show you a
   `firebaseConfig` object.
6. Open `firebase-config.js` in this project, paste those six values in,
   and change `firebaseEnabled` to `true`.
7. Still in **Authentication → Settings → Authorized domains**, click
   **Add domain** and add your GitHub Pages domain (e.g.
   `your-username.github.io`). Without this, Google/email sign-in will fail
   with an "unauthorized domain" error once deployed (it works on
   `localhost` by default, which is why it can seem fine while testing
   locally and then break after deploying).
8. Redeploy (push to GitHub, or just refresh if testing locally). The home
   screen's Account card will show sign-in options, and the Leaderboard
   card will start showing real data.

**Worth knowing:** everyone starts as an anonymous player (so casual local
play still syncs a rating). Signing in with Google or email *upgrades* that
same session to a real account rather than starting a new one, so your
existing rating carries over. If someone signs into an email/Google account
that already exists (from another device), that pre-existing account's own
rating is what loads — which is the correct behavior, just worth knowing.

## Deploy to GitHub Pages

1. Create a new repository on GitHub and push these files to it:

   ```bash
   git init
   git add .
   git commit -m "Oakwood Chess"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. On GitHub, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch",
   pick the **main** branch and the **/ (root)** folder, then save.
4. GitHub will publish the site at
   `https://<your-username>.github.io/<your-repo>/`. It can take a minute or
   two to go live the first time.
5. Share that link with a friend — when one of you clicks "Create a room"
   and sends the generated room link, you can play from anywhere, not just
   the same PC.

Any other static host works the same way (Netlify, Vercel, Cloudflare Pages,
a plain S3 bucket) — there's no server-side code to configure.

## Project structure

```
index.html        Page structure
style.css         Visual design
main.js           Screens, board rendering, move handling, game state
multiplayer.js    Thin wrapper around PeerJS for the online room
clock.js          Per-player countdown clock
storage.js        localStorage helpers (resume, history, profile/rating)
leaderboard.js    Optional shared leaderboard (Firebase Firestore)
firebase-config.js  Your Firebase project config (edit this — see above)
manifest.json     PWA manifest (name, icons, colors)
sw.js             Service worker — offline app-shell caching
icons/            App icons + favicon (placeholder — see below)
vendor/chess.js   Move generation & rules (chess.js, vendored, MIT/BSD)
vendor/peerjs.min.js   WebRTC peer connections (PeerJS, vendored, MIT)
```

## Using your own logo / icon

`icons/` currently has a placeholder (a knight glyph on the app's green).
To swap in your own game icon:

1. Replace `icons/icon.svg` with your artwork, or just drop in your own
   square PNG/JPG.
2. Regenerate the sized copies (192×192, 512×512, a 180×180 Apple touch
   icon, and a 32×32 favicon) — any image tool works, or if you have
   Node + `sharp` installed:
   ```bash
   node -e "
   const sharp = require('sharp');
   const src = 'path/to/your-logo.png';
   sharp(src).resize(192,192).toFile('icons/icon-192.png');
   sharp(src).resize(512,512).toFile('icons/icon-512.png');
   sharp(src).resize(180,180).toFile('icons/apple-touch-icon.png');
   sharp(src).resize(32,32).toFile('icons/favicon-32.png');
   "
   ```
3. Keep the same file names and `manifest.json`/`index.html` need no
   changes — they already point at these paths.

If you'd rather send me the actual image files, I can generate and drop in
all the sizes for you directly.

## Notes & limitations

- Online play needs both players' browsers to reach the public PeerJS
  broker (`0.peerjs.com`) to establish the connection; a very locked-down
  corporate/school network can sometimes block WebRTC.
- If your friend closes the tab, the game ends — there's no reconnect or
  saved-game state (by design, to keep this a small, serverless project).
- There's no built-in computer opponent — this is built for playing against
  a person, locally or online.
