/* ============================================================================
 * FOX TWO  —  CONFIG
 * ----------------------------------------------------------------------------
 * Every balance constant lives here so the game can be tuned without hunting
 * through logic. Units: pixels & seconds unless noted. Angles are radians.
 * Tweak freely — the game reads these live.
 * ========================================================================== */

const CONFIG = {
  version: '1.0.0',

  /* ---- WORLD / ARENA ------------------------------------------------------
   * Bounded arena (hard walls — planes must stay in the fight). Its size tracks
   * the canvas, clamped so the arena is never absurdly large or cramped.
   * (Set world.wrap = true for classic Asteroids-style wrap-around instead.) */
  world: {
    minW: 900, minH: 560,     // clamp so a huge monitor doesn't dilute the fight
    maxW: 1600, maxH: 1000,
    wrap: false,              // false = hard bounds (planes must stay in the arena)
    boundPad: 6,              // how far inside the edge the boundary "wall" sits
  },

  /* ---- FLIGHT MODEL -------------------------------------------------------
   * Energy-based arcade feel: always moving forward, throttle sets target
   * speed, slow = nimble / fast = wide (corner-speed tradeoff). */
  plane: {
    minSpeed: 132,            // cruise floor — never fully stops
    maxSpeed: 340,            // top speed at full throttle (no afterburner)
    afterburnerSpeed: 468,    // target speed while AB held
    throttleAccel: 300,       // px/s^2 the speed eases toward target
    throttleRate: 0.95,       // how fast throttle input moves 0..1 per second
    defaultThrottle: 0.62,

    turnRateLow: 3.35,        // rad/s at/below minSpeed (nimble)
    turnRateHigh: 1.95,       // rad/s at maxSpeed (wide)
    turnRateAB: 1.7,          // rad/s while afterburning (widest — go fast, turn poorly)

    velEase: 8.5,             // how fast velocity vector aligns to heading (drift/weight)
    turnBleed: 78,            // px/s speed lost per second while hard-turning (energy cost)
    bankMax: 0.6,             // visual bank amount (radians of skew) at full turn
    bankEase: 6.0,            // how fast the visual bank follows the turn

    radius: 12,               // collision radius
    maxHealth: 100,
    collideDamage: 22,        // damage each plane takes in a mid-air collision
    spawnShield: 1.4,         // seconds of invulnerability after a round reset
  },

  /* ---- AFTERBURNER / BOOST ----------------------------------------------- */
  boost: {
    max: 100,
    drain: 32,                // per second while lit
    regen: 17,                // per second while not
    regenDelay: 0.5,          // seconds after releasing AB before regen resumes
    minToEngage: 6,           // can't relight AB below this
  },

  /* ---- IR SIGNATURE (HEAT) -----------------------------------------------
   * What IR missiles home on. Higher heat = easier to lock & track. Rear
   * (engine) aspect is hottest, afterburner is a beacon. */
  heat: {
    base: 1.0,
    throttleScale: 1.1,       // + up to this much at full throttle
    afterburner: 3.2,         // + this while AB lit (huge — running hot is dangerous)
    rearAspectBonus: 2.0,     // + up to this when viewed from directly behind
    turnConcealment: 0.45,    // hard turning hides up to this fraction of your heat
  },

  /* ---- GUNS --------------------------------------------------------------
   * Fast tracer projectiles, short range, heat/overheat gate that punishes
   * spraying: fire in bursts and let the barrel cool, or hold too long and
   * overheat for a longer lockout. Heat only dissipates once you STOP firing. */
  guns: {
    muzzleSpeed: 560,         // added along nose, on top of inherited plane velocity
    inheritVel: 1.0,          // fraction of plane velocity added to the bullet
    fireInterval: 0.085,      // seconds between shots (~12/s)
    life: 0.6,                // seconds a tracer lives
    spread: 0.022,            // radians of random spread
    damage: 9,
    radius: 3,
    // Heat model: each shot adds heat; ~1.4s of continuous fire hits 1.0 and
    // OVERHEATS. Heat only bleeds off after you release the trigger (coolDelay),
    // and overheating forces a long cool-down to overheatCoolTo before you can
    // fire again (~1.8s lockout) — vs. no penalty if you burst responsibly.
    heatPerShot: 0.06,        // ~17 shots (~1.4s) to overheat
    coolPerSec: 0.5,          // heat lost per second once cooling
    coolDelay: 0.25,          // seconds after your last shot before cooling starts
    overheatCoolTo: 0.2,      // after overheating, must drop to here before firing (~1.8s)
  },

  /* ---- IR MISSILES (FOX TWO) — the centerpiece --------------------------- */
  missile: {
    ammo: 4,                  // per round
    cooldown: 0.9,            // min seconds between launches (stops missile spam)
    // Lock acquisition
    lockConeHalf: 0.32,       // half-angle of the forward lock cone (~18°)
    lockRange: 640,           // max distance to acquire/hold a lock
    lockTime: 1.05,           // seconds holding target in cone to complete lock (at ref heat)
    lockDecayMul: 1.7,        // lock progress falls this much faster when target leaves cone
    // A hotter target locks up FASTER: rate multiplier = clamp(targetHeat/ref, min, max).
    // Afterburner spikes IR heat, so lighting the burner gets you locked much quicker.
    lockHeatRef: 1.7,         // target IR emission that locks at normal speed (~cruise)
    lockRateMin: 0.7,         // cold/idle target → slower lock
    lockRateMax: 2.4,         // full afterburner → locks in well under half the time

    // Flight  (validated: straight shots kill; long-range shots are dodgeable by
    // breaking at the fuel edge; mid/close shots require flares to defeat.)
    speed: 486,               // top speed (a hair faster than afterburner)
    launchSpeedBonus: 55,     // initial speed above the firing plane's speed
    accel: 600,               // px/s^2 accelerating to top speed
    turnRate: 1.9,            // rad/s — far below a slow plane's 3.35 so it can't corner
    fuel: 2.2,                // seconds of powered flight (then it goes dumb → overshoots)
    dumbLife: 1.4,            // seconds it coasts straight after fuel runs out
    armTime: 0.12,            // seconds before it can detonate (avoids self-hit)

    // Damage
    damage: 60,               // direct hit (survivable from full health by design)
    splashRadius: 40,
    splashDamage: 24,         // max splash at center, falls off with distance
    proximityFuse: 11,        // detonates within this distance of a target
    radius: 5,

    // Seeker — steers only while the target is in this cone with clear LOS; a hard
    // break takes you out of the cone and the missile coasts straight (overshoots).
    seekConeHalf: 0.72,       // half-angle the seeker can "see"
    loseTargetGrace: 0.25,    // keeps last target briefly after it leaves the cone
    reseekChance: 0.9,        // per-eval chance to commit to a hotter source (flares)
  },

  /* ---- FLARES (countermeasure) ------------------------------------------- */
  flare: {
    count: 8,                 // per round
    perDrop: 3,               // decoys spawned per press
    cooldown: 0.85,           // seconds between drops
    life: 1.7,                // seconds each decoy burns
    heat: 6.2,                // very hot at birth (decays over life)
    ejectSpeed: 90,           // px/s pushed out behind/beside the plane
    spread: 0.9,              // spray angle
    breakBonus: 1.6,          // extra decoy pull when the plane is also hard-turning
    radius: 6,
  },

  /* ---- MATCH STRUCTURE ---------------------------------------------------- */
  match: {
    roundsToWin: 3,           // best-of-5
    countdown: 3.2,           // seconds of "3..2..1..FIGHT'S ON"
    roundEndPause: 2.4,       // seconds after a kill before next round
    spawnMargin: 110,         // spawn this far from arena edges
  },

  /* ---- SHIPS (obstacles / cover) -----------------------------------------
   * Ships block guns, missiles and line-of-sight, and scrape planes that
   * touch them. Dimensions per type; placement comes from the chosen map. */
  carrier: { length: 300, width: 62, crashDps: 20 },
  destroyer: { length: 128, width: 34, crashDps: 16 },

  /* ---- MAPS --------------------------------------------------------------
   * Pick one on the menu. `x`/`y` are fractions of the arena; `a` is angle. */
  maps: [
    { name: 'OPEN SKIES', blurb: 'No obstacles — pure dogfight', ships: [] },
    { name: 'CARRIER', blurb: 'One aircraft carrier', ships: [
      { kind: 'carrier', x: 0.5, y: 0.5, a: -0.35 },
    ] },
    { name: 'TASK FORCE', blurb: 'Carrier + two destroyers', ships: [
      { kind: 'carrier', x: 0.5, y: 0.5, a: -0.35 },
      { kind: 'destroyer', x: 0.19, y: 0.20, a: 0.5 },   // top-left, angled one way
      { kind: 'destroyer', x: 0.81, y: 0.74, a: -0.7 },  // bottom-right, angled the other
    ] },
  ],
  defaultMap: 2,

  /* ---- JUICE -------------------------------------------------------------- */
  juice: {
    shakeKill: 22,
    shakeMissileHit: 14,
    shakeGunHit: 3.5,
    shakeDamp: 8.5,           // shake decay per second
    hitStopKill: 0.09,        // seconds of freeze on a kill
    hitStopMissile: 0.035,
  },

  /* ---- AUDIO -------------------------------------------------------------- */
  audio: {
    masterVol: 0.7,
    musicVol: 0.42,
    sfxVol: 0.8,
    bpm: 118,                 // synthwave tempo
  },

  /* ---- NETWORK (online mode) --------------------------------------------- */
  net: {
    clientInputHz: 40,        // client -> host input rate
    hostStateHz: 24,          // host -> client authoritative state rate
    interpDelayMs: 105,       // client renders this far in the past for smooth interp
    predictOwn: true,         // client light-predicts its own heading/throttle
    peerPrefix: 'foxtwo-',    // room-code namespace on the PeerJS cloud
  },

  /* ---- TEAM COLORS / IDENTITY -------------------------------------------- */
  colors: {
    p1: { main: '#57d9ff', glow: '#b6f0ff', trail: '#8fe6ff', dark: '#1b6f9c', name: 'ICE' },
    p2: { main: '#ff6a52', glow: '#ffc0ad', trail: '#ff9878', dark: '#a12f24', name: 'SUN' },
    hudAmber: '#ffce4a',
    hudGreen: '#74ff9c',
    warn: '#ff4646',
  },
};

// Generic aviator handles (deliberately NOT the movie's characters).
const CALLSIGN_SUGGESTIONS = ['ACE', 'GHOST', 'REAPER', 'FALCON', 'RAZOR', 'NOMAD', 'BLAZE', 'HAWK', 'SABER', 'DUKE', 'RANGER', 'FROST'];
