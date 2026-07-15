/* ============================================================================
 * FOX TWO  —  NET  (WebRTC via PeerJS, host-authoritative)
 * ----------------------------------------------------------------------------
 * HOST runs the whole Game (source of truth), receives the client's inputs,
 * and broadcasts authoritative snapshots. CLIENT sends inputs, interpolates
 * snapshots for smooth rendering, and lightly predicts its own plane so the
 * controls feel responsive. No game server — PeerJS's free cloud only brokers
 * the handshake; gameplay data flows peer-to-peer.
 * ========================================================================== */

const now = () => performance.now();

class NetManager {
  constructor(game, audio) {
    this.game = game;
    this.audio = audio;
    this.peer = null;
    this.conn = null;
    this.role = null;               // 'host' | 'client'
    this.connected = false;
    this.roomCode = '';
    this.myCallsign = 'ACE';
    this.remoteCallsign = 'BOGEY';
    this.onStatus = () => {};
    this.onReady = () => {};         // host: room open;   both: match can start
    this.onConnected = () => {};
    this.onError = () => {};
    this.onDisconnect = () => {};

    // host
    this.remoteInput = null;
    this._stateAccum = 0;
    this._tick = 0;

    // client
    this.buffer = [];               // [{time, snap}]
    this._inputAccum = 0;
    this._seq = 0;
    this.view = null;               // client render view
    this._clientParts = new ParticleSystem();
    this._predict = null;           // predicted own Plane
    this._gunTimers = [0, 0];
    this._clientCallouts = [];
    this._clientShake = 0;
    this._lockDone = false;
    this.started = false;           // client got first snapshot
  }

  get available() { return typeof window !== 'undefined' && !!window.Peer; }

  _mkCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
    return s;
  }

  /* --------------------------------------------------------------- HOST */
  host(callsign) {
    if (!this.available) { this.onError('PeerJS failed to load (need internet & hosting).'); return; }
    this.role = 'host';
    this.game.netRole = 'host';
    this.game.mode = 'online';
    this.game.localIdx = 0;
    this.myCallsign = callsign || 'ACE';
    this.roomCode = this._mkCode();
    const id = CONFIG.net.peerPrefix + this.roomCode;
    this.onStatus('Opening room…');
    this.peer = new Peer(id, { debug: 1 });
    this.peer.on('open', () => { this.onStatus('Waiting for a challenger…'); this.onReady(this.roomCode); });
    this.peer.on('error', (e) => this._peerError(e));
    this.peer.on('disconnected', () => { if (!this.connected) this.onStatus('Reconnecting to broker…'); });
    this.peer.on('connection', (conn) => {
      if (this.conn) { conn.close(); return; }   // one challenger only
      this.conn = conn;
      this.remoteCallsign = (conn.metadata && conn.metadata.callsign) || 'BOGEY';
      conn.on('open', () => {
        this.connected = true;
        conn.send({ t: 'welcome', callsigns: [this.myCallsign, this.remoteCallsign], w: this.game.w, h: this.game.h, map: this.game.mapId });
        this.onConnected([this.myCallsign, this.remoteCallsign]);
      });
      conn.on('data', (d) => { if (d && d.t === 'input') this.remoteInput = d.in; });
      conn.on('close', () => this._lost());
      conn.on('error', () => this._lost());
    });
  }

  // Host: latest client input (in1). Returns {} until first packet.
  hostInput() { return this.remoteInput || {}; }

  // Host: call after each Game.step to pace snapshots to clients.
  hostTick(dt) {
    if (!this.connected || !this.conn || !this.conn.open) return;
    this._stateAccum += dt;
    const period = 1 / CONFIG.net.hostStateHz;
    if (this._stateAccum >= period) {
      this._stateAccum = 0;
      this._tick++;
      try { this.conn.send(this.game.buildSnapshot(this._tick)); } catch (e) {}
    }
  }

  /* -------------------------------------------------------------- CLIENT */
  join(code, callsign) {
    if (!this.available) { this.onError('PeerJS failed to load (need internet & hosting).'); return; }
    this.role = 'client';
    this.game.netRole = 'client';
    this.game.mode = 'online';
    this.game.localIdx = 1;
    this.myCallsign = callsign || 'GHOST';
    this.roomCode = (code || '').toUpperCase().trim();
    const myId = CONFIG.net.peerPrefix + 'c-' + this._mkCode() + this._mkCode();
    this.onStatus('Connecting…');
    this.peer = new Peer(myId, { debug: 1 });
    this.peer.on('error', (e) => this._peerError(e));
    this.peer.on('open', () => {
      const hostId = CONFIG.net.peerPrefix + this.roomCode;
      const conn = this.peer.connect(hostId, { reliable: false, metadata: { callsign: this.myCallsign }, serialization: 'json' });
      this.conn = conn;
      conn.on('open', () => { this.connected = true; this.onStatus('Linked. Standby…'); });
      conn.on('data', (d) => this._onClientData(d));
      conn.on('close', () => this._lost());
      conn.on('error', () => this._lost());
      // if no open within a few seconds, likely a bad code
      setTimeout(() => { if (!this.connected) this.onError('No answer — check the room code.'); }, 9000);
    });
  }

  _onClientData(d) {
    if (!d) return;
    if (d.t === 'welcome') {
      this.remoteCallsign = d.callsigns[0];
      this.game.setWorldSize(d.w, d.h);
      this._clientMap = d.map;
      this._initClientView(d.callsigns, d.map);
      this.onConnected(d.callsigns);
      return;
    }
    if (d.t === 'state') {
      if (!this.view) this._initClientView([this.remoteCallsign, this.myCallsign], d.map);
      this.game.setWorldSize(d.w, d.h);
      this.view.w = d.w; this.view.h = d.h;
      // rebuild obstacles if the map or arena size changed (e.g. after a rematch)
      if (d.map !== this._clientMap) { this._clientMap = d.map; this.view.obstacles = this._buildObstacles(d.map, d.w, d.h); }
      this.buffer.push({ time: now(), snap: d });
      if (this.buffer.length > 14) this.buffer.shift();
      this._processEvents(d.ev);
      this.started = true;
    }
  }

  _buildObstacles(map, w, h) {
    const def = CONFIG.maps[map] || CONFIG.maps[CONFIG.defaultMap] || { ships: [] };
    return def.ships.map(s => new Ship(s.kind, w * s.x, h * s.y, s.a));
  }

  _initClientView(callsigns, map) {
    const mkPlane = (idx) => ({
      idx, col: idx === 0 ? CONFIG.colors.p1 : CONFIG.colors.p2,
      callsign: callsigns[idx], x: 0, y: 0, angle: 0, throttle: 0.6, boosting: false,
      bank: 0, spawnShield: 0, hitFlash: 0, trail: [],
      lockProg: 0, locked: false, alive: true, warnMissile: false, warnLock: false,
      ammo: CONFIG.missile.ammo, flares: CONFIG.flare.count, boost: CONFIG.boost.max,
      health: CONFIG.plane.maxHealth, gunHeat: 0, gunOverheat: false, emitHeat: 1, turnHard: 0,
    });
    this._clientMap = map;
    const obstacles = this._buildObstacles(map, this.game.w, this.game.h);
    this.view = {
      mode: 'online', localIdx: 1, w: this.game.w, h: this.game.h, time: 0, shakeAmt: 0,
      obstacles, planes: [mkPlane(0), mkPlane(1)],
      bullets: [], missiles: [], flares: [], particles: this._clientParts,
      score: [0, 0], round: 1, phase: 'countdown', phaseTime: 0, lastRoundWinner: -1, matchWinner: -1,
      callouts: this._clientCallouts,
      isLocalView(idx) { return idx === this.localIdx; },
    };
    // predicted own plane
    this._predict = new Plane(1, callsigns[1]);
  }

  _processEvents(ev) {
    if (!ev || !ev.length) return;
    for (const e of ev) {
      if (e.e === 's') { if (this.audio[e.n]) this.audio[e.n](...(e.a || [])); }
      else if (e.e === 'x') { this._clientParts.explosion(e.x, e.y, e.s); this.audio.explosion(e.s); this._clientShake = Math.max(this._clientShake, e.s > 1 ? CONFIG.juice.shakeKill : CONFIG.juice.shakeMissileHit); }
      else if (e.e === 'h') { this._clientParts.hit(e.x, e.y, e.i === 0 ? CONFIG.colors.p1 : CONFIG.colors.p2); this.audio.hit(); this._clientShake = Math.max(this._clientShake, CONFIG.juice.shakeGunHit); }
      else if (e.e === 'r') { this.audio.radio(e.k); this._addClientCallout(e); }
    }
  }
  _addClientCallout(e) {
    if (e.i < 0) this._clientCallouts.push({ text: e.t, x: this.view.w / 2, y: this.view.h * 0.4, color: CONFIG.colors.hudAmber, size: 46, life: 1.8, max: 1.8 });
    else this._clientCallouts.push({ text: e.t, x: 0, y: 0, follow: e.i, color: (e.i === 0 ? CONFIG.colors.p1 : CONFIG.colors.p2).glow, size: 15, life: 1.1, max: 1.1 });
  }

  // Client: called each frame. Sends input, builds interpolated+predicted view.
  clientTick(dt) {
    // send input
    this._inputAccum += dt;
    const period = 1 / CONFIG.net.clientInputHz;
    if (this.connected && this.conn && this.conn.open && this._inputAccum >= period) {
      this._inputAccum = 0;
      this._seq++;
      try { this.conn.send({ t: 'input', seq: this._seq, in: Input.snapshot('p1') }); } catch (e) {}
    }
    if (!this.view || !this.started) return this.view;
    this._buildView(dt);
    return this.view;
  }

  _buildView(dt) {
    const v = this.view;
    v.time += dt;
    // shake decay (client-derived)
    this._clientShake = Math.max(0, this._clientShake - CONFIG.juice.shakeDamp * dt * this._clientShake - 6 * dt);
    v.shakeAmt = this._clientShake;
    for (const s of v.obstacles) s.update(dt);

    const renderTime = now() - CONFIG.net.interpDelayMs;
    const { a, b, f } = this._straddle(renderTime);
    if (!a) return;
    const snap = b || a;
    v.phase = snap.snap.ph; v.phaseTime = snap.snap.pt; v.round = snap.snap.rd;
    v.score = snap.snap.sc; v.matchWinner = snap.snap.mw; v.lastRoundWinner = snap.snap.lw;

    // planes
    for (let i = 0; i < 2; i++) {
      const pa = a.snap.P[i], pb = (b ? b.snap.P[i] : pa);
      const P = v.planes[i];
      const isOwn = i === v.localIdx;
      if (isOwn && CONFIG.net.predictOwn && snap.snap.ph === 'fight' && pb.al) {
        this._predictOwn(P, pb, dt, v);
      } else {
        P.x = this._lerpWrap(pa.x, pb.x, f, v.w);
        P.y = this._lerpWrap(pa.y, pb.y, f, v.h);
        P.angle = this._lerpAng(pa.a, pb.a, f);
      }
      // scalar/HUD fields from newest
      P.throttle = pb.th; P.boosting = !!pb.b; P.bank = pb.bk;
      P.health = pb.hp; P.ammo = pb.am; P.flares = pb.fl; P.boost = pb.bo;
      P.lockProg = pb.lp; P.locked = !!pb.lk; P.warnLock = !!pb.wl; P.warnMissile = !!pb.wm;
      P.alive = !!pb.al; P.gunHeat = pb.gh; P.gunOverheat = !!pb.go; P.spawnShield = pb.ss ? 0.2 : 0;
      P.missileCd = pb.mc ? 1 : 0;
      P.emitHeat = 1 + pb.th; P.turnHard = 0;
      if (pb.hp < P._lastHp) P.hitFlash = 1; P._lastHp = pb.hp;
      P.hitFlash = Math.max(0, (P.hitFlash || 0) - dt * 4);
      // trail + exhaust
      if (P.alive) {
        P.trail.push(P.x, P.y); if (P.trail.length > 44) P.trail.splice(0, 2);
        this._clientParts.exhaust(P.x - Math.cos(P.angle) * 13, P.y - Math.sin(P.angle) * 13, P.angle + Math.PI, 200, P.col, P.boosting, P.throttle);
        // gun muzzle + sound while firing
        this._gunTimers[i] -= dt;
        if (pb.gf) {
          if (this._gunTimers[i] <= 0) {
            this._gunTimers[i] = CONFIG.guns.fireInterval;
            const nx = P.x + Math.cos(P.angle) * 18, ny = P.y + Math.sin(P.angle) * 18;
            this._clientParts.muzzle(nx, ny, P.angle, P.col);
            this.audio.gun();
          }
        }
      } else { P.trail.length = 0; }
    }

    // missiles / flares / bullets (interpolate positions; spawn their fx)
    v.missiles = (snap.snap.M || []).map(m => ({ x: m.x, y: m.y, angle: m.a, fuel: m.f ? 1 : 0, owner: m.o }));
    for (const m of v.missiles) this._clientParts.smoke(m.x, m.y, m.fuel > 0);
    v.flares = (snap.snap.F || []).map(fl => ({ x: fl.x, y: fl.y, life: fl.l * CONFIG.flare.life, maxLife: CONFIG.flare.life }));
    for (const fl of v.flares) if (chance(0.9)) this._clientParts.flareSpark(fl.x, fl.y);
    v.bullets = (snap.snap.B || []).map(bl => ({ x: bl.x, y: bl.y, px: bl.px, py: bl.py, col: bl.o === 0 ? CONFIG.colors.p1 : CONFIG.colors.p2, wrapped: false }));

    this._clientParts.update(dt, v);
    this._updateClientCallouts(dt);
    // own cockpit audio
    this._clientCockpitAudio(dt);
  }

  _predictOwn(P, auth, dt, v) {
    const pr = this._predict;
    // (Re)seed on the first frame, after a respawn, or if we've drifted far.
    // The distance check also catches the between-round spawn teleport.
    if (wrapDist(pr.x, pr.y, auth.x, auth.y, v.w, v.h) > 220) {
      pr.x = auth.x; pr.y = auth.y; pr.angle = auth.a;
      pr.speed = lerp(CONFIG.plane.minSpeed, CONFIG.plane.maxSpeed, auth.th);
      pr.vx = Math.cos(auth.a) * pr.speed; pr.vy = Math.sin(auth.a) * pr.speed;
    }
    pr.throttle = auth.th; pr.boost = auth.bo; // keep HUD-ish sane
    // integrate local input with real flight physics
    const ctx = { w: v.w, h: v.h, particles: null };
    pr._physics(Input.snapshot('p1'), dt, ctx);
    // gentle reconciliation toward authoritative (host is truth)
    pr.x = this._lerpWrap(pr.x, auth.x, 0.08, v.w);
    pr.y = this._lerpWrap(pr.y, auth.y, 0.08, v.h);
    pr.angle = this._lerpAng(pr.angle, auth.a, 0.06);
    P.x = pr.x; P.y = pr.y; P.angle = pr.angle; P.bank = pr.bank;
  }

  _clientCockpitAudio(dt) {
    const P = this.view.planes[this.view.localIdx];
    if (this.view.phase !== 'fight' || !P.alive) { this.audio.lockOff(1); this.audio.warnOff(1); this._lockDone = false; return; }
    if (P.locked) { if (!this._lockDone) { this.audio.lockDone(1); this._lockDone = true; } }
    else { this._lockDone = false; if (P.lockProg > 0.02) this.audio.setLock(1, P.lockProg); else this.audio.lockOff(1); }
    if (P.warnMissile) this.audio.warnOn(1); else this.audio.warnOff(1);
    // engines
    this.audio.engineSet(0, this.view.planes[0].throttle, this.view.planes[0].boosting, this.view.planes[0].alive);
    this.audio.engineSet(1, P.throttle, P.boosting, P.alive);
  }

  _updateClientCallouts(dt) {
    for (let i = this._clientCallouts.length - 1; i >= 0; i--) {
      const c = this._clientCallouts[i];
      c.life -= dt;
      if (c.follow != null && this.view.planes[c.follow]) { c.x = this.view.planes[c.follow].x; c.y = this.view.planes[c.follow].y - 32; }
      else c.y -= 12 * dt;
      if (c.life <= 0) this._clientCallouts.splice(i, 1);
    }
  }

  _straddle(rt) {
    const buf = this.buffer;
    if (!buf.length) return { a: null };
    if (rt <= buf[0].time) return { a: buf[0], b: buf[0], f: 0 };
    for (let i = 0; i < buf.length - 1; i++) {
      if (rt >= buf[i].time && rt <= buf[i + 1].time) {
        const f = (rt - buf[i].time) / Math.max(1, buf[i + 1].time - buf[i].time);
        return { a: buf[i], b: buf[i + 1], f };
      }
    }
    const last = buf[buf.length - 1];
    return { a: last, b: last, f: 0 };
  }
  _lerpWrap(a, b, t, size) {
    if (!CONFIG.world.wrap) return lerp(a, b, t);
    let d = b - a;
    if (d > size / 2) d -= size; else if (d < -size / 2) d += size;
    let v = a + d * t;
    if (v < 0) v += size; else if (v >= size) v -= size;
    return v;
  }
  _lerpAng(a, b, t) { return normAngle(a + angDiff(a, b) * t); }

  /* -------------------------------------------------------------- COMMON */
  _peerError(e) {
    const type = e && e.type ? e.type : '';
    let msg = 'Network error.';
    if (type === 'peer-unavailable') msg = 'Room not found — check the code.';
    else if (type === 'unavailable-id') { this.roomCode = this._mkCode(); msg = 'Room code taken — try HOST again.'; }
    else if (type === 'browser-incompatible') msg = 'This browser lacks WebRTC support.';
    else if (type === 'network' || type === 'server-error' || type === 'socket-error') msg = 'Cannot reach the PeerJS broker. Check your connection.';
    this.onError(msg, type);
  }
  _lost() {
    if (this._closed) return;
    this._closed = true;
    this.connected = false;
    this.onDisconnect();
  }
  hangUp() {
    this._closed = true;
    try { if (this.conn) this.conn.close(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.conn = null; this.peer = null; this.connected = false;
  }
}
