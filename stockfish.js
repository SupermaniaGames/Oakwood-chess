// Stockfish (WebAssembly build, single-threaded) running in a Web Worker,
// driven over UCI. Two kinds of request share the one engine:
//   - analyze(): a position's best few lines (MultiPV). These queue up and
//     each runs to completion — used by Game Review.
//   - evaluate(): "what's the score now?" for the live evaluation bar. A new
//     evaluate() stops the one before it, so the bar always catches up to the
//     latest position instead of working through a backlog.
//
// Files (copy from the eval-bar demo): vendor/stockfish/stockfish-nnue-16-single.js
// and its .wasm next to it. Single-threaded on purpose: the multi-threaded
// builds need cross-origin-isolation headers GitHub Pages can't send.

const DEFAULT_URL = "./vendor/stockfish/stockfish-nnue-16-single.js";

// UCI scores are from the side to move's point of view.
function parseInfo(line) {
  if (!line.startsWith("info ") || !/\bscore\b/.test(line) || !/\bpv\b/.test(line)) return null;
  const depth = Number((line.match(/\bdepth (\d+)/) || [])[1]);
  const multipv = Number((line.match(/\bmultipv (\d+)/) || [])[1] || 1);
  const sc = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!sc || !depth) return null;
  const pv = line.split(/\bpv /)[1].trim().split(/\s+/);
  return { depth, multipv, score: { type: sc[1], value: Number(sc[2]) }, pv };
}

export function createStockfish(url = DEFAULT_URL) {
  let worker = null;
  let failed = false;
  let multipvSet = 1;
  let job = null; // the search currently running
  const queue = [];

  const ready = new Promise((resolve, reject) => {
    const fail = (why) => {
      failed = true;
      reject(new Error(why));
    };
    try {
      worker = new Worker(url);
    } catch (e) {
      return fail("Worker blocked: " + e.message);
    }
    const timer = setTimeout(() => fail("Stockfish took too long to start"), 20000);
    worker.onerror = (e) => {
      clearTimeout(timer);
      fail("Stockfish failed to load" + (e && e.message ? ": " + e.message : ""));
      // anything already waiting should fail over, not hang
      if (job) job.reject(new Error("engine failed"));
      queue.splice(0).forEach((j) => j.reject(new Error("engine failed")));
    };
    const onMsg = (e) => {
      const line = String(e.data);
      if (line === "uciok") worker.postMessage("isready");
      else if (line === "readyok") {
        clearTimeout(timer);
        worker.removeEventListener("message", onMsg);
        resolve();
      }
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage("uci");
  });
  ready.catch(() => {});

  function onMessage(e) {
    if (!job) return;
    const line = String(e.data);
    if (line.startsWith("bestmove")) {
      const done = job;
      job = null;
      if (done.cancelled) done.resolve(null);
      else {
        const lines = [...done.lines.values()].sort((a, b) => a.multipv - b.multipv);
        done.resolve({ lines, best: line.split(/\s+/)[1] === "(none)" ? null : line.split(/\s+/)[1] });
      }
      pump();
      return;
    }
    const info = parseInfo(line);
    if (!info) return;
    job.lines.set(info.multipv, info);
    if (job.onProgress && info.multipv === 1) job.onProgress(info);
  }

  ready.then(() => worker.addEventListener("message", onMessage)).catch(() => {});

  function pump() {
    if (job || failed || queue.length === 0) return;
    job = queue.shift();
    if (job.multipv !== multipvSet) {
      worker.postMessage(`setoption name MultiPV value ${job.multipv}`);
      multipvSet = job.multipv;
    }
    worker.postMessage(`position fen ${job.fen}`);
    worker.postMessage(`go depth ${job.depth} movetime ${job.movetime}`);
  }

  function submit(spec) {
    return new Promise((resolve, reject) => {
      ready.then(
        () => {
          queue.push({ ...spec, lines: new Map(), resolve, reject });
          pump();
        },
        (err) => reject(err)
      );
    });
  }

  return {
    ready,
    // Top `multipv` lines for a position, searched to `depth` or `movetime` ms,
    // whichever comes first.
    analyze(fen, { depth = 12, movetime = 1500, multipv = 3 } = {}) {
      return submit({ fen, depth, movetime, multipv, onProgress: null });
    },
    // The live score. Cancels whatever evaluate() was running or waiting.
    evaluate(fen, { depth = 14, movetime = 4000, onProgress } = {}) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].live) {
          queue[i].resolve(null);
          queue.splice(i, 1);
        }
      }
      if (job && job.live) {
        job.cancelled = true;
        worker.postMessage("stop");
      }
      return submit({ fen, depth, movetime, multipv: 1, onProgress, live: true });
    },
    terminate() {
      failed = true;
      if (worker) worker.terminate();
      worker = null;
      if (job) job.resolve(null);
      queue.splice(0).forEach((j) => j.resolve(null));
    },
    get failed() {
      return failed;
    },
  };
}
