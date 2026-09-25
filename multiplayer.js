// Minimal peer-to-peer room using PeerJS's free public broker.
// The broker only helps two browsers find each other; once connected,
// moves travel directly between the two players.

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

  host() {
    this.isHost = true;
    this.peer = new Peer();
    this.peer.on("open", (id) => this.onOpen && this.onOpen(id));
    this.peer.on("connection", (conn) => this._bind(conn));
    this.peer.on("error", (err) => this.onError && this.onError(err));
  }

  join(hostId) {
    this.isHost = false;
    this.peer = new Peer();
    this.peer.on("open", () => {
      const conn = this.peer.connect(hostId, { reliable: true });
      this._bind(conn);
    });
    this.peer.on("error", (err) => this.onError && this.onError(err));
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
