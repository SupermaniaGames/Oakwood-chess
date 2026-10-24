// Minimal peer-to-peer room using PeerJS's free public broker.
// The broker only helps two browsers find each other; once connected,
// moves travel directly between the two players (and, optionally, out to
// any read-only spectators watching the same game).

// STUN alone can't get through every network (corporate wifi, some mobile
// carriers, which often share one address between many phones). A TURN relay
// carries the game when a direct connection is impossible. Passing our own
// `config` to PeerJS REPLACES its built-in server list, so PeerJS's own free
// relays are listed here too, next to Open Relay's — the more relays, the
// better the odds that one is up. All of these are free public services and
// can be rate-limited or withdrawn; for a connection you can count on, put
// your own TURN credentials (for example a free Metered or Cloudflare account)
// in CUSTOM_ICE_SERVERS, like:
//   { urls: "turn:YOUR-HOST:3478", username: "YOUR-NAME", credential: "YOUR-KEY" }
const CUSTOM_ICE_SERVERS = [];

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
    ...CUSTOM_ICE_SERVERS,
  ],
};

// The only messages a spectator may send: one of these reaction emojis.
const SPECTATOR_EMOJIS = ["👏", "🔥", "👑", "😱"];

export class Room {
  constructor({ onOpen, onConnected, onConnectFailed, onData, onPeerLeft, onError, onSpectatorCountChange, onSpectatorJoin }) {
    this.onOpen = onOpen;
    this.onConnected = onConnected;
    this.onConnectFailed = onConnectFailed; // a connection closed before it ever opened
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
      // "open" fires again each time the broker connection is re-made. Keep the
      // connection we already have, or the game would split across two of them.
      if (this.conn && !this.conn._dead) return;
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
      if (this.conn && !this.conn._dead) return; // see join()
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
    const peer = this.peer;
    peer.on("disconnected", () => {
      // A short pause, so an unreachable broker isn't hammered in a tight loop.
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) {
          try {
            peer.reconnect();
          } catch {
            /* state changed in the meantime */
          }
        }
      }, 1000);
    });
  }

  // Call when the page becomes visible again, as a second chance in case
  // the automatic reconnect above didn't already catch it.
  reconnectIfNeeded() {
    if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
      try {
        this.peer.reconnect();
      } catch {
        /* already reconnecting */
      }
    }
  }

  // Host side only: routes an incoming connection to either "the opponent"
  // (the first non-spectator connection) or the spectator list.
  _acceptIncoming(conn) {
    const isSpectatorConn = conn.metadata && conn.metadata.role === "spectator";
    if (!isSpectatorConn) {
      // The seat is free — or held by an attempt that never connected (a failed
      // or abandoned try by the same friend). A newer attempt takes it over, so
      // retrying works instead of "this room already has two players".
      const seat = this.conn;
      if (!seat || (!seat._wasOpen && !seat.open)) {
        this.conn = null;
        if (seat) {
          seat._dead = true;
          seat.close();
        }
        this._bindOpponent(conn);
        return;
      }
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
    conn.on("data", (data) => {
      // Spectators are read-only: they can't move or chat. The one thing the
      // host accepts from them is an emoji reaction, which is passed on to
      // the OTHER spectators only (never to the opponent, and never shown on
      // the host's own screen) so the players aren't distracted.
      if (!data || data.type !== "spectator-emoji" || !SPECTATOR_EMOJIS.includes(data.e)) return;
      const now = Date.now();
      if (now - (conn._lastEmojiAt || 0) < 250) return; // per-spectator rate limit
      conn._lastEmojiAt = now;
      for (const other of this.spectatorConns) {
        if (other !== conn && other.open) other.send({ type: "spectator-emoji", e: data.e });
      }
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
    // Clock bookkeeping between the two players isn't for spectators.
    if (message && (message.type === "clock" || message.type === "flag-check")) return;
    for (const conn of this.spectatorConns) {
      if (conn.open) conn.send({ ...message, _from: from });
    }
  }

  _bindOpponent(conn) {
    this.conn = conn;
    conn.on("open", () => {
      conn._wasOpen = true;
      if (this.conn === conn && this.onConnected) this.onConnected();
    });
    conn.on("data", (data) => {
      if (this.conn !== conn) return; // a connection we've replaced
      // Relay the opponent's moves/chat out to spectators too — without
      // this, spectators would only ever see the host's own moves.
      this._mirrorToSpectators(data, "guest");
      this.onData && this.onData(data);
    });
    conn.on("close", () => {
      conn._dead = true;
      if (this.conn !== conn) return;
      if (!conn._wasOpen) {
        // It never got as far as opening: not a friend leaving. The host just
        // keeps waiting with the seat free; a guest is told it didn't connect.
        if (this.isHost) this.conn = null;
        else this.onConnectFailed && this.onConnectFailed();
        return;
      }
      this.onPeerLeft && this.onPeerLeft();
    });
    conn.on("error", (err) => {
      if (this.conn !== conn) return;
      if (this.isHost && !conn._wasOpen) return; // someone else's failed attempt isn't the host's problem
      this.onError && this.onError(err);
    });
  }

  // Sends to the opponent and — if this is the host — mirrors the same
  // message out to every connected spectator, so their board stays in
  // sync automatically with zero extra work at each call site.
  send(message) {
    if (this.isSpectator) return; // read-only, never sends game data
    if (this.conn && this.conn.open) this.conn.send(message);
    this._mirrorToSpectators(message, "host");
  }

  // Spectator side: send a reaction to the host, who relays it to the other
  // spectators. (send() above stays a no-op for spectators on purpose.)
  sendEmoji(emoji) {
    if (!this.isSpectator || !SPECTATOR_EMOJIS.includes(emoji)) return;
    if (this.conn && this.conn.open) this.conn.send({ type: "spectator-emoji", e: emoji });
  }

  close() {
    clearTimeout(this._reconnectTimer);
    if (this.conn) this.conn.close();
    for (const conn of this.spectatorConns) conn.close();
    this.spectatorConns = [];
    if (this.peer) this.peer.destroy();
  }
}
