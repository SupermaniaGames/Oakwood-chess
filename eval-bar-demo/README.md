# Chess Eval Bar Demo

A complete, working example of a Lichess-style live evaluation bar: `chess.js`
handles the board/rules, Stockfish (compiled to WebAssembly) runs entirely in
your browser in a Web Worker — no server, no API key, no network calls once
the page is loaded.

## Run it

Like the main project, this needs to be served over `http://` or `https://`
(browsers block Worker/WASM loading from `file://`). From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it works

- **`eval-math.js`** — pure functions, no engine or DOM involved: parses a
  Stockfish UCI line (`info depth 14 ... score cp 35 ...`), converts the
  score to an absolute (White-positive) value, formats it as pawns
  (`+2.9`) or a mate count (`#3`), and maps it to a White-win-percentage
  using the same logistic curve Lichess uses for its bar — a ~1 pawn edge
  reads as a modest lean, not a near-certain win; several pawns compress
  toward the extremes.
- **`engine.js`** — wraps Stockfish as a `Worker` and speaks UCI to it:
  `uci` → `isready` → `position fen ...` → `go depth N`, resolving a
  promise with the final evaluation once `bestmove` arrives, with a
  progress callback for each depth along the way. Calls are queued rather
  than overlapped — if you move again before the previous evaluation
  finished, the new one waits its turn, so a result can never get attached
  to the wrong position.
- **`app.js`** — a minimal click-to-move board (auto-queens on promotion,
  to keep the example focused on the eval bar rather than a promotion
  picker) that re-evaluates after every move.

## Adjusting it

- **Search depth**: `SEARCH_DEPTH` in `app.js` (currently 14). Higher is
  stronger but slower — this build is single-threaded (see below), so
  there's a real tradeoff.
- **Bar sensitivity**: the constant `0.00368208` in
  `scoreToWhiteWinPercent` (`eval-math.js`) controls how quickly the bar
  swings toward the extremes as the score grows. Smaller = more sensitive
  to small edges; larger = flatter, only reacting to bigger swings.

## Limitations worth knowing

- **Single-threaded WASM.** Multi-threaded Stockfish builds are faster but
  need special cross-origin isolation HTTP headers (`Cross-Origin-Opener-Policy`
  / `Cross-Origin-Embedder-Policy`) that GitHub Pages can't set. This build
  avoids that entirely at the cost of raw speed — fine for casual analysis,
  not as fast as lichess.org's own engine pod.
- **I couldn't test the actual WASM execution end-to-end** in the environment
  I built this in (no browser available there) — I verified the UCI parsing,
  score math, and the request-queueing logic directly, and the engine
  integration follows the standard, widely-used pattern for this exact
  library, but please treat the first real run in your browser as a check,
  not a certainty. Open the browser console if the bar doesn't move — a
  wrong file path is the most likely culprit if something's off.
- **Mobile performance** will be noticeably slower than desktop at higher
  depths, since it's all running on the device's own CPU.

## License

Stockfish is licensed under **GPL-3.0**. This demo uses the official
`stockfish` npm package's precompiled single-threaded WASM build
(vendored in `vendor/stockfish/`) as a separate Worker process communicating
over UCI — the standard way essentially every website that embeds Stockfish
does it — rather than modifying or statically linking it. If you plan to
distribute this further, keep Stockfish's own license file alongside it.
`chess.js` is BSD-2-Clause.

## Using this inside Oakwood Chess

This is a standalone demo so it's easy to read and test on its own. If
you'd like the eval bar in the actual app (as an option during local/replay
viewing, say — it wouldn't make sense turned on for a live online game
against a friend), say the word and I'll wire it in using the same files.
