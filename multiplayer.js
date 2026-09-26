// Minimal peer-to-peer room using PeerJS's free public broker.
// The broker only helps two browsers find each other; once connected,
// moves travel directly between the two players.

// STUN alone can't get through every network (corporate wifi, some mobile
// carriers). Open Relay's free public TURN servers act as a relay when a
// direct connection isn't possible — it's rate-limited but enough for a
// casual game between two people.
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

export class Room {
  constructor({ onOpen, onConnected, onData, onPeerLeft, onError }) {
    this.onOpen = onOpen;
    this.onConnected = onConnected;
    this.onData = onData;
    this.onPeerLeft = onPeerLeft;
    this.onError = onError;
    this.peer = null;
    this.conn = null;
    this.isHost = false;
  }

  // id: a short custom room code. Retrying with a new code on collision is
  // the caller's job (see main.js) — this just reports the error.
  host(id) {
    this.isHost = true;
    if (this.peer) this.peer.destroy();
    this.peer = new Peer(id, { config: ICE_CONFIG });
    this.peer.on("open", (openedId) => this.onOpen && this.onOpen(openedId));
    this.peer.on("connection", (conn) => this._bind(conn));
    this.peer.on("error", (err) => this.onError && this.onError(err));
    this._watchDisconnect();
  }

  join(hostId) {
    this.isHost = false;
    this.peer = new Peer({ config: ICE_CONFIG });
    this.peer.on("open", () => {
      const conn = this.peer.connect(hostId, { reliable: true });
      this._bind(conn);
    });
    this.peer.on("error", (err) => this.onError && this.onError(err));
    this._watchDisconnect();
  }

  // Backgrounding the browser tab (e.g. switching apps to share the room
  // code, or the OS suspending the tab) commonly drops the signaling
  // connection to PeerJS's broker — the "network problem" people hit when
  // they step out mid-invite. It reconnects on its own once possible.
  _watchDisconnect() {
    this.peer.on("disconnected", () => {
      if (!this.peer.destroyed) this.peer.reconnect();
    });
  }

  // Call when the page becomes visible again, as a second chance in case
  // the automatic reconnect above didn't already catch it.
  reconnectIfNeeded() {
    if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
      this.peer.reconnect();
    }
  }

  _bind(conn) {
    this.conn = conn;
    conn.on("open", () => this.onConnected && this.onConnected());
    conn.on("data", (data) => this.onData && this.onData(data));
    conn.on("close", () => this.onPeerLeft && this.onPeerLeft());
    conn.on("error", (err) => this.onError && this.onError(err));
  }

  send(message) {
    if (this.conn && this.conn.open) this.conn.send(message);
  }

  close() {
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
  }
}
