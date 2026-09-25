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
storage.js        localStorage helpers (resume + history)
vendor/chess.js   Move generation & rules (chess.js, vendored, MIT/BSD)
vendor/peerjs.min.js   WebRTC peer connections (PeerJS, vendored, MIT)
```

## Notes & limitations

- Online play needs both players' browsers to reach the public PeerJS
  broker (`0.peerjs.com`) to establish the connection; a very locked-down
  corporate/school network can sometimes block WebRTC.
- If your friend closes the tab, the game ends — there's no reconnect or
  saved-game state (by design, to keep this a small, serverless project).
- There's no built-in computer opponent — this is built for playing against
  a person, locally or online.
