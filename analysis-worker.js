// Runs the engine off the main thread so the page stays responsive while a
// game is being analysed. One message in ({id, fen, params}), one out.
import { analyzeFenSync } from "./analysis.js";

self.onmessage = (e) => {
  const { id, fen, params } = e.data;
  try {
    self.postMessage({ id, result: analyzeFenSync(fen, params) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
