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

## A shared database (for a real leaderboard)

Everything above is stored per-device in `localStorage` — there's no
account, and nothing is sent anywhere. That's simple and private, but it
means your rating on your phone and your rating on your laptop are two
different numbers, and you can't see a leaderboard with your friends.

To do that properly needs a small hosted database. Since this project is
static (no server of its own), the practical options are "backend-as-a-
service" platforms that a static site can talk to directly:

- **Firebase (Firestore)** — free tier, easiest to wire into a static site,
  good realtime support (handy for a "friends currently online" list later).
- **Supabase** — free tier, Postgres-based, similar effort.

Either needs you to create a free project (no credit card) and paste a
handful of config values into this app. I can wire up the actual code —
schema, sync logic, a global leaderboard screen — once you tell me which
one you'd like, or just say "pick one" and I'll go with Firebase.

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
