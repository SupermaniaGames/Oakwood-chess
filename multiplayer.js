// Minimal peer-to-peer room using PeerJS's free public broker.
// The broker only helps two browsers find each other; once connected,
// moves travel directly between the two players (and, optionally, out to
// any read-only spectators watching the same game).

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
  constructor({ onOpen, onConnected, onData, onPeerLeft, onError, onSpectatorCountChange, onSpectatorJoin }) {
    this.onOpen = onOpen;
    this.onConnected = onConnected;
    this.onData = onData;
    this.onPeerLeft = onPeerLeft;
    this.onError = onError;
    this.onSpectatorCountChange = onSpectatorCountChange;
    this.onSpectatorJoin = onSpectatorJoin;
    // Spectating is opt-in per game (host sets this): otherwise anyone who
    // happened to learn a room code could silently watch a private game.
    this.allowSpectators = false;
    this.peer = null;
    this.conn = null; // the actual opponent, once connected
    this.spectatorConns = []; // read-only watchers (host side only)
    this.isHost = false;
    this.isSpectator = false;
  }

  // id: a short custom room code. Retrying with a new code on collision is
  // the caller's job (see main.js) — this just reports the error.
  host(id) {
    this.isHost = true;
    this.isSpectator = false;
    if (this.peer) this.peer.destroy();
    this.peer = new Peer(id, { config: ICE_CONFIG });
    this.peer.on("open", (openedId) => this.onOpen && this.onOpen(openedId));
    this.peer.on("connection", (conn) => this._acceptIncoming(conn));
    this.peer.on("error", (err) => this.onError && this.onError(err));
    this._watchDisconnect();
  }

  join(hostId) {
    this.isHost = false;
    this.isSpectator = false;
    if (this.peer) this.peer.destroy();
    this.peer = new Peer({ config: ICE_CONFIG });
    this.peer.on("open", () => {
      const conn = this.peer.connect(hostId, { reliable: true });
      this._bindOpponent(conn);
    });
    this.peer.on("error", (err) => this.onError && this.onError(err));
    this._watchDisconnect();
  }

  // Connects to a live game as a read-only spectator: the host mirrors the
  // opponent's moves/chat out to every spectator, but anything a spectator
  // sends is ignored (see _acceptIncoming below) — send() here is also a
  // no-op as a second safety net.
  joinAsSpectator(hostId) {
    this.isHost = false;
    this.isSpectator = true;
    if (this.peer) this.peer.destroy();
    this.peer = new Peer({ config: ICE_CONFIG });
    this.peer.on("open", () => {
      const conn = this.peer.connect(hostId, { reliable: true, metadata: { role: "spectator" } });
      this._bindOpponent(conn);
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

  // Host side only: routes an incoming connection to either "the opponent"
  // (the first non-spectator connection) or the spectator list.
  _acceptIncoming(conn) {
    const isSpectatorConn = conn.metadata && conn.metadata.role === "spectator";
    if (!isSpectatorConn && !this.conn) {
      this._bindOpponent(conn);
      return;
    }
    // Either explicitly a spectator, or a second non-spectator arriving
    // after the seat is taken. Both are treated as spectators — but only if
    // the host opted in; otherwise politely turn them away.
    if (!this.allowSpectators) {
      conn.on("open", () => {
        conn.send({ type: "spectate-denied" });
        setTimeout(() => conn.close(), 300);
      });
      return;
    }
    conn.on("open", () => {
      this.spectatorConns.push(conn);
      this.onSpectatorCountChange && this.onSpectatorCountChange(this.spectatorConns.length);
      // Late joiners need the current position, not just future moves.
      this.onSpectatorJoin && this.onSpectatorJoin((msg) => conn.send(msg));
    });
    conn.on("data", () => {
      /* spectators are read-only: whatever they send is ignored */
    });
    conn.on("close", () => {
      this.spectatorConns = this.spectatorConns.filter((c) => c !== conn);
      this.onSpectatorCountChange && this.onSpectatorCountChange(this.spectatorConns.length);
    });
  }

  // Spectators only ever see what the host sees or sends, tagged with which
  // side it came from (a bare "resign" doesn't say who resigned).
  _mirrorToSpectators(message, from) {
    if (!this.isHost) return;
    for (const conn of this.spectatorConns) {
      if (conn.open) conn.send({ ...message, _from: from });
    }
  }

  _bindOpponent(conn) {
    this.conn = conn;
    conn.on("open", () => this.onConnected && this.onConnected());
    conn.on("data", (data) => {
      // Relay the opponent's moves/chat out to spectators too — without
      // this, spectators would only ever see the host's own moves.
      this._mirrorToSpectators(data, "guest");
      this.onData && this.onData(data);
    });
    conn.on("close", () => this.onPeerLeft && this.onPeerLeft());
    conn.on("error", (err) => this.onError && this.onError(err));
  }

  // Sends to the opponent and — if this is the host — mirrors the same
  // message out to every connected spectator, so their board stays in
  // sync automatically with zero extra work at each call site.
  send(message) {
    if (this.isSpectator) return; // read-only, never sends game data
    if (this.conn && this.conn.open) this.conn.send(message);
    this._mirrorToSpectators(message, "host");
  }

  close() {
    if (this.conn) this.conn.close();
    for (const conn of this.spectatorConns) conn.close();
    this.spectatorConns = [];
    if (this.peer) this.peer.destroy();
  }
}
