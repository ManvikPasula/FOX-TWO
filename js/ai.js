/* ============================================================================
 * FOX TWO  —  AI
 * ----------------------------------------------------------------------------
 * A compact but competent dogfighting bot. Produces an input snapshot for a
 * plane (same shape as InputManager.snapshot) so it drops straight into the
 * sim. Used for the menu "attract" dogfight and the bonus PRACTICE mode.
 * ========================================================================== */

class AIController {
  constructor(skill = 0.72) {
    this.skill = skill;
    this.s = [this._mk(), this._mk()];
  }
  _mk() { return { missileC: 0, flareC: 0, fireCd: 0, flareCd: 0, jitter: 0, jitterT: 0, breakDir: 1 }; }
  reset() { this.s = [this._mk(), this._mk()]; }

  input(game, idx, dt) {
    const st = this.s[idx];
    const p = game.planes[idx], e = game.planes[1 - idx];
    const out = { rotLeft: false, rotRight: false, thrUp: false, thrDown: false, guns: false, boost: false, missileC: st.missileC, flareC: st.flareC };
    if (!p || !p.alive) return out;

    st.fireCd = Math.max(0, st.fireCd - dt);
    st.flareCd = Math.max(0, st.flareCd - dt);
    st.jitterT -= dt;
    if (st.jitterT <= 0) { st.jitterT = 0.4 + rand() * 0.7; st.jitter = randSpread(0.10 * (1 - this.skill) + 0.03); st.breakDir = chance(0.5) ? 1 : -1; }

    // Don't fly into ships or the arena walls — overrides everything else.
    if (this._avoid(game, p, out)) return out;

    if (!e || !e.alive) {
      // no target → lazy climbing circle so attract mode keeps moving
      out.rotRight = true; this._throttleToward(out, p, 0.6); return out;
    }

    const d = wrapDelta(p.x, p.y, e.x, e.y, game.w, game.h);
    const dist = Math.hypot(d.dx, d.dy);
    // aim with a little lead
    const lead = clamp(dist / (CONFIG.missile.speed), 0, 0.5);
    const aimX = e.x + e.vx * lead, aimY = e.y + e.vy * lead;
    const da = wrapDelta(p.x, p.y, aimX, aimY, game.w, game.h);
    let off = angDiff(p.angle, Math.atan2(da.dy, da.dx)) + st.jitter;

    // ---- DEFENSE: missile inbound → beam + flares + burner ----
    if (p.warnMissile) {
      // turn to put threat on the beam (perpendicular), then jink
      const threatOff = angDiff(p.angle, p.warnAngle);
      const target = threatOff + st.breakDir * (Math.PI / 2);
      if (target > 0.05) out.rotRight = true; else if (target < -0.05) out.rotLeft = true;
      this._throttleToward(out, p, 1);
      if (p.boost > 25) out.boost = true;
      if (st.flareCd <= 0 && p.flares > 0) { st.flareC++; out.flareC = st.flareC; st.flareCd = 0.5; }
      return out;
    }

    // ---- OFFENSE ----
    const dead = 0.02 + 0.05 * (1 - this.skill);
    if (off > dead) out.rotRight = true; else if (off < -dead) out.rotLeft = true;

    // throttle: close distance but don't overshoot in a knife fight
    let want = 0.9;
    if (dist < 220) want = 0.5;
    else if (dist < 400) want = 0.72;
    this._throttleToward(out, p, want);

    // afterburner to close big gaps or reposition (watch heat/boost)
    if (dist > 520 && Math.abs(off) < 0.4 && p.boost > 45) out.boost = true;

    // guns when close and on the nose — but ease off before overheating
    if (dist < 300 && Math.abs(off) < 0.11 && !p.gunOverheat && p.gunHeat < 0.82) out.guns = true;

    // missiles when locked (skill-gated patience)
    if (p.locked && st.fireCd <= 0 && p.ammo > 0) {
      st.missileC++; out.missileC = st.missileC; st.fireCd = 1.4 + rand() * 1.2;
    }

    return out;
  }

  _throttleToward(out, p, want) {
    if (p.throttle < want - 0.05) out.thrUp = true;
    else if (p.throttle > want + 0.05) out.thrDown = true;
  }

  // Steer away from an impending wall or ship. Returns true if it took over.
  _avoid(game, p, out) {
    const nx = p.x + Math.cos(p.angle) * 80, ny = p.y + Math.sin(p.angle) * 80;
    // walls
    const pad = 48;
    if (!CONFIG.world.wrap && (nx < pad || ny < pad || nx > game.w - pad || ny > game.h - pad)) {
      const off = angDiff(p.angle, Math.atan2(game.h / 2 - p.y, game.w / 2 - p.x));
      out.rotRight = off > 0.03; out.rotLeft = off < -0.03; out.thrUp = true;
      return true;
    }
    // ships
    for (const s of (game.obstacles || [])) {
      if (s.containsPoint(nx, ny, 24) || s.containsPoint(p.x + Math.cos(p.angle) * 46, p.y + Math.sin(p.angle) * 46, 20)) {
        const cross = Math.cos(p.angle) * (s.y - p.y) - Math.sin(p.angle) * (s.x - p.x);
        out.rotLeft = cross > 0; out.rotRight = cross <= 0; out.thrUp = true;
        return true;
      }
    }
    return false;
  }
}
