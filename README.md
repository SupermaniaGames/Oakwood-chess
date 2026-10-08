# Oakwood Chess

A small, self-contained chess app: play locally, against a built-in bot, or
with a friend online. No backend server to run — it's a handful of static
files.

## Getting around

- **Mobile:** a bottom bar — Home, Learn, Watch, Account. During a game it
  switches to the game toolbar (Flip · Undo · Resign · New game · Home).
- **Desktop:** a left sidebar with the same four sections.
- **Home** is one big **Play** button plus a mode switcher —
  **Online · vs Computer · Local / Friend**. The button always says what it
  will start ("vs Computer · 1000 · White", "Local · 3 | 2"). History and
  Share sit below. Rating, sign-in and the leaderboard live under
  **Account**; lessons under **Learn**.
- **The game page** is built to fit one phone screen with no scrolling:
  opponent bar (with the pieces they've captured) above the board, you
  below it, a horizontal move strip, and the toolbar. The board has no
  border; rank numbers and file letters sit inside the squares in small
  type. ‹ › (or tapping a move) lets you look back through the game;
  any new move snaps back to live.
- **Back button:** during a live game it asks before leaving (and stays if
  you say no) instead of closing the game. From Learn / Watch / Account it
  returns Home. On Home it behaves normally.

## Play it

- **Pick a time control** before starting a local or online game: untimed,
  1, 3, 5, 10, 15 or 30 minutes, or with an increment — **3 | 2**, **5 | 3**,
  **15 | 10** (minutes | seconds added after every move you make). A friend
  room uses the time control you've selected; the Create button and the
  waiting screen both say which. *Both players need the current version of
  the app for the newer controls* — an older cached copy doesn't know them
  and will treat the game as untimed.
- **Locally on one PC:** click "Play locally, one board two players" and pass
  the device back and forth, taking turns clicking the board.
- **Vs the computer:** pick a bot level — nine rungs from 250 to 1800,
  grouped Beginner / Intermediate / Advanced — and which color you want,
  right on the home screen. It runs entirely offline. The Elo numbers are
  *nominal labels*: the ladder is tuned so each rung reliably beats the one
  below it, but it hasn't been calibrated against real rated play, so
  don't expect a "1200" bot to play exactly like a 1200-rated human.
  Weaker rungs make human-looking mistakes (they sometimes pick a
  reasonable-but-not-best move) rather than random ones.
- **Custom position (friend games):** tick "Set up a custom position first"
  before creating a room, tap pieces to remove them (kings always stay),
  then create the room — your friend starts from the same position.
  Rematches and replays use it too.
- **Online with a friend:** click "Create a room for a friend", then share
  the code or link. When they open it, you're connected and playing. You're
  White, they're Black.

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

## Online (play someone you haven't met)

Needs Firebase (the Online tab shows 🔒 until it's configured). Press
**Play** on the Online tab: it joins the longest-waiting open game with your
time control, or opens a room and waits, listed under **Open games** so
others can join it too. You can also pick a game from that list yourself.
A listing disappears the moment someone joins or you cancel. This is a
simple lobby, not rating-based matchmaking — you get whoever's waiting.

## Watching games (spectators)

Online games can be watched live, read-only — it's **opt-in per game**:
the host ticks "Let others watch this game live" when creating the room.

- Once the opponent joins, the host gets a **Copy watch link** button
  (`…/?watch=CODE`). Anyone with that link can watch — no Firebase needed.
- If Firebase is configured, the game is also listed under the **Watch**
  tab → *Live at Oakwood Chess*, so people can find it without a link.
  Listings disappear when the game ends or the host leaves.
- Spectators see the current position (even if they join mid-game), moves,
  the move list and chat; they can't move, chat, or affect the game. Games
  without the tick refuse spectators, and a third person opening an invite
  link to a full room is turned away rather than silently watching.
- Spectated games aren't saved to the spectator's history or rating.
- You can also browse back through a game you're watching (‹ ›) without
  losing your place when new moves arrive.
- **If the Watch tab always shows nothing**, check the Firestore rules
  below. The `liveGames` rule must be published, or hosts can't list their
  games and the list can't be read. The app now says so: a host whose
  listing is refused sees a warning, and the Watch tab explains the missing
  rule instead of showing an empty list. (A game also only appears once
  the opponent has joined, and only if the host ticked *Let others watch*.)
- Moves still travel peer-to-peer through the host's browser, so a game
  with many watchers uses the host's upload bandwidth, and the game ends
  for everyone if the host closes their tab.

## Account, rating & leaderboard

Everything about your identity now lives under the **Account** tab:

- **Username**: type one and tap **Check** to see if it's taken before you
  commit — usernames are unique (enforced by Firestore, not just the UI).
- **Rating**: a simple Elo rating (starts at 1200), updated after each
  *online* game based on your result and the opponent's rating at the time.
- **Sign in with Google or email** to carry your username and rating to any
  device. The first time you open the app (with Firebase configured), a
  welcome prompt offers sign-in or "continue as guest" — guests can still
  set a username and appear on the leaderboard, it just stays on that one
  device/browser until they sign in.
- Signing in **upgrades** your current guest session into a permanent
  account where possible, so your existing username/rating carry over
  rather than resetting. Signing into an account that already exists (from
  another device) pulls *that* account's real saved username and rating —
  this is also what fixes the old "username field is empty after signing in
  on my other device" issue: it used to read from local storage only, now
  it fetches your actual saved profile from Firestore on sign-in.
- Without Firebase configured, all of this still works exactly as before —
  purely local, no account, no shared leaderboard.

## Look & feel

- Pieces are proper vector artwork (the well-known "Cburnett" Staunton set
  used by most chess sites) instead of text glyphs, on the classic
  green-and-cream board. See the attribution note in `LICENSE` — this
  specific artwork is CC BY-SA 3.0, everything else in the project is MIT.
- The last move's from/to squares get a solid yellow highlight, matching
  chess.com's style, instead of a thin border.
- Sound effects for moves, captures, check, and game end — synthesized
  in-browser (no audio files to load), so nothing to fetch or license.
  There's a 🔊/🔇 toggle among the in-game buttons.
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
- **Undo:** in a local or bot game it's instant (vs a bot, it retracts both
  your move and the bot's reply). In an online game it's a request — your
  friend has to accept it, since it affects both of you.
- **Rematch:** local/bot restarts instantly; online sends a request the same
  way undo does, and swaps who plays White each time.
- **On mobile**, the action buttons (flip, undo, sound, resign, home) sit in
  a fixed bar at the bottom of the screen during play, like chess.com's —
  rather than in the scrolling sidebar, which was pushing things off-screen.
- **Leaving mid-game**: the Home button asks for confirmation if the game
  isn't finished, with wording that matches what actually happens (a local
  game is saved for later; a bot game is abandoned; an online game
  disconnects your friend).

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
       match /openGames/{code} {
         allow read: if true;
         allow create: if request.auth != null
                        && request.resource.data.hostUid == request.auth.uid;
         allow update, delete: if request.auth != null
                        && resource.data.hostUid == request.auth.uid;
       }
       match /liveGames/{code} {
         allow read: if true;
         allow create: if request.auth != null
                        && request.resource.data.hostUid == request.auth.uid;
         allow update, delete: if request.auth != null
                        && resource.data.hostUid == request.auth.uid;
       }
       match /usernames/{name} {
         allow read: if true;
         allow create: if request.auth != null
                        && request.resource.data.uid == request.auth.uid;
         allow update: if request.auth != null
                        && resource.data.uid == request.auth.uid
                        && request.resource.data.uid == request.auth.uid;
         allow delete: if request.auth != null
                        && resource.data.uid == request.auth.uid;
       }
     }
   }
   ```
   `openGames` is the Online tab's lobby of rooms waiting for an opponent.
   `liveGames` is the Watch tab's list of games hosts have opted to share
   (only the host who listed a game can change or remove it).
   `players` holds each account's rating; `usernames` is a separate
   lookup collection that's what actually makes usernames unique — claiming
   one writes a `usernames/<lowercased-name>` doc, and the rules above only
   let you create/change/delete an entry that's already yours, so nobody
   can steal or overwrite someone else's. Publish with the **Publish**
   button.
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
8. Redeploy (push to GitHub, or just refresh if testing locally). The
   Account tab will show sign-in options, and its Leaderboard will start
   showing real data.

**Worth knowing:** everyone starts as an anonymous player (so casual local
play still syncs a rating). Signing in with Google or email *upgrades* that
same session to a real account rather than starting a new one, so your
existing rating carries over. If someone signs into an email/Google account
that already exists (from another device), that pre-existing account's own
rating is what loads — which is the correct behavior, just worth knowing.

## Resetting the leaderboard

If you tested this before usernames were unique and now see duplicate or
"Anonymous" entries: the app already hides those in the display (it
de-duplicates by name and drops unnamed entries when rendering), but the
old, messy documents are still sitting in your actual database. I can't
reach into your Firebase project to clean it up myself — here's how to do
it from the console:

1. Firebase console → **Firestore Database** → **Data** tab.
2. Open the **players** collection. Click the **⋮** menu next to it (or
   select all documents) and choose **Delete collection** — this wipes
   every saved rating.
3. Do the same for the **usernames** collection, so old claimed names are
   released and can be picked again.
4. Everyone's rating resets to 1200 and the leaderboard starts empty. Local
   game history (on each device) is untouched — this only clears the shared
   Firestore data.

This shouldn't recur going forward: unnamed/anonymous profiles no longer
get written to the leaderboard at all, and usernames are only ever claimed
through the unique-checking path.

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
bot.js            Offline computer opponent (minimax + alpha-beta)
sound.js          Synthesized move/capture/check/game-end sound effects
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
