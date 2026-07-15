/* ============================================================================
 * FOX TWO  —  UTILS  (math helpers, RNG, toroidal-wrap geometry)
 * ========================================================================== */

const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const invlerp = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1));
// Frame-rate independent easing toward a target (t is per-second rate).
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

let rand = Math.random;
const randRange = (a, b) => a + rand() * (b - a);
const randSpread = (s) => (rand() - 0.5) * 2 * s;
const pick = (arr) => arr[(rand() * arr.length) | 0];
const chance = (p) => rand() < p;

// Normalize an angle to (-PI, PI].
function normAngle(a) {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}
// Shortest signed difference b - a, in (-PI, PI].
const angDiff = (a, b) => normAngle(b - a);

// Move angle `a` toward `b` by at most `maxStep` (radians).
function turnToward(a, b, maxStep) {
  const d = angDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/* ---- Toroidal geometry --------------------------------------------------
 * The arena wraps, so the "real" delta between two points is the shortest
 * one across the seam. World dims live on Game.world (set at runtime); these
 * take W/H explicitly to stay pure. */
function wrapDelta(ax, ay, bx, by, W, H) {
  let dx = bx - ax, dy = by - ay;
  if (CONFIG.world.wrap) {
    if (dx > W * 0.5) dx -= W; else if (dx < -W * 0.5) dx += W;
    if (dy > H * 0.5) dy -= H; else if (dy < -H * 0.5) dy += H;
  }
  return { dx, dy };
}
function wrapDist(ax, ay, bx, by, W, H) {
  const { dx, dy } = wrapDelta(ax, ay, bx, by, W, H);
  return Math.hypot(dx, dy);
}
// Keep a position inside [0,W) x [0,H).
function wrapPos(p, W, H) {
  if (!CONFIG.world.wrap) return;
  if (p.x < 0) p.x += W; else if (p.x >= W) p.x -= W;
  if (p.y < 0) p.y += H; else if (p.y >= H) p.y -= H;
  // guard against multi-wrap in one frame at extreme speeds
  if (p.x < 0 || p.x >= W) p.x = ((p.x % W) + W) % W;
  if (p.y < 0 || p.y >= H) p.y = ((p.y % H) + H) % H;
}

// Segment (a->b) vs circle (c, r): returns true if they intersect. Used for
// bullet/missile travel vs the carrier and for line-of-sight blocking.
function segCircle(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay;
  const fx = ax - cx, fy = ay - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-6) return fx * fx + fy * fy <= r * r;
  let t = -(fx * dx + fy * dy) / a;
  t = clamp(t, 0, 1);
  const px = ax + dx * t - cx, py = ay + dy * t - cy;
  return px * px + py * py <= r * r;
}

// Point vs oriented rectangle (carrier). cx,cy center; ang orientation.
function pointInOBB(px, py, cx, cy, halfL, halfW, ang) {
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const dx = px - cx, dy = py - cy;
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= halfL && Math.abs(ly) <= halfW;
}

// Segment vs oriented rectangle — transform segment into the box's local
// space and test against an axis-aligned box (via a few edge checks).
function segOBB(ax, ay, bx, by, cx, cy, halfL, halfW, ang) {
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const tx = (x, y) => (x - cx) * c - (y - cy) * s;
  const ty = (x, y) => (x - cx) * s + (y - cy) * c;
  const p0x = tx(ax, ay), p0y = ty(ax, ay);
  const p1x = tx(bx, by), p1y = ty(bx, by);
  // Liang-Barsky clip against [-halfL,halfL]x[-halfW,halfW]
  let t0 = 0, t1 = 1;
  const dx = p1x - p0x, dy = p1y - p0y;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (clip(-dx, p0x + halfL) && clip(dx, halfL - p0x) &&
      clip(-dy, p0y + halfW) && clip(dy, halfW - p0y)) {
    return t0 <= t1;
  }
  return false;
}
