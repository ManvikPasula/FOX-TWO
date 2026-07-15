/* ============================================================================
 * FOX TWO  —  RENDER
 * ----------------------------------------------------------------------------
 * All drawing: sunset-over-ocean backdrop, aircraft carrier, jets with
 * afterburner + contrails, weapons/effects, and the amber/green military HUD.
 * Wrap-aware: planes/missiles/flares draw ghost copies across the seam.
 * CRT scanlines & vignette are applied cheaply via CSS overlay (index.html).
 * ========================================================================== */

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = canvas.width; this.h = canvas.height;   // world dims (set each render)
    this.cw = canvas.width; this.ch = canvas.height; // canvas dims
  }
  resize(w, h) { this.canvas.width = w; this.canvas.height = h; this.cw = w; this.ch = h; }

  /* Call fn(offsetX, offsetY) for the entity plus any wrapped ghost copies
   * needed because it's near an edge. */
  _wrap(x, y, W, H, margin, fn) {
    fn(0, 0);
    if (!CONFIG.world.wrap) return;
    const left = x < margin, right = x > W - margin;
    const top = y < margin, bot = y > H - margin;
    if (left) fn(W, 0); if (right) fn(-W, 0);
    if (top) fn(0, H); if (bot) fn(0, -H);
    if (left && top) fn(W, H); if (right && top) fn(-W, H);
    if (left && bot) fn(W, -H); if (right && bot) fn(-W, -H);
  }

  render(game) {
    const ctx = this.ctx;
    // world dims come from the game; fit them into the canvas (letterbox)
    this.w = game.w; this.h = game.h;
    const scale = Math.min(this.cw / this.w, this.ch / this.h);
    const offX = (this.cw - this.w * scale) / 2;
    const offY = (this.ch - this.h * scale) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.cw, this.ch);
    // enter world space
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    this.fit = { scale, offX, offY };

    ctx.save();
    // screen shake
    const s = game.shakeAmt;
    if (s > 0.1) ctx.translate(randSpread(s), randSpread(s));

    this.drawBackground(game);
    this.drawBounds(game);
    this.drawObstacles(game);

    // flares (under planes)
    for (const f of game.flares) this._wrap(f.x, f.y, game.w, game.h, 30, (ox, oy) => this.drawFlare(ctx, f, ox, oy));
    // particles
    this.drawParticles(game);
    // bullets
    for (const b of game.bullets) this.drawBullet(ctx, b);
    // missiles
    for (const m of game.missiles) this._wrap(m.x, m.y, game.w, game.h, 30, (ox, oy) => this.drawMissile(ctx, m, ox, oy, game));
    // planes + their reticles
    for (const p of game.planes) if (p && p.alive) this._wrap(p.x, p.y, game.w, game.h, 60, (ox, oy) => this.drawPlane(ctx, p, ox, oy, game));
    // lock reticles (world-space, over enemy)
    for (const p of game.planes) if (p && p.alive) this.drawReticle(ctx, p, game);

    ctx.restore(); // end shake

    // HUD + banners are drawn in world space but without shake
    this.drawWarnings(game);
    this.drawHUD(game);
    this.drawBanners(game);
    this.drawCallouts(game);

    ctx.restore(); // end world fit transform
  }

  /* --------------------------------------------------------- BACKGROUND */
  drawBackground(game) {
    const ctx = this.ctx, W = this.w, H = this.h, t = game.time;
    // Sunset gradient (sun toward the top): purple -> magenta -> orange
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.0, '#ff9d4d');
    g.addColorStop(0.18, '#ff6a3d');
    g.addColorStop(0.42, '#b13a75');
    g.addColorStop(0.7, '#5b2170');
    g.addColorStop(1.0, '#180a3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Sun glow high-center
    const sunX = W * 0.5, sunY = H * 0.06;
    const rg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, W * 0.5);
    rg.addColorStop(0, 'rgba(255,240,200,0.85)');
    rg.addColorStop(0.25, 'rgba(255,180,90,0.35)');
    rg.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // Sun-glint column on the "water" with moving sparkle
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const colW = W * 0.16;
    for (let y = H * 0.12; y < H; y += 8) {
      const spread = colW * (0.3 + (y / H) * 1.2);
      const alpha = 0.06 * (1 - y / H) + 0.02;
      const wob = Math.sin(y * 0.06 + t * 2.2) * spread * 0.12;
      ctx.fillStyle = `rgba(255,210,140,${alpha})`;
      ctx.fillRect(sunX - spread / 2 + wob, y, spread, 3);
    }
    ctx.restore();

    // Wave shimmer — faint drifting horizontal streaks
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 46; i++) {
      const yy = ((i * 137.5 + t * 12 + i * i) % H);
      const xx = ((i * 213.7 + Math.sin(t * 0.6 + i) * 60) % W);
      const len = 14 + (i % 5) * 8;
      const a = 0.035 + 0.03 * (1 - yy / H);
      ctx.fillStyle = `rgba(255,200,170,${a})`;
      ctx.fillRect(xx, yy, len, 1.4);
    }
    ctx.restore();

    // Soft high cloud streaks near the top, sunlit
    ctx.save();
    ctx.globalAlpha = 0.10;
    for (let i = 0; i < 5; i++) {
      const cy = H * (0.06 + i * 0.05);
      const cx = ((t * (6 + i * 3) + i * 300) % (W + 400)) - 200;
      ctx.fillStyle = i % 2 ? '#ffd9a8' : '#ff9a6a';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 160 - i * 15, 8, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* --------------------------------------------------------- ARENA BOUNDS */
  // With wrap off, draw a "combat zone" frame so the hard edge is legible, and
  // flash the side a jet is pressed against.
  drawBounds(game) {
    if (CONFIG.world.wrap) return;
    const ctx = this.ctx, W = game.w, H = game.h, t = game.time;
    const inset = CONFIG.world.boundPad + 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,206,74,0.30)';
    ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 20;
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    ctx.setLineDash([]);
    // corner brackets
    ctx.strokeStyle = 'rgba(255,206,74,0.55)'; ctx.lineWidth = 3;
    const L = 26, m = inset;
    const corner = (cx, cy, sx, sy) => { ctx.beginPath(); ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L); ctx.stroke(); };
    corner(m, m, 1, 1); corner(W - m, m, -1, 1); corner(m, H - m, 1, -1); corner(W - m, H - m, -1, -1);
    // edge warning glow when a plane is hugging the wall
    for (const p of game.planes) {
      if (!p || !p.alive || !p.atEdge) continue;
      ctx.save(); ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 16); ctx.strokeStyle = CONFIG.colors.warn; ctx.lineWidth = 4;
      ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2); ctx.restore();
      break;
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ OBSTACLES */
  drawObstacles(game) {
    for (const s of game.obstacles) {
      if (s.kind === 'destroyer') this.drawDestroyer(s, game.time);
      else this.drawCarrier(s, game.time);
    }
  }

  _wake(ctx, c, scale) {
    ctx.save();
    ctx.rotate(c.angle);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(200,220,255,0.10)';
    const ext = 110 * scale, spr = (c.halfW + 26) * 1;
    ctx.beginPath();
    ctx.moveTo(c.halfL, -c.halfW);
    ctx.lineTo(c.halfL + ext, -spr); ctx.lineTo(c.halfL + ext, spr); ctx.lineTo(c.halfL, c.halfW);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawCarrier(c, time) {
    const ctx = this.ctx;
    const bob = Math.sin(c.bob * 0.8) * 1.5;
    ctx.save();
    ctx.translate(c.x, c.y + bob);
    this._wake(ctx, c, 1);
    ctx.rotate(c.angle);
    // hull shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    this._roundRect(ctx, -c.halfL + 4, -c.halfW + 5, c.len, c.wid, 10); ctx.fill();
    // deck
    const dg = ctx.createLinearGradient(0, -c.halfW, 0, c.halfW);
    dg.addColorStop(0, '#3a3f4a'); dg.addColorStop(0.5, '#565c68'); dg.addColorStop(1, '#2c313b');
    ctx.fillStyle = dg;
    this._roundRect(ctx, -c.halfL, -c.halfW, c.len, c.wid, 10); ctx.fill();
    ctx.strokeStyle = '#1a1d24'; ctx.lineWidth = 2;
    this._roundRect(ctx, -c.halfL, -c.halfW, c.len, c.wid, 10); ctx.stroke();
    // angled runway stripe + centerline
    ctx.strokeStyle = 'rgba(240,240,245,0.55)'; ctx.lineWidth = 3;
    ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.moveTo(-c.halfL + 16, 3); ctx.lineTo(c.halfL - 24, -c.wid * 0.16); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,220,80,0.8)';
    for (let i = -1; i <= 1; i++) ctx.fillRect(-c.halfL + 40 + i * 14, -3, 8, 6);
    ctx.fillStyle = 'rgba(240,240,245,0.7)';
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.translate(-c.halfL + 40, 0); ctx.rotate(-Math.PI / 2); ctx.fillText('07', 0, 0); ctx.restore();
    // island superstructure
    ctx.fillStyle = '#20242c';
    this._roundRect(ctx, c.halfL * 0.1, -c.halfW - 2, 46, -20, 3); ctx.fill();
    ctx.fillStyle = '#3a4652';
    ctx.fillRect(c.halfL * 0.1 + 4, -c.halfW - 20, 38, 8);
    if (Math.sin(time * 5) > 0) { ctx.fillStyle = '#ff5b5b'; ctx.beginPath(); ctx.arc(c.halfL * 0.1 + 42, -c.halfW - 18, 2.4, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  drawDestroyer(c, time) {
    const ctx = this.ctx;
    const bob = Math.sin(c.bob * 1.1 + c.x) * 1.2;
    ctx.save();
    ctx.translate(c.x, c.y + bob);
    this._wake(ctx, c, 0.7);
    ctx.rotate(c.angle);
    // hull: pointed bow, squared stern
    const hl = c.halfL, hw = c.halfW;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.moveTo(hl + 4, 1 + 3); ctx.lineTo(hl - 14 + 4, -hw + 3); ctx.lineTo(-hl + 4, -hw + 3);
    ctx.lineTo(-hl + 4, hw + 3); ctx.lineTo(hl - 14 + 4, hw + 3); ctx.closePath(); ctx.fill();
    const hg = ctx.createLinearGradient(0, -hw, 0, hw);
    hg.addColorStop(0, '#454b57'); hg.addColorStop(0.5, '#5b626f'); hg.addColorStop(1, '#333842');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(hl, 0); ctx.lineTo(hl - 16, -hw); ctx.lineTo(-hl, -hw);
    ctx.lineTo(-hl, hw); ctx.lineTo(hl - 16, hw); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#191c22'; ctx.lineWidth = 1.5; ctx.stroke();
    // superstructure block
    ctx.fillStyle = '#2b313b';
    this._roundRect(ctx, -8, -hw + 3, 26, (hw - 3) * 2, 2); ctx.fill();
    ctx.fillStyle = '#39424e';
    this._roundRect(ctx, -2, -6, 12, 12, 2); ctx.fill();
    // mast
    ctx.strokeStyle = '#20242c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(4, -10); ctx.stroke();
    // fore & aft gun turrets
    ctx.fillStyle = '#20242c';
    ctx.beginPath(); ctx.arc(hl - 34, 0, 5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-hl + 20, 0, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#20242c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hl - 34, 0); ctx.lineTo(hl - 22, 0); ctx.stroke();
    // blinking nav light
    if (Math.sin(time * 4 + c.x) > 0.6) { ctx.fillStyle = '#ff5b5b'; ctx.beginPath(); ctx.arc(4, -10, 1.8, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  /* -------------------------------------------------------------- PLANE */
  drawPlane(ctx, p, ox, oy, game) {
    ctx.save();
    ctx.translate(p.x + ox, p.y + oy);

    // contrail (drawn in world offset space) — from stored history
    this._drawTrail(ctx, p, ox, oy, game);

    ctx.rotate(p.angle);
    // bank → squash across the wing axis to suggest roll
    const bankF = 1 - 0.4 * Math.min(1, Math.abs(p.bank) / CONFIG.plane.bankMax);
    ctx.scale(1, bankF);

    const C = p.col;

    // Afterburner / engine flame
    const thr = p.throttle, ab = p.boosting;
    const flame = (ab ? 26 : 8 + thr * 10) * (0.85 + Math.random() * 0.3);
    if (flame > 4) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createLinearGradient(-10, 0, -10 - flame, 0);
      fg.addColorStop(0, ab ? 'rgba(180,230,255,0.9)' : 'rgba(255,200,120,0.8)');
      fg.addColorStop(0.5, ab ? 'rgba(120,170,255,0.6)' : 'rgba(255,140,60,0.5)');
      fg.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-9, -4); ctx.lineTo(-10 - flame, 0); ctx.lineTo(-9, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // spawn shield ring
    if (p.spawnShield > 0) {
      ctx.save(); ctx.globalAlpha = 0.4 + 0.3 * Math.sin(game.time * 20);
      ctx.strokeStyle = C.glow; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.stroke(); ctx.restore();
    }

    // ---- jet silhouette ----
    // wings (swept)
    ctx.fillStyle = C.dark;
    ctx.beginPath();
    ctx.moveTo(3, 0);
    ctx.lineTo(-6, -14); ctx.lineTo(-11, -13); ctx.lineTo(-5, -3);
    ctx.lineTo(-13, -3); ctx.lineTo(-14, 0); ctx.lineTo(-13, 3);
    ctx.lineTo(-5, 3); ctx.lineTo(-11, 13); ctx.lineTo(-6, 14); ctx.lineTo(3, 0);
    ctx.closePath(); ctx.fill();

    // fuselage
    const bg = ctx.createLinearGradient(0, -4, 0, 4);
    bg.addColorStop(0, C.main); bg.addColorStop(0.5, C.glow); bg.addColorStop(1, C.dark);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(6, -3.2); ctx.lineTo(-12, -3); ctx.lineTo(-14, 0);
    ctx.lineTo(-12, 3); ctx.lineTo(6, 3.2); ctx.closePath(); ctx.fill();

    // tail stabs
    ctx.fillStyle = C.dark;
    ctx.beginPath(); ctx.moveTo(-9, -2); ctx.lineTo(-15, -7); ctx.lineTo(-13, -2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-9, 2); ctx.lineTo(-15, 7); ctx.lineTo(-13, 2); ctx.closePath(); ctx.fill();

    // canopy glow + nose indicator
    ctx.fillStyle = C.glow;
    ctx.beginPath(); ctx.ellipse(6, 0, 3.2, 2, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = C.glow; ctx.beginPath(); ctx.arc(15, 0, 2.2, 0, TAU); ctx.fill();
    ctx.restore();

    // hit flash
    if (p.hitFlash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.hitFlash;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 12, 0, 0, TAU); ctx.fill(); ctx.restore();
    }

    ctx.restore();

    // callsign tag under the plane (unrotated)
    ctx.save();
    ctx.translate(p.x + ox, p.y + oy);
    ctx.font = '9px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.glow; ctx.globalAlpha = 0.8;
    ctx.fillText(p.callsign, 0, 20);
    ctx.restore();
  }

  _drawTrail(ctx, p, ox, oy, game) {
    const tr = p.trail; if (tr.length < 4) return;
    ctx.save();
    ctx.translate(-(p.x), -(p.y)); // trail points are absolute; translate back out of plane-local
    ctx.lineCap = 'round';
    for (let i = 2; i < tr.length; i += 2) {
      const x0 = tr[i - 2], y0 = tr[i - 1], x1 = tr[i], y1 = tr[i + 1];
      if (Math.abs(x1 - x0) > game.w * 0.5 || Math.abs(y1 - y0) > game.h * 0.5) continue; // wrap jump
      const a = (i / tr.length) * 0.28;
      ctx.strokeStyle = p.col.trail;
      ctx.globalAlpha = a;
      ctx.lineWidth = (i / tr.length) * 2.4;
      ctx.beginPath(); ctx.moveTo(x0 + ox, y0 + oy); ctx.lineTo(x1 + ox, y1 + oy); ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------- RETICLE/LOCK */
  drawReticle(ctx, p, game) {
    // Drawn for both planes locally for spectacle.
    const enemy = game.planes[1 - p.idx];
    if (!enemy || !enemy.alive) return;
    if (p.lockProg <= 0.01) return;
    const d = wrapDelta(p.x, p.y, enemy.x, enemy.y, game.w, game.h);
    const ex = p.x + d.dx, ey = p.y + d.dy;
    const prog = p.lockProg;
    const locked = p.locked;
    const col = locked ? CONFIG.colors.hudGreen : CONFIG.colors.hudAmber;
    const size = lerp(34, 16, prog);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
    // closing brackets
    const b = size, arm = 7;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(sx * b, sy * b - sy * arm);
      ctx.lineTo(sx * b, sy * b);
      ctx.lineTo(sx * b - sx * arm, sy * b);
      ctx.stroke();
    }
    if (locked) {
      // diamond + LOCK
      ctx.beginPath();
      ctx.moveTo(0, -size - 6); ctx.lineTo(size + 6, 0); ctx.lineTo(0, size + 6); ctx.lineTo(-size - 6, 0); ctx.closePath();
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(game.time * 18); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.font = 'bold 11px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText('LOCK', 0, -size - 12);
    } else {
      ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.font = '9px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText(Math.floor(prog * 100) + '%', 0, -size - 8);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ WEAPONS */
  drawBullet(ctx, b) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = b.col.glow; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath();
    if (!b.wrapped) { ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); }
    else { ctx.moveTo(b.x - b.vx * 0.01, b.y - b.vy * 0.01); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawMissile(ctx, m, ox, oy, game) {
    ctx.save();
    ctx.translate(m.x + ox, m.y + oy);
    ctx.rotate(m.angle);
    // body
    ctx.fillStyle = '#d9dde4';
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-6, -2); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a9099'; ctx.fillRect(-6, -1.3, 3, 2.6);
    // hot motor glow
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const fl = m.fuel > 0 ? (5 + Math.random() * 5) : 1.5;
    const g = ctx.createLinearGradient(-6, 0, -6 - fl, 0);
    g.addColorStop(0, 'rgba(255,230,150,0.9)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-6 - fl, 0); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  drawFlare(ctx, f, ox, oy) {
    const life = f.life / f.maxLife;
    ctx.save();
    ctx.translate(f.x + ox, f.y + oy);
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.6 + Math.random() * 0.4;
    const r = 6 * life * flick + 2;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * life})`);
    g.addColorStop(0.4, `rgba(255,210,90,${0.7 * life})`);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.2, 0, TAU); ctx.fill();
    // star spikes
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * life})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
    ctx.restore();
  }

  drawParticles(game) {
    const ctx = this.ctx;
    const arr = game.particles.parts;
    // smoke pass (normal blend)
    ctx.save();
    for (const p of arr) {
      if (p.type !== 'smoke') continue;
      const a = (p.life / p.max);
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // glow pass (additive)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of arr) {
      if (p.type === 'smoke') continue;
      const a = clamp(p.life / p.max, 0, 1);
      if (p.type === 'ring') {
        ctx.globalAlpha = a * 0.6; ctx.strokeStyle = p.color; ctx.lineWidth = 2 * a + 0.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.stroke();
        continue;
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.type === 'exhaust' ? a : 1), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------- WARNINGS */
  drawWarnings(game) {
    // red edge pulse when any local plane is under missile threat
    const ctx = this.ctx, W = this.w, H = this.h;
    for (const p of game.planes) {
      if (!p || !p.alive) continue;
      if (!game.isLocalView(p.idx)) continue; // only pulse for the local viewer's own threats
      if (p.warnMissile) {
        const pulse = 0.25 + 0.25 * Math.sin(game.time * 16);
        const grd = ctx.createLinearGradient(0, 0, 0, H);
        ctx.save(); ctx.globalAlpha = pulse;
        ctx.fillStyle = 'rgba(255,40,40,1)';
        ctx.fillRect(0, 0, W, 12); ctx.fillRect(0, H - 12, W, 12);
        ctx.fillRect(0, 0, 12, H); ctx.fillRect(W - 12, 0, 12, H);
        ctx.restore();
        break;
      }
    }
  }

  /* --------------------------------------------------------------- HUD */
  drawHUD(game) {
    const ctx = this.ctx, W = this.w, H = this.h;
    // Score board (top center)
    this.drawScore(game);
    // Player panels
    if (game.planes[0]) this.drawPanel(game, game.planes[0], 16, 16, 'left');
    if (game.planes[1]) this.drawPanel(game, game.planes[1], W - 16, 16, 'right');
  }

  drawScore(game) {
    const ctx = this.ctx, W = this.w;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = 'bold 13px "Courier New", monospace';
    const need = CONFIG.match.roundsToWin;
    const cx = W / 2;
    // pips
    const drawPips = (score, x, dir, col) => {
      for (let i = 0; i < need; i++) {
        const px = x + dir * (i * 16);
        ctx.beginPath(); ctx.arc(px, 30, 5, 0, TAU);
        if (i < score) { ctx.fillStyle = col; ctx.fill(); }
        else { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1; }
      }
    };
    ctx.fillStyle = CONFIG.colors.p1.main; ctx.fillText(game.planes[0]?.callsign || 'P1', cx - 70, 8);
    ctx.fillStyle = CONFIG.colors.p2.main; ctx.fillText(game.planes[1]?.callsign || 'P2', cx + 70, 8);
    drawPips(game.score[0], cx - 44, -1, CONFIG.colors.p1.main);
    drawPips(game.score[1], cx + 44, 1, CONFIG.colors.p2.main);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px "Courier New", monospace';
    ctx.fillText('ROUND ' + game.round, cx, 40);
    ctx.restore();
  }

  drawPanel(game, p, ax, ay, side) {
    const ctx = this.ctx;
    const w = 176, left = side === 'left';
    const x = left ? ax : ax - w;
    const C = p.col;
    ctx.save();
    ctx.textBaseline = 'top';

    // backing
    ctx.fillStyle = 'rgba(8,10,20,0.42)';
    this._roundRect(ctx, x, ay, w, 74, 6); ctx.fill();
    ctx.strokeStyle = C.dark; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
    this._roundRect(ctx, x, ay, w, 74, 6); ctx.stroke(); ctx.globalAlpha = 1;

    const pad = 9;
    // callsign
    ctx.fillStyle = C.main; ctx.font = 'bold 15px "Courier New", monospace'; ctx.textAlign = 'left';
    ctx.fillText(p.callsign, x + pad, ay + 6);
    // HP text
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '9px "Courier New", monospace'; ctx.textAlign = 'right';
    ctx.fillText((p.warnMissile ? 'MISSILE!' : p.warnLock ? 'LOCKED' : p.locked ? 'FOX READY' : ''), x + w - pad, ay + 8);

    // Health bar
    let by = ay + 26;
    this._bar(ctx, x + pad, by, w - pad * 2, 8, p.health / CONFIG.plane.maxHealth,
      p.health > 40 ? C.main : CONFIG.colors.warn, 'rgba(255,255,255,0.12)');

    // Boost bar
    by += 13;
    this._bar(ctx, x + pad, by, w - pad * 2 - 46, 5, p.boost / CONFIG.boost.max,
      p.boosting ? '#fff' : '#ffb44d', 'rgba(255,255,255,0.1)');
    ctx.fillStyle = '#ffb44d'; ctx.font = '8px "Courier New", monospace'; ctx.textAlign = 'left';
    ctx.fillText('BST', x + w - pad - 40, by - 1);
    // gun heat (small, right of boost)
    this._bar(ctx, x + w - pad - 22, by, 22, 5, p.gunHeat, p.gunOverheat ? CONFIG.colors.warn : '#ff7a4d', 'rgba(255,255,255,0.1)');

    // Missiles (pips) + flares
    by += 12;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '9px "Courier New", monospace';
    ctx.fillText('MSL', x + pad, by);
    const reloading = p.missileCd > 0;   // dim the pips while on cooldown
    for (let i = 0; i < CONFIG.missile.ammo; i++) {
      const mx = x + pad + 32 + i * 12;
      ctx.beginPath();
      // little missile pip
      if (i < p.ammo) { ctx.fillStyle = reloading ? 'rgba(116,255,156,0.35)' : CONFIG.colors.hudGreen; ctx.fillRect(mx, by, 8, 8); }
      else { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(mx + 0.5, by + 0.5, 7, 7); }
    }
    // flares
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('FLR', x + pad + 96, by);
    ctx.fillStyle = p.flareCd > 0 ? 'rgba(255,180,80,0.5)' : '#ffd36b';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillText('x' + p.flares, x + pad + 122, by - 1);

    if (p.ammo === 0) {
      ctx.fillStyle = CONFIG.colors.warn; ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'right'; ctx.fillText('WINCHESTER', x + w - pad, by);
    }
    ctx.restore();
  }

  _bar(ctx, x, y, w, h, frac, col, bg) {
    frac = clamp(frac, 0, 1);
    ctx.fillStyle = bg; this._roundRect(ctx, x, y, w, h, 2); ctx.fill();
    ctx.fillStyle = col; this._roundRect(ctx, x, y, w * frac, h, 2); ctx.fill();
  }

  /* ------------------------------------------------------- CALLOUTS/BANNER */
  drawCallouts(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const c of game.callouts) {
      const a = clamp(c.life / c.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `bold ${c.size}px "Courier New", monospace`;
      ctx.fillStyle = c.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
      const yy = c.y - (1 - a) * 20;
      ctx.strokeText(c.text, c.x, yy);
      ctx.fillText(c.text, c.x, yy);
    }
    ctx.restore();
  }

  drawBanners(game) {
    const ctx = this.ctx, W = this.w, H = this.h;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (game.phase === 'countdown') {
      const n = Math.ceil(game.phaseTime);
      const frac = game.phaseTime - Math.floor(game.phaseTime);
      ctx.globalAlpha = 0.5 + 0.5 * frac;
      ctx.font = 'bold 120px "Arial Black", sans-serif';
      ctx.fillStyle = CONFIG.colors.hudAmber;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4;
      const label = n > 0 ? String(n) : "FIGHT'S ON";
      const sz = n > 0 ? 120 : 70;
      ctx.font = `bold ${sz}px "Arial Black", sans-serif`;
      ctx.strokeText(label, W / 2, H / 2); ctx.fillText(label, W / 2, H / 2);
    } else if (game.phase === 'roundEnd') {
      ctx.globalAlpha = 0.95;
      ctx.font = 'bold 60px "Arial Black", sans-serif';
      const winner = game.planes[game.lastRoundWinner];
      ctx.fillStyle = winner ? winner.col.main : '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
      const txt = 'SPLASH!';
      ctx.strokeText(txt, W / 2, H / 2 - 30); ctx.fillText(txt, W / 2, H / 2 - 30);
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.fillStyle = '#fff';
      if (winner) ctx.fillText(winner.callsign + ' SCORES', W / 2, H / 2 + 24);
    }
    ctx.restore();
  }

  /* helpers */
  _roundRect(ctx, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
