// Thin wrapper around Stockfish running as a Web Worker. Stockfish speaks
// UCI (a plain text protocol) over postMessage — this class handles the
// handshake and gives callers a simple evaluate(fen) => Promise API, with a
// live callback for the depth-by-depth "info" lines so a caller can update
// an eval bar as the search deepens rather than only at the very end.

import { parseUciLine, toWhiteRelative } from "./eval-math.js";

export class Engine {
  constructor(workerUrl) {
    this.worker = new Worker(workerUrl);
    this.ready = new Promise((resolve, reject) => {
      const onMessage = (e) => {
        const line = typeof e.data === "string" ? e.data : "";
        if (line === "uciok") {
          this.worker.postMessage("isready");
        } else if (line === "readyok") {
          this.worker.removeEventListener("message", onMessage);
          resolve();
        }
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", reject);
      this.worker.postMessage("uci");
    });
    this._pending = null; // the one evaluate() currently talking to the engine
    // Every evaluate() call chains onto this, so a second call made before
    // the first's bestmove arrives waits its turn instead of racing it —
    // otherwise a late bestmove from an old search could resolve the wrong
    // caller's promise. Since we search to a fixed depth (not "infinite"),
    // queuing is simple and correct; each call still finishes on its own.
    this._chain = Promise.resolve();
    this.worker.addEventListener("message", (e) => this._handleMessage(e));
  }

  evaluate(fen, options = {}) {
    const result = this._chain.then(() => this._runEvaluate(fen, options));
    // Swallow rejections in the chain itself so one failed evaluation
    // doesn't permanently jam the queue for later calls; callers still see
    // their own call's real outcome via the returned `result` promise.
    this._chain = result.catch(() => {});
    return result;
  }

  async _runEvaluate(fen, { depth = 12, onProgress } = {}) {
    await this.ready;
    const sideToMove = fen.split(" ")[1] === "b" ? "b" : "w";
    return new Promise((resolve) => {
      this._pending = { sideToMove, onProgress, resolve, lastScore: null };
      this.worker.postMessage("ucinewgame");
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  _handleMessage(e) {
    if (!this._pending) return;
    const line = typeof e.data === "string" ? e.data : "";
    const parsed = parseUciLine(line);
    if (!parsed) return;

    if (parsed.type === "info") {
      const relative = toWhiteRelative(parsed.score, this._pending.sideToMove);
      this._pending.lastScore = relative;
      this._pending.onProgress?.({ depth: parsed.depth, score: relative });
    } else if (parsed.type === "bestmove") {
      const finished = this._pending;
      this._pending = null;
      finished.resolve({ move: parsed.move === "(none)" ? null : parsed.move, score: finished.lastScore });
    }
  }

  terminate() {
    this.worker.terminate();
  }
}
