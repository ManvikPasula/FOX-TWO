/* ============================================================================
 * FOX TWO  —  ENTITIES
 * ----------------------------------------------------------------------------
 * Plane (energy-based flight), Bullet, Missile (IR seeker), Flare, Ship
 * (carrier/destroyer), and a lightweight ParticleSystem. Delta-time based;
 * bounded arena by default (wrap-aware helpers still support toroidal mode).
 * ========================================================================== */

/* ------------------------------------------------------------------ PLANE */
class Plane {
  constructor(idx, callsign) {
    this.idx = idx;
    this.team = idx === 0 ? 'p1' : 'p2';
    this.col = idx === 0 ? CONFIG.colors.p1 : CONFIG.colors.p2;
    this.callsign = callsign || (idx === 0 ? 'ICE' : 'SUN');
    this.radius = CONFIG.plane.radius;   // used by all collision checks
    this.reset(0, 0, 0);
  }

  reset(x, y, angle) {
    const P = CONFIG.plane;
    this.x = x; this.y = y; this.angle = angle;
    this.vx = Math.cos(angle) * P.minSpeed;
    this.vy = Math.sin(angle) * P.minSpeed;
    this.speed = P.minSpeed;
    this.throttle = P.defaultThrottle;
    this.health = P.maxHealth;
    this.alive = true;
    this.boost = CONFIG.boost.max;
    this.boosting = false;
    this.boostDelay = 0;
    this.bank = 0;
    this.turnHard = 0;
    this.gunHeat = 0;
    this.gunOverheat = false;
    this.gunCoolDelay = 0;
    this.fireTimer = 0;
    this.wasFiring = false;
    this.ammo = CONFIG.missile.ammo;
    this.missileCd = 0;
    this.flares = CONFIG.flare.count;
    this.flareCd = 0;
    this.lockProg = 0;             // my lock onto the enemy (shooter side)
    this.locked = false;
    this.emitHeat = CONFIG.heat.base;
    // warnings (target side) — filled by the game each frame
    this.warnLock = false;        // enemy has completed a lock on me
    this.warnMissile = false;     // a missile is homing me
    this.warnAngle = 0;           // direction to the threat
    // last consumed tap-counters (edge detection, local & net identical)
    this._lastMissileC = null;
    this._lastFlareC = null;
    // trail history for contrail rendering
    this.trail = [];
    this.hitFlash = 0;
    this.spawnShield = 0;         // brief invuln after round reset
  }

  // Base IR emission (before aspect/concealment, applied by the seeker).
  turnRate() {
    const P = CONFIG.plane;
    if (this.boosting) return P.turnRateAB;
    const f = invlerp(P.minSpeed, P.maxSpeed, this.speed);
    return lerp(P.turnRateLow, P.turnRateHigh, f);
  }

  update(input, dt, game) {
    if (!this.alive) return;
    this._physics(input, dt, game);
    this._weapons(input, dt, game);
    // cooldowns
    this.flareCd = Math.max(0, this.flareCd - dt);
    this.missileCd = Math.max(0, this.missileCd - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.spawnShield = Math.max(0, this.spawnShield - dt);
    // trail
    this.trail.push(this.x, this.y);
    if (this.trail.length > 44) this.trail.splice(0, 2);
  }

  _physics(input, dt, game) {
    const P = CONFIG.plane, B = CONFIG.boost, H = CONFIG.heat;
    const turnInput = (input.rotRight ? 1 : 0) - (input.rotLeft ? 1 : 0);

    // Afterburner
    let wantBoost = input.boost && this.boost > B.minToEngage;
    if (this.boost <= 0) wantBoost = false;
    this.boosting = wantBoost && this.boost > 0;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - B.drain * dt);
      this.boostDelay = B.regenDelay;
    } else {
      this.boostDelay = Math.max(0, this.boostDelay - dt);
      if (this.boostDelay <= 0) this.boost = Math.min(B.max, this.boost + B.regen * dt);
    }

    // Rotation (turn rate falls off with speed / afterburner)
    this.angle = normAngle(this.angle + turnInput * this.turnRate() * dt);
    this.turnHard = damp(this.turnHard, Math.abs(turnInput), 8, dt);

    // Throttle
    this.throttle = clamp(this.throttle + ((input.thrUp ? 1 : 0) - (input.thrDown ? 1 : 0)) * P.throttleRate * dt, 0, 1);

    // Speed eases toward target at a constant accel; hard turns bleed energy
    const target = this.boosting ? P.afterburnerSpeed : lerp(P.minSpeed, P.maxSpeed, this.throttle);
    const step = P.throttleAccel * dt;
    if (this.speed < target) this.speed = Math.min(target, this.speed + step);
    else this.speed = Math.max(target, this.speed - step);
    this.speed -= P.turnBleed * Math.abs(turnInput) * dt;
    this.speed = clamp(this.speed, P.minSpeed, P.afterburnerSpeed);

    // Velocity vector eases toward heading*speed → weighty drift on hard turns
    const dvx = Math.cos(this.angle) * this.speed;
    const dvy = Math.sin(this.angle) * this.speed;
    this.vx = damp(this.vx, dvx, P.velEase, dt);
    this.vy = damp(this.vy, dvy, P.velEase, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    wrapPos(this, game.w, game.h);
    // Hard bounds (no wrap): clamp to the arena and kill the outward velocity so
    // the jet slides along the wall instead of leaving the fight.
    if (!CONFIG.world.wrap) {
      const pad = this.radius + 4;
      if (this.x < pad) { this.x = pad; if (this.vx < 0) this.vx = 0; }
      else if (this.x > game.w - pad) { this.x = game.w - pad; if (this.vx > 0) this.vx = 0; }
      if (this.y < pad) { this.y = pad; if (this.vy < 0) this.vy = 0; }
      else if (this.y > game.h - pad) { this.y = game.h - pad; if (this.vy > 0) this.vy = 0; }
      this.atEdge = (this.x <= pad + 1 || this.x >= game.w - pad - 1 || this.y <= pad + 1 || this.y >= game.h - pad - 1);
    }

    // Visual bank into the turn
    this.bank = damp(this.bank, -turnInput * P.bankMax, P.bankEase, dt);

    // IR emission
    this.emitHeat = H.base + H.throttleScale * this.throttle + (this.boosting ? H.afterburner : 0);

    // Engine exhaust particles
    const back = this.angle + Math.PI;
    const bx = this.x + Math.cos(back) * (P.radius + 2);
    const by = this.y + Math.sin(back) * (P.radius + 2);
    const abF = this.boosting ? 2.2 : 1;
    if (game.particles) {
      game.particles.exhaust(bx, by, back, this.speed, this.col, this.boosting, this.throttle);
    }
  }

  _weapons(input, dt, game) {
    const enemy = game.planes[1 - this.idx];

    // ---- Lock logic (shooter side) ----
    const M = CONFIG.missile;
    let canLock = false;
    if (enemy && enemy.alive) {
      const d = wrapDelta(this.x, this.y, enemy.x, enemy.y, game.w, game.h);
      const dist = Math.hypot(d.dx, d.dy);
      const off = Math.abs(angDiff(this.angle, Math.atan2(d.dy, d.dx)));
      const los = !game.losBlocked(this.x, this.y, enemy.x, enemy.y);
      canLock = dist <= M.lockRange && off <= M.lockConeHalf && los;
    }
    if (canLock) {
      // Hotter target = faster lock. Afterburner spikes IR heat, so a burning
      // bandit gets locked up much quicker (on top of being easier to track).
      const heatMul = clamp(enemy.emitHeat / M.lockHeatRef, M.lockRateMin, M.lockRateMax);
      this.lockProg = Math.min(1, this.lockProg + (dt / M.lockTime) * heatMul);
    } else {
      this.lockProg = Math.max(0, this.lockProg - dt / M.lockTime * M.lockDecayMul);
    }
    this.locked = this.lockProg >= 1 && this.ammo > 0;
    // (lock/warn cockpit tones are driven per-frame in Game.updateAudio)

    // ---- Guns (heat / overheat) ----
    const G = CONFIG.guns;
    if (this.gunOverheat && this.gunHeat <= G.overheatCoolTo) this.gunOverheat = false;
    this.fireTimer -= dt;
    this.gunCoolDelay = Math.max(0, this.gunCoolDelay - dt);
    const canFire = input.guns && !this.gunOverheat;
    if (canFire && this.fireTimer <= 0) {
      this._fireGun(game);
      this.fireTimer = G.fireInterval;
      this.gunHeat += G.heatPerShot;
      this.gunCoolDelay = G.coolDelay;         // must let off the trigger to cool
      if (this.gunHeat >= 1) { this.gunHeat = 1; this.gunOverheat = true; }
    } else if (this.gunCoolDelay <= 0) {
      this.gunHeat = Math.max(0, this.gunHeat - G.coolPerSec * dt);
    }
    if (input.guns && !this.wasFiring && !this.gunOverheat) {
      game.radio(this.idx, 'guns', 'GUNS GUNS GUNS');
    }
    this.wasFiring = input.guns;

    // ---- Missile (edge-triggered via monotonic counter) ----
    if (this._lastMissileC === null) this._lastMissileC = input.missileC;
    if (input.missileC > this._lastMissileC) {
      this._lastMissileC = input.missileC;
      if (this.ammo > 0 && this.missileCd <= 0) this._fireMissile(game, enemy);
    }

    // ---- Flares ----
    if (this._lastFlareC === null) this._lastFlareC = input.flareC;
    if (input.flareC > this._lastFlareC) {
      this._lastFlareC = input.flareC;
      if (this.flares > 0 && this.flareCd <= 0) this._dropFlares(game);
    }
  }

  _fireGun(game) {
    const P = CONFIG.plane, G = CONFIG.guns;
    const nx = this.x + Math.cos(this.angle) * (P.radius + 6);
    const ny = this.y + Math.sin(this.angle) * (P.radius + 6);
    const a = this.angle + randSpread(G.spread);
    const vx = this.vx * G.inheritVel + Math.cos(a) * G.muzzleSpeed;
    const vy = this.vy * G.inheritVel + Math.sin(a) * G.muzzleSpeed;
    game.bullets.push(new Bullet(nx, ny, vx, vy, this.idx, this.col));
    game.particles.muzzle(nx, ny, a, this.col);
    game.sfx('gun');
  }

  _fireMissile(game, enemy) {
    const P = CONFIG.plane, M = CONFIG.missile;
    this.ammo--;
    this.missileCd = M.cooldown;
    const nx = this.x + Math.cos(this.angle) * (P.radius + 8);
    const ny = this.y + Math.sin(this.angle) * (P.radius + 8);
    const m = new Missile(nx, ny, this.angle, this.speed + M.launchSpeedBonus, this.idx);
    // A completed lock hands the missile its target immediately.
    if (this.locked && enemy && enemy.alive) m.target = enemy;
    game.missiles.push(m);
    this.lockProg = 0; this.locked = false;
    game.sfx('missileLaunch');
    game.radio(this.idx, 'fox2', 'FOX TWO!');
    if (this.ammo === 0) game.radio(this.idx, 'winchester', 'WINCHESTER');
    game.shake(4);
  }

  _dropFlares(game) {
    const F = CONFIG.flare;
    this.flares--;
    this.flareCd = F.cooldown;
    const back = this.angle + Math.PI;
    for (let i = 0; i < F.perDrop; i++) {
      const a = back + randSpread(F.spread);
      const vx = this.vx * 0.35 + Math.cos(a) * F.ejectSpeed;
      const vy = this.vy * 0.35 + Math.sin(a) * F.ejectSpeed;
      game.flares.push(new Flare(this.x, this.y, vx, vy, this.idx));
    }
    game.sfx('flareDrop');
    game.radio(this.idx, 'flares', 'FLARES!');
  }

  damage(amount, game, sourceIdx) {
    if (!this.alive || this.spawnShield > 0) return false;
    this.health -= amount;
    this.hitFlash = 1;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      return true; // killed
    }
    return false;
  }
}

/* ----------------------------------------------------------------- BULLET */
class Bullet {
  constructor(x, y, vx, vy, owner, col) {
    this.x = x; this.y = y; this.px = x; this.py = y;
    this.vx = vx; this.vy = vy;
    this.owner = owner;
    this.col = col;
    this.life = CONFIG.guns.life;
    this.dead = false;
    this.wrapped = false;
  }
  update(dt, game) {
    this.px = this.x; this.py = this.y;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const before = this.x;
    this.wrapped = false;
    const bx = this.x, by = this.y;
    wrapPos(this, game.w, game.h);
    if (Math.abs(this.x - bx) > 1 || Math.abs(this.y - by) > 1) this.wrapped = true;
    // no wrap → tracers die at the edge
    if (!CONFIG.world.wrap && (this.x < 0 || this.y < 0 || this.x > game.w || this.y > game.h)) this.dead = true;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
}

/* ---------------------------------------------------------------- MISSILE */
class Missile {
  constructor(x, y, angle, speed, owner) {
    this.x = x; this.y = y; this.px = x; this.py = y;
    this.angle = angle;
    this.speed = speed;
    this.owner = owner;
    this.target = null;         // Plane it's homing (may switch to a flare)
    this.decoy = null;          // Flare it's been seduced by
    this.fuel = CONFIG.missile.fuel;
    this.dumb = CONFIG.missile.dumbLife;
    this.arm = CONFIG.missile.armTime;
    this.dead = false;
    this.detonated = false;
    this.trailT = 0;
    this.wrapped = false;
  }

  update(dt, game) {
    const M = CONFIG.missile;
    this.arm = Math.max(0, this.arm - dt);
    const powered = this.fuel > 0;
    if (powered) this.fuel -= dt; else this.dumb -= dt;
    if (this.dumb <= 0) { this.dead = true; game.particles.puff(this.x, this.y); return; }

    // ---- IR seeker ----
    // The seeker only "sees" heat inside a forward cone (with clear LOS). It
    // steers ONLY while its aim is in view; the moment a hard break (or the
    // carrier) takes the aim out of view it flies ballistic and overshoots —
    // that's what makes locks survivable. Once seduced by a flare it commits.
    if (powered) {
      const best = this._bestSource(game);
      if (best) {
        if (best.isFlare) {
          if (best.obj !== this.decoy && chance(M.reseekChance)) { this.decoy = best.obj; this.target = null; this._grace = 0; }
        } else if (!this.decoy) {
          this.target = best.obj; this._grace = 0;      // chase the plane (unless already decoyed)
        }
      }
      if (this.decoy && (this.decoy.dead || this.decoy.life <= 0)) this.decoy = null;
      if (this.target && !this.target.alive) this.target = null;

      const aim = this.decoy || this.target;
      const aimVisible = !!(best && aim && best.obj === aim);
      if (aim) {
        if (aimVisible) {
          this._grace = 0;
          const d = wrapDelta(this.x, this.y, aim.x, aim.y, game.w, game.h);
          this.angle = turnToward(this.angle, Math.atan2(d.dy, d.dx), M.turnRate * dt);
        } else {
          // lost sight — coast straight; forget the aim entirely after the grace
          this._grace = (this._grace || 0) + dt;
          if (this._grace > M.loseTargetGrace) { this.target = null; this.decoy = null; }
        }
      }
      this.speed = Math.min(M.speed, this.speed + M.accel * dt);
    }

    // move
    this.px = this.x; this.py = this.y;
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    const bx = this.x, by = this.y;
    wrapPos(this, game.w, game.h);
    this.wrapped = (Math.abs(this.x - bx) > 1 || Math.abs(this.y - by) > 1);
    // no wrap → a missile that flies off the arena fizzles out
    if (!CONFIG.world.wrap && (this.x < -24 || this.y < -24 || this.x > game.w + 24 || this.y > game.h + 24)) {
      this.dead = true; game.particles.puff(this.x, this.y); return;
    }

    // smoke trail
    this.trailT -= dt;
    if (this.trailT <= 0) { this.trailT = 0.012; game.particles.smoke(this.x, this.y, powered); }
  }

  // Score every visible heat source; return the best {obj, isFlare, score}.
  _bestSource(game) {
    const M = CONFIG.missile, H = CONFIG.heat;
    let best = null;
    const consider = (obj, heat, isFlare) => {
      const d = wrapDelta(this.x, this.y, obj.x, obj.y, game.w, game.h);
      const dist = Math.hypot(d.dx, d.dy);
      if (dist > M.lockRange * 1.6) return;
      const ang = Math.atan2(d.dy, d.dx);
      const off = Math.abs(angDiff(this.angle, ang));
      if (off > M.seekConeHalf) return;
      if (game.losBlocked(this.x, this.y, obj.x, obj.y)) return;
      let h = heat;
      if (!isFlare) {
        // rear-aspect bonus: hotter from directly behind the target
        const toMx = -d.dx, toMy = -d.dy;
        const tl = Math.hypot(toMx, toMy) || 1;
        const dot = (Math.cos(obj.angle) * toMx + Math.sin(obj.angle) * toMy) / tl;
        h += H.rearAspectBonus * clamp(-dot, 0, 1);
        h *= (1 - H.turnConcealment * (obj.turnHard || 0));
      } else if (obj.owner != null && game.planes[obj.owner] && game.planes[obj.owner].turnHard > 0.5) {
        // reward flares + a hard break together
        h *= CONFIG.flare.breakBonus;
      }
      const distF = 340 / (340 + dist);
      const angF = 1 - 0.55 * (off / M.seekConeHalf);
      const score = h * distF * angF;
      if (!best || score > best.score) best = { obj, isFlare, score };
    };
    // enemy plane (not owner)
    for (const p of game.planes) {
      if (!p || p.idx === this.owner || !p.alive) continue;
      consider(p, p.emitHeat, false);
    }
    // all flares
    for (const f of game.flares) if (f.life > 0) consider(f, f.heat * (0.35 + 0.65 * (f.life / f.maxLife)), true);
    return best;
  }

  detonate(game, big) {
    if (this.detonated) return;
    this.detonated = true;
    this.dead = true;
    game.explodeAt(this.x, this.y, big ? 1 : 0.7);
  }
}

/* ------------------------------------------------------------------ FLARE */
class Flare {
  constructor(x, y, vx, vy, owner) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.owner = owner;
    this.maxLife = CONFIG.flare.life;
    this.life = this.maxLife;
    this.heat = CONFIG.flare.heat;
    this.dead = false;
  }
  update(dt, game) {
    this.vx *= (1 - 2.4 * dt);
    this.vy *= (1 - 2.4 * dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
    wrapPos(this, game.w, game.h);
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    if (chance(0.9)) game.particles.flareSpark(this.x, this.y);
  }
}

/* ------------------------------------------------------------------ SHIP */
// One obstacle: 'carrier' or 'destroyer'. Blocks guns/missiles/LOS and scrapes
// planes that touch it. Placement comes from the chosen map.
class Ship {
  constructor(kind, x, y, angle) {
    this.kind = kind;
    const D = kind === 'destroyer' ? CONFIG.destroyer : CONFIG.carrier;
    this.len = D.length; this.wid = D.width;
    this.crashDps = D.crashDps;
    this.x = x; this.y = y; this.angle = angle || 0;
    this.halfL = this.len / 2; this.halfW = this.wid / 2;
    this.bob = 0;
  }
  update(dt) { this.bob += dt; }
  blocksSeg(ax, ay, bx, by) { return segOBB(ax, ay, bx, by, this.x, this.y, this.halfL, this.halfW, this.angle); }
  containsPoint(px, py, pad = 0) { return pointInOBB(px, py, this.x, this.y, this.halfL + pad, this.halfW + pad, this.angle); }
}

/* ------------------------------------------------------- PARTICLE SYSTEM */
class ParticleSystem {
  constructor() { this.parts = []; this.max = 1400; }
  clear() { this.parts.length = 0; }

  _add(p) { if (this.parts.length < this.max) this.parts.push(p); }

  exhaust(x, y, dir, speed, col, ab, throttle) {
    const n = ab ? 3 : (throttle > 0.4 ? 1 : 0.5);
    if (!ab && rand() > 0.6) return;
    for (let i = 0; i < Math.ceil(n); i++) {
      const a = dir + randSpread(0.25);
      const sp = (ab ? 90 : 40) + rand() * 40;
      this._add({
        x: x + randSpread(3), y: y + randSpread(3),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: ab ? 0.35 : 0.22, max: ab ? 0.35 : 0.22,
        size: ab ? 5 : 3, drag: 3,
        color: ab ? '#fff2c2' : col.trail, glow: ab, type: 'exhaust',
      });
    }
  }
  muzzle(x, y, dir, col) {
    for (let i = 0; i < 5; i++) {
      const a = dir + randSpread(0.4);
      const sp = 120 + rand() * 160;
      this._add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.09, max: 0.09, size: 3, drag: 6, color: '#fff6d0', glow: true, type: 'spark' });
    }
  }
  smoke(x, y, powered) {
    this._add({
      x: x + randSpread(2), y: y + randSpread(2),
      vx: randSpread(10), vy: randSpread(10),
      life: powered ? 0.9 : 0.5, max: powered ? 0.9 : 0.5,
      size: powered ? 4 : 3, drag: 1.5,
      color: powered ? 'rgba(255,220,180,1)' : 'rgba(180,180,190,1)', glow: false, type: 'smoke', grow: 10,
    });
  }
  flareSpark(x, y) {
    const a = rand() * TAU, sp = 20 + rand() * 90;
    this._add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 20, life: 0.4 + rand() * 0.3, max: 0.7, size: 2.6, drag: 3, color: rand() > 0.4 ? '#fff' : '#ffd36b', glow: true, type: 'spark' });
  }
  puff(x, y) {
    for (let i = 0; i < 6; i++) { const a = rand() * TAU, sp = 20 + rand() * 40; this._add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, max: 0.4, size: 4, drag: 2, color: 'rgba(160,160,170,1)', glow: false, type: 'smoke', grow: 12 }); }
  }
  explosion(x, y, scale = 1) {
    const N = Math.floor(26 * scale);
    for (let i = 0; i < N; i++) {
      const a = rand() * TAU, sp = (80 + rand() * 300) * scale;
      const warm = rand();
      this._add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.35 + rand() * 0.5, max: 0.85,
        size: (3 + rand() * 5) * scale, drag: 2.4,
        color: warm > 0.66 ? '#fff' : warm > 0.33 ? '#ffcf5b' : '#ff6a2b',
        glow: true, type: 'spark',
      });
    }
    // smoke ball
    for (let i = 0; i < Math.floor(12 * scale); i++) {
      const a = rand() * TAU, sp = 20 + rand() * 90 * scale;
      this._add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7 + rand() * 0.6, max: 1.3, size: (6 + rand() * 8) * scale, drag: 1.6, color: 'rgba(60,50,55,1)', glow: false, type: 'smoke', grow: 26 });
    }
    // shockwave ring
    this._add({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 8, drag: 0, color: '#fff', glow: true, type: 'ring', grow: 900 * scale });
  }
  hit(x, y, col) {
    for (let i = 0; i < 8; i++) { const a = rand() * TAU, sp = 60 + rand() * 160; this._add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.25, max: 0.25, size: 3, drag: 4, color: rand() > 0.5 ? '#fff' : col, glow: true, type: 'spark' }); }
  }

  update(dt, game) {
    const arr = this.parts;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.drag) { const f = 1 - p.drag * dt; p.vx *= f; p.vy *= f; }
      if (p.grow) p.size += p.grow * dt;
      if (game) wrapPos(p, game.w, game.h);
    }
  }
}
