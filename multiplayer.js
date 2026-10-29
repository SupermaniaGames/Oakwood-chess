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

// A quick check, run after a connection fails: can THIS phone reach a relay
// (TURN) server at all? A relay is what carries the game when two phones on
// different networks can't connect directly. Resolves to { relay, total }:
// how many relay / all connection candidates were found (relay 0 = no relay
// server could be reached, so connections across networks are likely to fail).
export function checkRelayAvailable(timeoutMs = 6000) {
  return new Promise((resolve) => {
    let pc = null;
    let finished = false;
    let relay = 0;
    let total = 0;
    const finish = (error = false) => {
      if (finished) return;
      finished = true;
      try {
        pc && pc.close();
      } catch {
        /* already closed */
      }
      resolve({ relay, total, error });
    };
    try {
      pc = new RTCPeerConnection({ iceServers: ICE_CONFIG.iceServers });
      pc.createDataChannel("probe");
      pc.onicecandidate = (e) => {
        if (!e.candidate) return finish();
        total += 1;
        if (/ typ relay /.test(e.candidate.candidate)) relay += 1;
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => finish(true));
      setTimeout(finish, timeoutMs);
    } catch {
      finish(true);
    }
  });
}

// The only messages a spectator may send: one of these reaction emojis.
const SPECTATOR_EMOJIS = ["👏", "🔥", "👑", "😱"];

export class Room {
  constructor({ onOpen, onConnected, onConnectFailed, onResumed, onData, onPeerLeft, onError, onSpectatorCountChange, onSpectatorJoin }) {
    this.onOpen = onOpen;
    this.onConnected = onConnected;
    this.onConnectFailed = onConnectFailed; // a connection closed before it ever opened
    this.onResumed = onResumed; // the same friend is back on a fresh connection (the game goes on)
    this.onData = onData;
    this.onPeerLeft = onPeerLeft;
    this.onError = onError;
    this.onSpectatorCountChange = onSpectatorCountChange;
    this.onSpectatorJoin = onSpectatorJoin;
    // Spectating is opt-in per game, and it has its OWN connection and code
    // (see openWatchRoom): the room code that players use never lets anyone
    // watch, and a watch code never lets anyone play.
    this.allowSpectators = false;
    this.listPublicly = false; // set by the page: also list the game in the Watch tab
    this.watchPeer = null;
    this.peer = null;
    this.conn = null; // the actual opponent, once connected
    this.spectatorConns = []; // read-only watchers (host side only)
    this.isHost = false;
    this.isSpectator = false;
    // Coming back after a dropped connection: the joining player has a secret token
    // that the host remembers, so only the SAME player can take the seat back, and
    // the game carries on instead of starting again.
    this.token = Math.random().toString(36).slice(2, 12);
    this.guestToken = "";
    this.remoteId = ""; // the host's id, for redialing
    this.lastRecvAt = Date.now(); // when we last heard anything from the opponent
    this._redialPending = false;
  }

  // How long (ms) it has been since the opponent last sent us anything at all.
  silentFor() {
    return Date.now() - this.lastRecvAt;
  }
  touch() {
    this.lastRecvAt = Date.now();
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
    this.remoteId = hostId;
    this.peer = new Peer({ config: ICE_CONFIG });
    this.peer.on("open", () => {
      // The broker connection was re-made because we asked for a redial.
      if (this._redialPending) {
        this._redialPending = false;
        this._dial(true);
        return;
      }
      // "open" also fires again each time the broker connection is re-made on its
      // own. Keep the connection we already have, or the game would split across two.
      if (this.conn && !this.conn._dead) return;
      this._dial(false);
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
  _watchDisconnect(peer = this.peer) {
    peer.on("disconnected", () => {
      // A short pause, so an unreachable broker isn't hammered in a tight loop.
      clearTimeout(peer._reconnectTimer);
      peer._reconnectTimer = setTimeout(() => {
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
    for (const p of [this.peer, this.watchPeer]) {
      if (p && p.disconnected && !p.destroyed) {
        try {
          p.reconnect();
        } catch {
          /* already reconnecting */
        }
      }
    }
  }

  // Host side only: routes an incoming connection to either "the opponent"
  // (the first non-spectator connection) or the spectator list.
  // Dial the host. `resume` = we were already playing and are coming back.
  _dial(resume) {
    const conn = this.peer.connect(this.remoteId, {
      reliable: true,
      metadata: { role: "player", token: this.token, resume: !!resume },
    });
    const old = this.conn;
    this._bindOpponent(conn, { resume: !!resume });
    if (old && old !== conn) {
      old._dead = true; // replaced: its closing is not "the friend left"
      try {
        old.close();
      } catch {
        /* already gone */
      }
    }
  }

  // Joining player only: the connection looks dead, so open a new one to the host.
  // Returns false if there is nothing to redial.
  redial() {
    if (this.isHost || this.isSpectator || !this.peer || this.peer.destroyed || !this.remoteId) return false;
    if (this.peer.disconnected || !this.peer.open) {
      this._redialPending = true; // dial once the matchmaking connection is back
      try {
        this.peer.reconnect();
      } catch {
        this._redialPending = false;
        return false;
      }
      return true;
    }
    this._dial(true);
    return true;
  }

  _acceptIncoming(conn) {
    const isSpectatorConn = conn.metadata && conn.metadata.role === "spectator";
    const token = conn.metadata && conn.metadata.token;
    // The same player coming back on a new connection (theirs died): give them
    // their seat back without restarting anything.
    if (!isSpectatorConn && this.conn && token && this.guestToken && token === this.guestToken) {
      const seat = this.conn;
      this.conn = null;
      seat._dead = true;
      try {
        seat.close();
      } catch {
        /* already gone */
      }
      this._bindOpponent(conn, { resume: true });
      return;
    }
    if (!isSpectatorConn) {
      // The seat is free — or held by an attempt that never connected (a failed
      // or abandoned try by the same friend). A newer attempt takes it over, so
      // retrying works instead of "this room already has two players".
      const seat = this.conn;
      if (!seat || (!seat._wasOpen && !seat.open)) {
        if (token) this.guestToken = token;
        this.conn = null;
        if (seat) {
          seat._dead = true;
          seat.close();
        }
        this._bindOpponent(conn);
        return;
      }
    }
    // The seat is taken, or this is a spectator knocking on the players' door
    // (an old watch link used the room code). Turn them away politely: watching
    // happens on the separate watch connection only.
    conn.on("open", () => {
      conn.send({ type: "spectate-denied", oldLink: isSpectatorConn });
      setTimeout(() => conn.close(), 300);
    });
  }

  // ---- Spectating: a second, spectator-only connection (host side) ----

  get watchOpen() {
    return !!this.watchPeer && !this.watchPeer.destroyed;
  }

  // Opens the watch connection under `watchId`. Every connection to it is a
  // read-only spectator — there is no way to play through it.
  openWatchRoom(watchId, { onReady, onTaken, onError } = {}) {
    this.closeWatchRoom();
    const peer = new Peer(watchId, { config: ICE_CONFIG });
    this.watchPeer = peer;
    this.allowSpectators = true;
    peer.on("open", () => onReady && onReady(watchId));
    peer.on("connection", (conn) => this._acceptSpectator(conn));
    peer.on("error", (err) => {
      if (peer !== this.watchPeer) return;
      if (err && err.type === "unavailable-id") onTaken && onTaken();
      else onError && onError(err);
    });
    this._watchDisconnect(peer);
  }

  // Stops spectating: every spectator is disconnected and the code stops working.
  closeWatchRoom() {
    for (const conn of this.spectatorConns) {
      try {
        conn.close();
      } catch {
        /* already gone */
      }
    }
    this.spectatorConns = [];
    this.onSpectatorCountChange && this.onSpectatorCountChange(0);
    const peer = this.watchPeer;
    this.watchPeer = null;
    this.allowSpectators = false;
    if (peer) {
      clearTimeout(peer._reconnectTimer);
      try {
        peer.destroy();
      } catch {
        /* already gone */
      }
    }
  }

  _acceptSpectator(conn) {
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
    if (message && ["clock", "flag-check", "ping", "sync-request", "state", "bye"].includes(message.type)) return;
    for (const conn of this.spectatorConns) {
      if (conn.open) conn.send({ ...message, _from: from });
    }
  }

  _bindOpponent(conn, { resume = false } = {}) {
    this.conn = conn;
    conn.on("open", () => {
      conn._wasOpen = true;
      this.touch();
      if (this.conn !== conn) return;
      if (resume) this.onResumed && this.onResumed();
      else this.onConnected && this.onConnected();
    });
    conn.on("data", (data) => {
      if (this.conn !== conn) return; // a connection we've replaced
      this.touch();
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
    if (this.isSpectator) return false; // read-only, never sends game data
    let sent = false;
    if (this.conn && this.conn.open) {
      this.conn.send(message);
      sent = true;
    }
    this._mirrorToSpectators(message, "host");
    return sent; // false = nobody was listening (the opponent's connection isn't open)
  }

  // Spectator side: send a reaction to the host, who relays it to the other
  // spectators. (send() above stays a no-op for spectators on purpose.)
  sendEmoji(emoji) {
    if (!this.isSpectator || !SPECTATOR_EMOJIS.includes(emoji)) return;
    if (this.conn && this.conn.open) this.conn.send({ type: "spectator-emoji", e: emoji });
  }

  close() {
    if (this.peer) clearTimeout(this.peer._reconnectTimer);
    if (this.conn) this.conn.close();
    this.closeWatchRoom();
    if (this.peer) this.peer.destroy();
  }
}
