/* ============================================================================
 * FOX TWO  —  GAME
 * ----------------------------------------------------------------------------
 * The authoritative simulation + match flow. Used directly in LOCAL mode and
 * as the source of truth on the HOST in ONLINE mode. The joining CLIENT does
 * NOT run this; it renders interpolated snapshots (see net.js).
 *
 * Discrete SFX / explosions / radio route through game.sfx / game.explodeAt /
 * game.radio, which (on host) also queue events for broadcast so both screens
 * hear and see the same thing.
 * ========================================================================== */

class Game {
  constructor(audio, renderer) {
    this.audio = audio;
    this.renderer = renderer;
    this.w = 1280; this.h = 720;
    this.mode = 'local';         // 'local' | 'online'
    this.netRole = null;         // null | 'host' | 'client'
    this.localIdx = 0;           // which plane the local player controls (online)
    this.reset();
  }

  reset() {
    this.planes = [null, null];
    this.bullets = [];
    this.missiles = [];
    this.flares = [];
    this.particles = new ParticleSystem();
    this.obstacles = [];
    this.mapId = CONFIG.defaultMap;
    this.score = [0, 0];
    this.round = 1;
    this.phase = 'countdown';    // countdown | fight | roundEnd | matchEnd
    this.phaseTime = 0;
    this.time = 0;
    this.shakeAmt = 0;
    this.hitStop = 0;
    this.callouts = [];
    this.lastRoundWinner = -1;
    this.matchWinner = -1;
    this._radioTimes = {};
    this.pendingEvents = [];     // host: events to broadcast this net tick
    this._lockDoneFlag = [false, false];
    this._roundResolved = false;
  }

  setWorldSize(w, h) {
    const W = CONFIG.world;
    this.w = clamp(Math.round(w), W.minW, W.maxW);
    this.h = clamp(Math.round(h), W.minH, W.maxH);
  }

  startMatch(callsigns, mapId) {
    this.reset();
    if (mapId != null) this.mapId = mapId;
    this.obstacles = this.buildObstacles(this.mapId);
    this.planes[0] = new Plane(0, callsigns[0]);
    this.planes[1] = new Plane(1, callsigns[1]);
    this.score = [0, 0];
    this.round = 1;
    this.matchWinner = -1;
    this.resetRound();
    if (this.audio.started && !this.silent) { this.audio.engineStart(2); this.audio.startMusic(); }
  }

  // Build the obstacle list for a map id (ships positioned by arena fraction).
  buildObstacles(mapId) {
    const def = CONFIG.maps[mapId] || CONFIG.maps[CONFIG.defaultMap] || { ships: [] };
    return def.ships.map(s => new Ship(s.kind, this.w * s.x, this.h * s.y, s.a));
  }

  resetRound() {
    this.bullets.length = 0;
    this.missiles.length = 0;
    this.flares.length = 0;
    this.particles.clear();
    this._roundResolved = false;
    // P1 spawns bottom-left, P2 top-right — both nose-on to the middle.
    const m = CONFIG.match.spawnMargin;
    const cx = this.w * 0.5, cy = this.h * 0.5;
    const s1x = m, s1y = this.h - m;                 // bottom-left
    const s2x = this.w - m, s2y = m;                 // top-right
    this.planes[0].reset(s1x, s1y, Math.atan2(cy - s1y, cx - s1x));
    this.planes[1].reset(s2x, s2y, Math.atan2(cy - s2y, cx - s2x));
    for (const p of this.planes) { this._clearSpawn(p); p.spawnShield = CONFIG.plane.spawnShield; p.trail.length = 0; }
    // reset cockpit audio
    this.audio.lockOff(0); this.audio.lockOff(1);
    this.audio.warnOff(0); this.audio.warnOff(1);
    this._lockDoneFlag = [false, false];
    this.phase = 'countdown';
    this.phaseTime = CONFIG.match.countdown;
  }

  // Nudge a just-spawned plane out of any ship it landed on (and keep it in bounds).
  _clearSpawn(p) {
    for (let iter = 0; iter < 10; iter++) {
      let moved = false;
      for (const s of this.obstacles) {
        if (s.containsPoint(p.x, p.y, p.radius + 20)) {
          const dx = p.x - s.x, dy = p.y - s.y, L = Math.hypot(dx, dy) || 1;
          p.x += (dx / L) * 26; p.y += (dy / L) * 26; moved = true;
        }
      }
      if (!moved) break;
    }
    const pad = p.radius + 6;
    p.x = clamp(p.x, pad, this.w - pad);
    p.y = clamp(p.y, pad, this.h - pad);
    // re-aim at the arena centre after any nudging
    p.angle = Math.atan2(this.h * 0.5 - p.y, this.w * 0.5 - p.x);
    p.vx = Math.cos(p.angle) * p.speed; p.vy = Math.sin(p.angle) * p.speed;
  }

  /* ------------------------------------------------------------ MAIN STEP */
  // inputs = [in0, in1]. During online, host fills in0 from local & in1 from net.
  step(dt, inputs) {
    this.time += dt;
    for (const s of this.obstacles) s.update(dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - CONFIG.juice.shakeDamp * dt * this.shakeAmt - 6 * dt);
    this._updateCallouts(dt);

    if (this.phase === 'countdown') {
      const before = this.phaseTime;
      this.phaseTime -= dt;
      // tick beeps at each integer
      if (Math.ceil(before) !== Math.ceil(this.phaseTime) && this.phaseTime > 0) this.audio.uiBeep(700);
      if (this.phaseTime <= 0) {
        this.phase = 'fight';
        this.radio(-1, 'fight', "FIGHT'S ON");
        this.audio.uiBeep(1100);
      }
      // planes idle during countdown (still rendered), keep engines low
      this.particles.update(dt, this);
      return;
    }

    if (this.phase === 'matchEnd') { this.particles.update(dt, this); return; }

    // fight or roundEnd: simulate
    const alive = [this.planes[0].alive, this.planes[1].alive];
    for (let i = 0; i < 2; i++) {
      const p = this.planes[i];
      if (p.alive) p.update(inputs[i] || {}, dt, this);
    }
    for (const b of this.bullets) b.update(dt, this);
    for (const m of this.missiles) m.update(dt, this);
    for (const f of this.flares) f.update(dt, this);
    this.particles.update(dt, this);

    if (this.phase === 'fight') {
      this._collisions(dt);
      this._updateThreatWarnings();
    }

    // cull dead projectiles
    this.bullets = this.bullets.filter(b => !b.dead);
    this.missiles = this.missiles.filter(m => !m.dead);
    this.flares = this.flares.filter(f => !f.dead);

    if (this.phase === 'fight' && !this._roundResolved) this._checkRoundOutcome();

    if (this.phase === 'roundEnd') {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) this._advanceRound();
    }
  }

  /* --------------------------------------------------------- COLLISIONS */
  _hitsShip(x, y, px, py, wrapped) {
    for (const s of this.obstacles) {
      if (s.containsPoint(x, y) || (!wrapped && s.blocksSeg(px, py, x, y))) return true;
    }
    return false;
  }

  _collisions(dt) {
    // Bullets vs planes & ships
    for (const b of this.bullets) {
      if (b.dead) continue;
      if (this._hitsShip(b.x, b.y, b.px, b.py, b.wrapped)) {
        b.dead = true; this.particles.hit(b.x, b.y, b.col); continue;
      }
      for (const p of this.planes) {
        if (!p.alive || p.idx === b.owner) continue;
        // two-sample check to avoid tunnelling
        const mx = (b.px + b.x) * 0.5, my = (b.py + b.y) * 0.5;
        const hit = wrapDist(b.x, b.y, p.x, p.y, this.w, this.h) <= p.radius + CONFIG.guns.radius ||
                    (!b.wrapped && wrapDist(mx, my, p.x, p.y, this.w, this.h) <= p.radius + CONFIG.guns.radius);
        if (hit) {
          b.dead = true;
          p.damage(CONFIG.guns.damage, this, b.owner);
          this.hitAt(p.x, p.y, p.col);
          this.shake(CONFIG.juice.shakeGunHit);
          break;
        }
      }
    }

    // Missiles vs planes & ships
    for (const m of this.missiles) {
      if (m.dead) continue;
      if (m.arm <= 0 && this._hitsShip(m.x, m.y, m.px, m.py, m.wrapped)) {
        m.detonate(this, false); this.shake(CONFIG.juice.shakeMissileHit * 0.5); continue;
      }
      if (m.arm > 0) continue;
      for (const p of this.planes) {
        if (!p.alive || p.idx === m.owner) continue;
        const d = wrapDist(m.x, m.y, p.x, p.y, this.w, this.h);
        if (d <= CONFIG.missile.proximityFuse + p.radius) {
          m.detonate(this, true);
          this._applyMissileDamage(m, p);
          this.shake(CONFIG.juice.shakeMissileHit);
          break;
        }
      }
    }

    // Plane vs ships (solid cover)
    for (const p of this.planes) if (p.alive) for (const s of this.obstacles) this._resolveShip(p, s, dt);

    // Plane vs plane (merge collision)
    const a = this.planes[0], b2 = this.planes[1];
    if (a.alive && b2.alive) {
      const d = wrapDelta(a.x, a.y, b2.x, b2.y, this.w, this.h);
      const dist = Math.hypot(d.dx, d.dy);
      if (dist < a.radius + b2.radius + 2 && a.spawnShield <= 0 && b2.spawnShield <= 0) {
        const nx = d.dx / (dist || 1), ny = d.dy / (dist || 1);
        a.x -= nx * 6; a.y -= ny * 6; b2.x += nx * 6; b2.y += ny * 6;
        a.vx -= nx * 80; a.vy -= ny * 80; b2.vx += nx * 80; b2.vy += ny * 80;
        a.damage(CONFIG.plane.collideDamage * dt * 4, this);
        b2.damage(CONFIG.plane.collideDamage * dt * 4, this);
        if (chance(0.3)) this.hitAt((a.x + b2.x) / 2, (a.y + b2.y) / 2, a.col);
      }
    }
  }

  _applyMissileDamage(m, direct) {
    const M = CONFIG.missile;
    for (const p of this.planes) {
      if (!p.alive || p.idx === m.owner) continue;
      const d = wrapDist(m.x, m.y, p.x, p.y, this.w, this.h);
      let dmg = 0;
      if (d <= M.proximityFuse + p.radius) dmg = M.damage;
      else if (d <= M.splashRadius) dmg = M.splashDamage * (1 - d / M.splashRadius);
      if (dmg > 0) p.damage(dmg, this, m.owner);
    }
  }

  _resolveShip(p, c, dt) {
    const pr = p.radius;
    const cos = Math.cos(-c.angle), sin = Math.sin(-c.angle);
    const dx = p.x - c.x, dy = p.y - c.y;
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    const exL = c.halfL + pr - Math.abs(lx), exW = c.halfW + pr - Math.abs(ly);
    if (exL > 0 && exW > 0) {
      // push out along the shallower penetration axis
      let nlx = lx, nly = ly;
      if (exL < exW) nlx = Math.sign(lx || 1) * (c.halfL + pr);
      else nly = Math.sign(ly || 1) * (c.halfW + pr);
      // rotate back
      const rcos = Math.cos(c.angle), rsin = Math.sin(c.angle);
      p.x = c.x + (nlx * rcos - nly * rsin);
      p.y = c.y + (nlx * rsin + nly * rcos);
      p.speed = Math.max(CONFIG.plane.minSpeed, p.speed * 0.6);
      p.vx *= 0.5; p.vy *= 0.5;
      p.damage(c.crashDps * dt, this);
      if (chance(0.4)) this.particles.hit(p.x, p.y, p.col);
    }
  }

  /* ------------------------------------------------------- WARNINGS */
  _updateThreatWarnings() {
    for (const p of this.planes) {
      const enemy = this.planes[1 - p.idx];
      p.warnLock = !!(enemy && enemy.alive && enemy.locked);
      let inbound = null, best = 1e9;
      for (const m of this.missiles) {
        if (m.target === p && m.arm <= 0) {
          const d = wrapDist(m.x, m.y, p.x, p.y, this.w, this.h);
          if (d < best) { best = d; inbound = m; }
        }
      }
      p.warnMissile = !!inbound;
      if (inbound) { const dd = wrapDelta(p.x, p.y, inbound.x, inbound.y, this.w, this.h); p.warnAngle = Math.atan2(dd.dy, dd.dx); }
    }
  }

  /* --------------------------------------------------------- ROUND FLOW */
  _checkRoundOutcome() {
    const a = this.planes[0], b = this.planes[1];
    if (a.alive && b.alive) return;
    this._roundResolved = true;
    // spawn kill explosions for the fallen
    if (!a.alive) this.explodeAt(a.x, a.y, 1.3);
    if (!b.alive) this.explodeAt(b.x, b.y, 1.3);
    this.shake(CONFIG.juice.shakeKill);
    this.hitStop = CONFIG.juice.hitStopKill;

    let winner = -1;
    if (!a.alive && !b.alive) {
      this.calloutGlobal('MUTUAL!', '#ffffff');
    } else {
      winner = a.alive ? 0 : 1;
      this.score[winner]++;
      const wp = this.planes[winner];
      this.calloutGlobal('SPLASH ONE!', wp.col.main);
      this.radio(winner, 'splash', 'SPLASH ONE!');
    }
    this.lastRoundWinner = winner;
    this.phase = 'roundEnd';
    this.phaseTime = CONFIG.match.roundEndPause;

    if (winner >= 0 && this.score[winner] >= CONFIG.match.roundsToWin) {
      this.matchWinner = winner;
    }
  }

  _advanceRound() {
    if (this.matchWinner >= 0) {
      this.phase = 'matchEnd';
      this.audio.sting();
      return;
    }
    this.round++;
    this.resetRound();
  }

  /* ----------------------------------------------------- AUDIO / EVENTS */
  // Per-frame cockpit tones for the "ears" (local player(s)). Called each frame
  // by main loop for LOCAL & host; the client drives its own in net.js.
  updateAudio(dt) {
    if (!this.audio.started || this.silent) return;
    const ears = this.mode === 'local' ? [0, 1] : [this.localIdx];
    // engines (both planes audible on a shared screen)
    for (let i = 0; i < 2; i++) {
      const p = this.planes[i];
      if (p) this.audio.engineSet(i, p.throttle, p.boosting, p.alive && this.phase !== 'matchEnd');
    }
    for (const i of ears) {
      const p = this.planes[i];
      if (!p) continue;
      if (this.phase !== 'fight') { this.audio.lockOff(i); this.audio.warnOff(i); continue; }
      // lock tone
      if (p.locked) {
        if (!this._lockDoneFlag[i]) { this.audio.lockDone(i); this._lockDoneFlag[i] = true; }
      } else {
        this._lockDoneFlag[i] = false;
        if (p.lockProg > 0.02) this.audio.setLock(i, p.lockProg);
        else this.audio.lockOff(i);
      }
      // incoming-missile alarm
      if (p.warnMissile) this.audio.warnOn(i); else this.audio.warnOff(i);
    }
  }

  // Which plane's perspective drives "own" shake etc. (local: both → -1 = any)
  localFocus() { return this.mode === 'online' ? this.localIdx : -1; }
  // In local play both planes are "local"; online, only the plane you fly.
  isLocalView(idx) { return this.mode !== 'online' || idx === this.localIdx; }

  sfx(name, ...args) {
    // guns are re-synthesized client-side from the 'gf' bit, so don't broadcast
    if (!this.silent && this.audio[name]) this.audio[name](...args);
    if (this.netRole === 'host' && name !== 'gun') this.pendingEvents.push({ e: 's', n: name, a: args });
  }
  explodeAt(x, y, scale) {
    this.particles.explosion(x, y, scale);
    if (!this.silent) this.audio.explosion(scale);
    if (this.netRole === 'host') this.pendingEvents.push({ e: 'x', x: Math.round(x), y: Math.round(y), s: +scale.toFixed(2) });
  }
  hitAt(x, y, col) {
    this.particles.hit(x, y, col);
    if (!this.silent) this.audio.hit();
    if (this.netRole === 'host') this.pendingEvents.push({ e: 'h', x: Math.round(x), y: Math.round(y), i: col === CONFIG.colors.p1 ? 0 : 1 });
  }
  // Shake is cosmetic; the client derives its own from explosion/hit events,
  // so we never broadcast it.
  shake(amt) { this.shakeAmt = Math.min(40, Math.max(this.shakeAmt, amt)); }

  radio(idx, kind, text) {
    // throttle spammy calls
    const key = idx + ':' + kind;
    const min = kind === 'guns' ? 1.7 : kind === 'fox2' ? 0.15 : 0.5;
    const last = this._radioTimes[key] || -99;
    if (this.time - last < min) return;
    this._radioTimes[key] = this.time;
    if (!this.silent) this.audio.radio(kind);
    if (idx < 0) this.calloutGlobal(text, CONFIG.colors.hudAmber);
    else {
      const p = this.planes[idx];
      this.callouts.push({ text, x: p.x, y: p.y - 32, follow: idx, color: p.col.glow, size: 15, life: 1.1, max: 1.1 });
    }
    if (this.netRole === 'host') this.pendingEvents.push({ e: 'r', i: idx, k: kind, t: text });
  }
  calloutGlobal(text, color) {
    this.callouts.push({ text, x: this.w / 2, y: this.h * 0.4, color, size: 46, life: 1.8, max: 1.8 });
  }
  _updateCallouts(dt) {
    for (let i = this.callouts.length - 1; i >= 0; i--) {
      const c = this.callouts[i];
      c.life -= dt;
      if (c.follow != null && this.planes[c.follow]) { c.x = this.planes[c.follow].x; c.y = this.planes[c.follow].y - 32; }
      else c.y -= 12 * dt;
      if (c.life <= 0) this.callouts.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------- LOS */
  losBlocked(x1, y1, x2, y2) {
    if (!this.obstacles.length) return false;
    // Use the near-image of the target for wrap correctness
    const d = wrapDelta(x1, y1, x2, y2, this.w, this.h);
    for (const s of this.obstacles) if (s.blocksSeg(x1, y1, x1 + d.dx, y1 + d.dy)) return true;
    return false;
  }

  /* --------------------------------------------------- STATE SNAPSHOT
   * Host -> client. Compact but complete enough to render & warn. */
  buildSnapshot(tick) {
    const P = this.planes.map(p => ({
      x: +p.x.toFixed(1), y: +p.y.toFixed(1), a: +p.angle.toFixed(3),
      th: +p.throttle.toFixed(2), b: p.boosting ? 1 : 0, hp: Math.round(p.health),
      am: p.ammo, fl: p.flares, bo: Math.round(p.boost),
      lp: +p.lockProg.toFixed(2), lk: p.locked ? 1 : 0,
      wl: p.warnLock ? 1 : 0, wm: p.warnMissile ? 1 : 0, al: p.alive ? 1 : 0,
      bk: +p.bank.toFixed(2), gh: +p.gunHeat.toFixed(2), go: p.gunOverheat ? 1 : 0, ss: p.spawnShield > 0 ? 1 : 0,
      gf: (p.wasFiring && !p.gunOverheat) ? 1 : 0, mc: p.missileCd > 0 ? 1 : 0,
    }));
    const M = this.missiles.map(m => ({ x: +m.x.toFixed(1), y: +m.y.toFixed(1), a: +m.angle.toFixed(3), f: m.fuel > 0 ? 1 : 0, o: m.owner }));
    const F = this.flares.map(f => ({ x: +f.x.toFixed(1), y: +f.y.toFixed(1), l: +(f.life / f.maxLife).toFixed(2) }));
    const B = this.bullets.map(b => ({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), px: +b.px.toFixed(1), py: +b.py.toFixed(1), o: b.owner }));
    const ev = this.pendingEvents;
    this.pendingEvents = [];
    return {
      t: 'state', tick, w: this.w, h: this.h, map: this.mapId,
      ph: this.phase, pt: +this.phaseTime.toFixed(2), rd: this.round,
      sc: this.score, mw: this.matchWinner, lw: this.lastRoundWinner,
      P, M, F, B, ev,
    };
  }
}
