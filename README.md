# Oakwood Chess

A small, self-contained chess app: play locally, against a built-in bot, or
with a friend online. No backend server to run — it's a handful of static
files.

## Getting around

- **Mobile:** a bottom bar — Home, Learn, Puzzles, Friends, Watch, Account. During
  a game it switches to the game toolbar (Flip · Undo · Resign · New game · Home).
- **Desktop:** a left sidebar with the same six sections.
- **Ways to play** (everywhere): **Play Bots** (the computer), **Play a Friend**
  (an online room, or an invite to someone on your friends list), **Play in
  Person** (two players on one board, one device), **Play Coach**, and **Online**
  (the lobby of open games).
- **Phone Home** works like chess.com's app: a hub with **Play Bots** and **Play
  Coach** shortcuts, your **Friends** row, and a big green **Play** button. **Play**
  opens **New Game**: a time-control button (opens a **Time** sheet grouped as
  Untimed / Bullet / Blitz / Rapid), a green **Start Game**, and a list — Play a
  Friend, Play Bots, Play Coach, Play in Person, Play Online. Each opens its own
  screen; the phone's Back button steps back one screen. *Start Game* looks for an
  opponent online when the shared database is set up, and otherwise starts a bot
  game (it says which under the button).
- **Desktop Home** is a dashboard: a hero with the big **Play** button and a mode
  switcher (**Online · Play Bots · Play a Friend · Play in Person**), shortcut
  cards, and History. The button always says what it will start ("Play Bots ·
  1000 · White", "Play in Person · 3 | 2"). Rating, sign-in and the leaderboard live
  under **Account**; lessons under **Learn**.
- **Puzzles** have their own button in the bottom navigation (side navigation on wide screens); see *Puzzles* below.
- **Back on Home asks first** (an "Exit Oakwood Chess?" popup). Pulling the page
  down no longer refreshes it, so a stray swipe can't throw you out of a game.
- **The game page** is built to fit one phone screen with no scrolling. On a
  phone the move strip sits *above* the board and the board is placed so its
  middle is the middle of the screen (it only shrinks if a very short screen
  couldn't otherwise fit everything above and below it):
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
- **Play in Person:** two players, one board, one device — pass the device back
  and forth, taking turns clicking the board.
- **Play Bots:** pick a bot level — nine rungs from 250 to 1800,
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
- **Play a Friend (room):** open *Play a Friend* and press the button, then share
  the code or link. When they open it, you're connected and playing. You're
  White, they're Black. (With friends set up, you can instead invite someone from
  your list — see *Friends and challenges*.)

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

## Friends and challenges

Needs the shared database (Firebase, see below) and a username (Account).

- **Friends tab** (bottom bar / sidebar): **Add a friend** by typing their username.
  They get a request to accept (you appear under *Friend requests* until they do;
  if they had already asked you, you simply become friends). Your friends list shows
  each friend's rating, with **Invite** and **Remove**. A red badge on the tab
  counts requests and invites waiting for you.
- **Invite a friend to a game:** tap **Invite** (on the Friends tab, or in *Play a
  Friend*). Oakwood opens a room for you with the time control picked on Home and
  sends your friend an invite that **carries the room code**, so they never type it.
- **The popup:** while the app is open, your friend sees "*NAME invited you to play*"
  with **Accept** / **Decline**. Accept connects them to your room and starts the
  game. If they decline you're told, and the room stays open for a link. If you
  leave the room first, the invite is withdrawn and their popup closes.
- **Challenges tab** (inside Friends): **Invited to play** (accept or decline) and
  **Invites you sent** (cancel). If you were busy in a game when the invite came,
  there is no popup — it waits here, with the badge on the tab.
- **Limits:** invites only reach someone who has the app **open** (there are no
  push notifications when it is closed). An unanswered invite expires after 10
  minutes. You can only invite accepted friends, and an invite and the room it
  points to are only readable by the two of you.
- The game itself is the same peer-to-peer connection as any room, so the notes in
  *When a friend can't connect* apply to it too.

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

### When a friend can't connect

- **Try again.** If the connection fails, or nothing happens for 20 seconds, the
  joining screen says why in plain words and shows **Try again**. If the host loses
  the matchmaking server, they get **Try again** too (it opens a fresh room with the
  same settings).
- **A failed attempt no longer blocks the next one.** Before, a try that never
  finished kept the host's seat, so the retry was refused with "This room already
  has two players". A newer attempt now takes over a seat that never connected.
  A friend who is *already connected* still holds the seat.
- **A brief loss of the matchmaking connection no longer splits the game.** The
  joining browser used to open a second connection when it reconnected, and its
  moves went down the one the host ignores. It now keeps the one it has.
- **Updates wait for you.** A new version of the app no longer reloads the page while
  you are in a room or a game (or on a first visit through a room link); it applies
  once you are back on Home.
- **What "Still can't connect" means.** The matchmaking server found the other
  phone, but the two could not open a direct data path. That is almost always a
  network issue: phones on different mobile networks or on Wi-Fi with client
  isolation (many carriers share one address between many phones). The fix is a
  **relay (TURN) server**, which carries the game when a direct path is impossible.
- **Connection check.** When a connection fails, the message now ends with a
  check: either "a relay server is reachable from this phone, so trying again can
  work" or "this phone could not reach any relay server". The second means
  connections to people on other networks will keep failing until you add a relay
  you control (below).
- **Using a relay you control (recommended).** The app ships with PeerJS's and Open
  Relay's free public relays, but free public services can be limited or withdrawn.
  A game is a few kilobytes, so even a small free allowance lasts for a very long
  time. For example, with a free [Metered](https://www.metered.ca/tools/openrelay/)
  account (its Open Relay page advertises 20 GB of free relay traffic a month; its
  general pricing page lists a smaller free trial — check what your account gets):
  1. Sign up, then open the TURN credentials in the dashboard and copy the server
     addresses plus your username and password.
  2. In `multiplayer.js`, fill `CUSTOM_ICE_SERVERS` near the top, copying the
     addresses exactly as the dashboard shows them, e.g.
     ```js
     const CUSTOM_ICE_SERVERS = [
       { urls: "turn:global.relay.metered.ca:80", username: "YOUR-USERNAME", credential: "YOUR-PASSWORD" },
       { urls: "turn:global.relay.metered.ca:443", username: "YOUR-USERNAME", credential: "YOUR-PASSWORD" },
       { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "YOUR-USERNAME", credential: "YOUR-PASSWORD" },
     ];
     ```
  3. Bump `CACHE_NAME` in `sw.js`, deploy, and have **both** players reopen the app.
  4. Both phones must be on the new version. The credentials are visible to anyone who
     views the page source, so use a free account with a usage cap. Any TURN provider
     works the same way (a Cloudflare, Twilio or self-hosted `coturn` account too).

## Online (play someone you haven't met)

Needs Firebase (the Online tab shows 🔒 until it's configured). Press
**Play** on the Online tab: it joins the longest-waiting open game with your
time control, or opens a room and waits, listed under **Open games** so
others can join it too. You can also pick a game from that list yourself.
A listing disappears the moment someone joins or you cancel. This is a
simple lobby, not rating-based matchmaking — you get whoever's waiting.

## Watching games (spectators)

Online games can be watched live, read-only — and it's **private and opt-in**:

- **Off unless the host ticks it.** The host ticks *Let others watch this game*
  when creating the room. Nothing is open to watchers before the game starts.
- **Its own code.** Watching uses a separate **6-character watch code**
  (`…/?watch=CODE`), shown on the game page: in a chip at the top left (tap it to
  copy the link) and in the host's spectator controls (on a phone, the **Watch**
  button in the toolbar; on desktop, the card beside the board). The code players
  use to *join* the room is never shared with watchers, so a watch link can't be
  used to play; and a watch code can't move pieces or chat (it is a separate,
  read-only connection). An old watch link made from a room code no longer works
  and says so.
- **Private by default.** Only people given the link or code can watch. To make a
  game findable, the host also ticks *Also list it in the Watch tab* (only offered
  when Firebase is configured). Listings use the watch code and disappear when the
  game ends, the host leaves, or the host stops spectators.
- **The host stays in control.** The host sees how many are watching, and can tap
  **Stop spectators** at any time: everyone is disconnected and the code stops
  working. **Allow spectators** later gives a brand-new code. The host can also
  allow spectators in the middle of a game that started without them.
- **Viewers** open the link, or go to **Watch → Watch with a code** and type the
  code (spaces and lower case are fine).
- Spectators see the current position (even if they join mid-game), moves,
  the move list and chat; they can't move, chat, or affect the game. A third
  person opening an invite link to a full room is turned away.
- Spectated games aren't saved to the spectator's history or rating.
- You can also browse back through a game you're watching (‹ ›) without
  losing your place when new moves arrive.
- If a spectator can't connect after about 15 seconds, the screen explains the
  usual reasons (host doesn't allow spectators, game over, a wrong code, networks
  that can't reach each other) and offers *Try again*.
- **Analysis board:** tap *Analysis board* to try moves for **both** sides on
  your own copy of the current position. Nothing is sent to the players, and
  the live game carries on underneath (you're told how many moves you've
  missed). *Undo test move* steps back; *Back to live* returns.
- **Emoji reactions** (👏 🔥 👑 😱): a spectator's tap floats up on
  **spectators' screens only**. It travels spectator → host → *other
  spectators*; the host never relays it to the opponent and never draws it on
  their own screen, so the players aren't distracted. The host accepts only
  those four emojis, rate-limited per spectator.
- **Voice commentary:** spectators hear short announcements through the
  browser's speech synthesis — book moves ("e4 is a book move"), brilliant /
  great moves, mistakes and blunders, check and checkmate — with the same line
  shown on screen. The 🔊 Voice button turns it off. Commentary uses the
  engine at a small depth, so treat it as a friendly guide.
- **If the Watch tab always shows nothing**, check the Firestore rules
  below. The `liveGames` rule must be published, or hosts can't list their
  games and the list can't be read. The app now says so: a host whose
  listing is refused sees a warning, and the Watch tab explains the missing
  rule instead of showing an empty list. (A game also only appears once
  the opponent has joined, and only if the host ticked *Also list it in the Watch tab*.)
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
- **Where a profile lives.** `users/{uid}` is the account's own profile
  (name, rating, games), keyed by the Firebase uid so the same Google account
  shows the same username on every device; it's private to the owner.
  `usernames/{name}` locks the handle (written in the same transaction), and
  `players/{uid}` is a public copy the leaderboard reads. Older profiles that
  only exist in `players/` are copied into `users/` the first time they're
  seen.
- **The saved profile wins.** On page load, after sign-in, and when the app
  returns to the foreground, the account's saved name/rating replace this
  device's cached copy. A device with an out-of-date cache can no longer rename
  the account when it syncs a rating.
- **Account ID.** The Account screen shows the last six characters of your
  account ID. If two devices show different IDs they are *not* the same
  account (sign out on one and sign in again). Opening the Account screen
  always re-reads the saved profile. If the `users` rule isn't published yet,
  sync still works through `players/`, and the Account screen says the rules
  need updating.
- **Signing into an existing account from a second device** uses the
  credential from the first attempt (no second popup, which phones tend to
  block), and releases the abandoned guest's username and leaderboard row.
- Without Firebase configured, all of this still works exactly as before —
  purely local, no account, no shared leaderboard.

## Game Review

After a game you played (local, vs computer or online) a **Review** button
appears in the game toolbar (and a **Game Review** button on any saved game's
replay). It works in two steps, like chess.com:

1. **Summary** — the coach, the evaluation graph (tap it to jump to a move),
   each side's accuracy, and how many moves of each kind were played.
2. **Step through** — the coach's bubble above the board, a badge on the move's
   square, a green arrow showing the better move after a mistake, the move
   strip, and **Back / Best / Flip / Voice / Next**.

Every move gets one of ten labels: Brilliant (!!), Great (!), Best (⭐),
Excellent (👍), Good (✔️), Book (📖), Inaccuracy (?!), Mistake (?), Miss (❌),
Blunder (??). Mistakes get a plain-words reason where one can be spotted:
*Hanging Piece, Fork, Fork Missed, Pin, Free Piece Missed, Missed Checkmate,
Walked into Checkmate*. Openings (Italian Game, London System, Dutch Defense,
Sicilian Defense and about fifty more lines) come from `openings.js`, which
also accepts UCI or PGN move text.

- **Voice** reads each move note aloud with `speechSynthesis` ("e4 is a book
  move", "Blunder!"); the 🔊 button turns it off.
- **Evaluation bar** beside the board shows who is ahead (white share grows from
  the bottom, with the score at the leading end; `#3` means mate in 3). It
  appears **only in Game Review** — never during a game, while spectating, or in
  puzzles.
- **Engine lines**: the engine's top three lines for the position, with scores
  and numbered moves. **Blue arrow** = the engine's suggestion; **red arrow** =
  the threat (what the other side would do if it could move; searched on demand
  and not shown while you're in check); **green arrow** = the better move after
  a mistake.
- **Retry**: on any inaccuracy/mistake/miss/blunder, tap *Retry* to play the
  position from just before it and find a better move yourself (any move about
  as good as the best is accepted).
- **Tap a row in the summary table** (e.g. *Blunder*) to jump to those moves one
  after another. The summary also shows average centipawn loss and accuracy by
  phase (opening / middlegame / endgame), and the smoothed evaluation graph.
- **Options** (⚙ in the header): Quick Analysis (off = deeper, slower; applies to
  the next review), Show Evaluation Bar, Suggestion Arrows, Threat Arrows,
  Engine Lines, Move Feedback. Saved on the device.
- **The coach explains like a teacher.** For each move you get the move's name
  ("The knight jumps to f3."), the idea behind it, and — for a mistake — what
  went wrong and what to look for next time. `coach.js` recognises: fork, pin,
  skewer, discovered attack, discovered check, double check, back-rank mate,
  smothered mate, zwischenzug (in-between move), desperado, sacrifice,
  promotion/underpromotion, en passant, free piece, trade, recapture, hanging
  pieces, and opening ideas (developing, central pawns, castling, moving the
  same piece twice, early queen, king walks). Book moves also say which opening
  it is and why it's played (`openings.js` has about 90 lines with explanations).
  Options (⚙) → **Coach explains for: Kids / Adults** changes the wording
  (simple words vs. proper terms). The summary screen has a few warm sentences
  about the whole game, a turning point, and one tip based on the mistakes made.
  Spectator voice commentary names tactics the same way.
- **The coach's face reacts.** Pictures go in `icons/` — about 256 × 256 px,
  square, transparent background: `coach_neutral.png` (book moves, good moves,
  inaccuracies), `coach_happy.png` (best / great / brilliant / excellent),
  `coach_shocked.png` (mistakes, misses, blunders) and `coach_thinking.png`
  (while the coach is thinking about his own move or a hint). A new reaction
  makes the face hop (happy) or shake (shocked). There is no talking animation.
  Missing pictures are handled: no shocked picture → the neutral one shakes with
  a red glow; no thinking picture → neutral; no neutral picture → the drawn face.
- **The voice** uses the phone's built-in speech. Phones often default to a
  woman's voice, so the coach picks a man's voice when the phone lists one by
  name (Windows, Mac, iPhone and some Android voices do), and lowers the pitch
  when it doesn't. You can choose any installed English voice (or turn speech
  off) on the Play Coach setup screen and in the review options.
  **Android Chrome only lists one entry per language** ("English India"), not
  individual voices, so the app can't tell which is a man's. There the picker
  says "Auto (phone's voice)" and a note explains how to change the voice in
  the phone's own Settings → Text-to-speech.
- **Engine.** Moves are scored by **Stockfish 16** (WebAssembly, single-threaded,
  in a Web Worker — `stockfish.js` drives it over UCI). The two files
  `stockfish-nnue-16-single.js` and `.wasm` live in the **top-level**
  `vendor/stockfish/` folder, directly beside `index.html` (not only inside
  `eval-bar-demo/`). If that folder is missing, the copy in
  `eval-bar-demo/vendor/stockfish/` is used instead; if neither exists the app
  falls back to the built-in engine and the review says exactly which two paths
  it looked in. If those files are missing or the browser can't run them, review falls
  back automatically to the app's own small engine (`bot.js`) — it still works,
  but with a few moves of lookahead instead of Stockfish's; the summary says
  which engine did the work — and when it fell back, the summary says so in a
  warning and says why Stockfish couldn't start. `analysis.js` exposes
  `setEngine()` to swap engines.
  Single-threaded on purpose: the multi-threaded builds need
  cross-origin-isolation headers that GitHub Pages can't send.

## Puzzles

The **🧩 Puzzles** button in the navigation opens three puzzle types:

- **Pawn Race** — kings and pawns only; the first to promote a pawn to a queen
  wins. Play the computer or a friend on the same device.
- **Knight's Tour** — tap a square to place a knight, then visit every square
  once; visited squares are numbered. Undo and Restart are available.
- **Daily limit: 5 puzzles a day.** A puzzle uses one slot when you make its
  first move (looking, leaving, or retrying after a wrong answer is free). The
  count is per device and per local calendar day; clearing the browser's site
  data resets it.
- **Checkmate Puzzles** — filter by *Mate in 1* or *Mate in 2*. The 65 puzzles
  in `puzzle-data.js` were found in bot-vs-bot games and proven by brute-force
  search; for mate in 2 any move that really forces mate is accepted, not just
  the stored one.

## Play Coach

The **Play Coach** box on Home (just above Share) opens a setup screen like
chess.com's: pick the coach's level (New to Chess 400 … Strong 1900; the default,
**Intermediate 1100**, is meant to feel like a 1000–1200 player), pick White,
Random or Black, choose the voice, and press Play. You play a normal game against
Stockfish while the coach talks to you:

- **After every move of yours** the coach's face turns thoughtful while Stockfish
  judges it (the same Brilliant … Blunder judgement as Game Review), then a speech
  bubble gives feedback — the move's name, the idea, and for a mistake what went
  wrong and the better move — and the voice reads it aloud.
- **After a real mistake the game pauses.** The coach says what he can now do
  ("Take a look. I can now take your undefended bishop."), a red arrow shows it,
  and you choose **Continue** or **Retry** (take the move back and try again).
- **The coach comments on his own moves** in the first person ("I capture back!",
  "Protecting my pawn.", "Fork!").
- **Opening stories.** When the game enters a named opening — yours or his — the
  coach tells you its name and where it comes from ("You're playing the Sicilian
  Defense — named after the Italian island of Sicily…"). Each story is told once.
  Origins live in `openings.js`; only names with a reliable history are included.
- **The board never moves.** On a phone the coach's speech area has a fixed
  height (164 px; 120 px on short screens), so short or long dialogue can't push
  the board up or down. Longer comments scroll inside it: a new comment on your
  move starts at the top, the coach's reply scrolls into view, and Continue /
  Retry stay pinned at the bottom.
- **Toolbar:** Undo (takes back your move and his reply), Hint (draws the engine's
  best move and explains it), Resign. There is no evaluation bar during a game.
- **When it ends** a result card shows who won and how, the coach's comment, how
  many Great / Best / Excellent moves you played, and buttons for **Game Review**,
  **New Game** and **Rematch**. Coach games are for practice: they don't change
  your rating.
- **Strength.** Each level maps to a Stockfish *Skill Level* (0–20) and a limit on
  how many moves ahead it may look (`eloToLimits` in `coach-game.js`: 400 → skill
  0, 1100 → 8, 1900 → 17). In test games the levels are properly ordered (1900
  beats 1100, 1100 beats 400), but the Elo numbers are labels, not measured
  ratings. If Stockfish can't start, the built-in bot is used instead.

## Online clocks

Each phone judges only **its own** clock. Every move carries the mover's remaining
time, and each phone also reports its own running clock every few seconds, so the
two screens stay in step even when messages arrive late. If a phone sees the
**other** player's clock reach 0 it does not end the game: it asks the other
phone, shows "Checking your friend's clock…", and carries on with the time that
phone reports. Only if the other phone doesn't answer for 8 seconds does it claim
the win on time. (Before this, each phone ran both clocks on its own, so a late
message could end a game while the other player still had time on their clock.)
Both players need the current version of the app. Time while a phone is asleep or
in the background is not charged to that player.

## Learn

The Learn tab has topic chips: **Basics** (how the pieces move), **Tactics**
(20, nine with example boards — tap *Show the move*), **Checkmates** (back-rank,
smothered, queen-and-king, ladder, Scholar's and Fool's mate), **Openings**
(about 70 named openings: tap one to step through the moves, see the idea in
kid and adult wording, and who plays it), **Strategy** (opening principles,
piece values, check-capture-threat, king safety, pawn structure, learning from
Kasparov and Carlsen), **Endgames**, **Famous games** (ten: Opera Game, Immortal
Game, Kasparov–Topalov 1999, Kasparov–Deep Blue game 6, Byrne–Fischer 1956,
Karpov–Kasparov 1985, Aronian–Anand 2013, Ivanchuk–Yusupov 1991, Short–Timman
1991, Rotlevi–Rubinstein 1907 — step through with notes, or open the coach's
Game Review) and a **Glossary**. All content lives in
`learn-data.js` and `openings.js`; every example position and game is checked
by the test suite.

## Moving pieces

Tap a piece, then a square — or **drag** like chess.com: an enlarged piece
follows your finger (held above it so it isn't hidden), a grey halo marks the
square you're over, and the legal-move dots show. Dropping on a square does what
tapping it would, so every rule check is the same. Works on the game board, the
spectator analysis board, Retry and the puzzles.

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
- **Look.** A light theme: cream page (`#F5F3E9`), white cards, green accents
  (`#477747`, highlight `#8FBE62`), dark-green text (`#243326`), and the board in
  `#F0EED2` / `#769656`. The colours are CSS variables at the top of `style.css`.
  The Home screen opens with a hero (the Oakwood logo, tagline and the Play
  button, with a faint king-and-knight drawing behind), and soft oak-leaf
  corners sit behind Home, Learn, Watch and Account. Their art is in `assets/`;
  the drawing's strength is `.chess-decoration { opacity }` in `style.css`.


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

       // The account's own profile (name, rating, games), keyed by the Firebase
       // uid so the same account sees the same profile on every device. Private:
       // only the owner can read or write it.
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }

       // Public copy of name/rating/games for the leaderboard. Anyone can read
       // (leaderboard); you can only write your own.
       match /players/{uid} {
         allow read: if true;
         allow write: if request.auth != null && request.auth.uid == uid;
       }

       // Unique usernames. Only the owner can create/change/delete an entry,
       // so nobody can steal or overwrite someone else's name.
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

       // Online tab lobby: rooms waiting for an opponent.
       match /openGames/{code} {
         allow read: if true;
         allow create: if request.auth != null
                        && request.resource.data.hostUid == request.auth.uid;
         allow update, delete: if request.auth != null
                        && resource.data.hostUid == request.auth.uid;
       }

       // Watch tab: games the host chose to let others watch.
       match /liveGames/{code} {
         allow read: if true;
         allow create: if request.auth != null
                        && request.resource.data.hostUid == request.auth.uid;
         allow update, delete: if request.auth != null
                        && resource.data.hostUid == request.auth.uid;
       }

       // Friends. The document id is "{fromUid}_{toUid}". Only the two people involved
       // can see it. The person asked can accept it (the one allowed change, to
       // "accepted"); either of them can delete it (decline, cancel, or unfriend).
       match /friendRequests/{id} {
         allow read: if request.auth != null
                      && (resource.data.fromUid == request.auth.uid
                          || resource.data.toUid == request.auth.uid);
         allow create: if request.auth != null
                        && request.resource.data.fromUid == request.auth.uid
                        && request.resource.data.toUid != request.auth.uid
                        && request.resource.data.status == 'pending'
                        && id == request.auth.uid + '_' + request.resource.data.toUid;
         allow update: if request.auth != null
                        && resource.data.toUid == request.auth.uid
                        && request.resource.data.status == 'accepted'
                        && request.resource.data.fromUid == resource.data.fromUid
                        && request.resource.data.toUid == resource.data.toUid;
         allow delete: if request.auth != null
                        && (resource.data.fromUid == request.auth.uid
                            || resource.data.toUid == request.auth.uid);
       }

       // "Come and play me" invites between friends. They carry the room code, so
       // only the sender and the invited friend can read one. An invite can only be
       // sent to someone who has accepted you as a friend.
       match /challenges/{id} {
         allow read: if request.auth != null
                      && (resource.data.fromUid == request.auth.uid
                          || resource.data.toUid == request.auth.uid);
         allow create: if request.auth != null
                        && request.resource.data.fromUid == request.auth.uid
                        && request.resource.data.toUid != request.auth.uid
                        && request.resource.data.status == 'pending'
                        && ((exists(/databases/$(database)/documents/friendRequests/$(request.auth.uid + '_' + request.resource.data.toUid))
                             && get(/databases/$(database)/documents/friendRequests/$(request.auth.uid + '_' + request.resource.data.toUid)).data.status == 'accepted')
                            || (exists(/databases/$(database)/documents/friendRequests/$(request.resource.data.toUid + '_' + request.auth.uid))
                             && get(/databases/$(database)/documents/friendRequests/$(request.resource.data.toUid + '_' + request.auth.uid)).data.status == 'accepted'));
         // The invited friend answers (accepted / declined); the sender can cancel.
         // Nobody can change who it is between, or the room code.
         allow update: if request.auth != null
                        && request.resource.data.fromUid == resource.data.fromUid
                        && request.resource.data.toUid == resource.data.toUid
                        && request.resource.data.roomCode == resource.data.roomCode
                        && ((resource.data.toUid == request.auth.uid
                             && request.resource.data.status in ['accepted', 'declined'])
                            || (resource.data.fromUid == request.auth.uid
                                && request.resource.data.status == 'cancelled'));
         allow delete: if request.auth != null
                        && (resource.data.fromUid == request.auth.uid
                            || resource.data.toUid == request.auth.uid);
       }
     }
   }
   ```
   `openGames` is the Online tab's lobby of rooms waiting for an opponent.
   `liveGames` is the Watch tab's list of games hosts have opted to share
   (only the host who listed a game can change or remove it).
   `friendRequests` holds friend requests and, once accepted, friendships (the
   document id is `<fromUid>_<toUid>`; only those two people can read it, only the
   person asked can accept, and either can delete it). `challenges` are the "come
   and play me" invites: only the sender and the invited friend can read one, an
   invite can only be created for an accepted friend, and the roles are fixed (the
   friend can accept or decline, the sender can cancel).
   `users` is the account's private profile; `players` is its public copy for
   the leaderboard (name, rating); `usernames` is a separate
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
5. Share that link with a friend — when one of you opens **Play a Friend**
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
bot.js            Offline computer opponent (minimax + alpha-beta); also the fallback review engine
stockfish.js      Stockfish (WebAssembly) driven over UCI, with MultiPV and live evaluation
coach.js          What each move does (tactics, ideas) and the teacher-style wording (kids / adults)
coach-avatar.js   The coach's face: expressions per move, talking animation
learn.js          The Learn tab renderer (small boards, steppers)
coach-game.js     Play Coach: levels, live judging, hint/undo/retry, result card
learn-data.js     Learn content: tactics, mates, strategy, endgames, glossary, famous games
vendor/stockfish/ stockfish-nnue-16-single.js + .wasm (Stockfish 16, single-threaded; top level, beside index.html)
analysis.js       Game Review engine: move labels, accuracy, kid-friendly reasons, coach text
analysis-worker.js  Runs the analysis off the main thread
openings.js       Opening names and "still in book" check (SAN / UCI / PGN)
review.js         Game Review screens (summary + step-through)
voice.js          Spoken commentary (speechSynthesis)
puzzles.js        Pawn Race, Knight's Tour and Checkmate puzzles
puzzle-data.js    The verified mate-in-1 / mate-in-2 positions
sound.js          Synthesized move/capture/check/game-end sound effects
storage.js        localStorage helpers (resume, history, profile/rating)
leaderboard.js    Optional shared leaderboard (Firebase Firestore)
firebase-config.js  Your Firebase project config (edit this — see above)
manifest.json     PWA manifest (name, icons, colors)
sw.js             Service worker — offline app-shell caching
assets/           Home hero art: logo, king-and-knight drawing, oak-leaf corners
icons/            App icons (normal + maskable), favicon, coach faces — see below
vendor/chess.js   Move generation & rules (chess.js, vendored, MIT/BSD)
vendor/peerjs.min.js   WebRTC peer connections (PeerJS, vendored, MIT)
```

## Using your own logo / icon

`icons/` holds the app icon in the sizes Android, iPhone and browsers need:

| File | Size | What it is |
|---|---|---|
| `icon-192.png`, `icon-512.png` | 192, 512 px | The normal icon (transparent rounded corners). Used on the page and by browsers. |
| `icon-maskable-192.png`, `icon-maskable-512.png` | 192, 512 px | **For Android's home-screen icon and splash screen.** Square, solid white, the logo kept inside the central safe zone. |
| `apple-touch-icon.png` | 180 px | iPhone home-screen icon (a full square, no transparency). |
| `favicon-32.png` | 32 px | Browser tab icon. |

**Why a separate maskable icon?** Android cuts the home-screen and splash icon
to a circle (or a squircle, depending on the phone). If the artwork runs to the
edge of the square, the edges are lost — that's the cut-off "OAKWOOD / CHESS"
splash screen. A maskable icon keeps everything that matters inside the
*safe zone*: a circle in the middle of the image with a diameter of 80% of the
width. Keep the logo (all of its letters) inside about **60% of the width**,
centred, on a solid background colour that goes all the way to the edges.

To use your own picture:

1. Start from a square PNG, at least 1024 × 1024. Make two versions:
   - **Normal:** your logo filling the square (transparent or coloured corners).
   - **Maskable:** your logo in the middle, about 60% of the width, on a
     solid, full-bleed background (white works well).
2. Save them at 192 × 192 and 512 × 512 as the four files above (plus a
   180 × 180 `apple-touch-icon.png` and a 32 × 32 `favicon-32.png`). Keep the
   same file names and nothing else needs to change.
3. Check the maskable one at <https://maskable.app/editor> (upload it and look
   at the circle). Keep every letter inside the circle.
4. Bump `CACHE_NAME` in `sw.js`.

**After changing icons or `background_color`, reinstall the app on the phone.**
Android saves the icon and splash colour when the app is added to the home
screen: remove the home-screen app, open the site in Chrome, and use *Add to
Home screen / Install app* again.

## Notes & limitations

- Online play needs both players' browsers to reach the public PeerJS
  broker (`0.peerjs.com`) to establish the connection; a very locked-down
  corporate/school network can sometimes block WebRTC.
- If your friend closes the tab, the game ends — there's no reconnect or
  saved-game state (by design, to keep this a small, serverless project).
- Game Review and spectator commentary use Stockfish when its files are in
  `vendor/stockfish/` (or the demo's copy), otherwise the built-in engine (see *Game Review*).
