/* ============================================================================
 * FOX TWO  —  AUDIO ENGINE  (100% procedural Web Audio)
 * ----------------------------------------------------------------------------
 * Driving 80s synthwave bed + engine hum that pitches with throttle + all the
 * combat SFX and stylized radio "comms" blips. No asset files.
 * ========================================================================== */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
    this.musicPlaying = false;
    this.noiseBuf = null;
    this.engines = [];          // per-plane hum voices
    this.lockTones = {};        // per-player rising lock tone
    this.warnTones = {};        // per-player incoming-missile alarm
    // music scheduler
    this._step = 0;
    this._nextNoteTime = 0;
    this._schedTimer = null;
  }

  /* Must be called from a user gesture (key/click) to satisfy autoplay rules. */
  ensureStart() {
    if (this.started) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : CONFIG.audio.masterVol;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = CONFIG.audio.musicVol;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = CONFIG.audio.sfxVol;
    this.sfxGain.connect(this.master);

    // 2s of white noise, reused for hits/explosions/hats/hiss.
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.started = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : CONFIG.audio.masterVol, this.ctx.currentTime, 0.02);
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  get t() { return this.ctx.currentTime; }

  /* ---- low-level voices -------------------------------------------------- */
  _noise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.playbackRate.value = 0.6 + Math.random() * 0.8; return s; }

  // One-shot tone with an ADSR-ish envelope; optional pitch glide.
  tone(freq, dur, { type = 'sine', gain = 0.3, attack = 0.005, release = 0.08, dest = null, glideTo = null, glideDur = null } = {}) {
    if (!this.started || this.muted) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t + (glideDur || dur));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfxGain);
    o.start(t);
    o.stop(t + dur + release);
  }

  noiseHit(dur, { filter = 1200, q = 1, type = 'bandpass', gain = 0.4, dest = null, sweepTo = null } = {}) {
    if (!this.started || this.muted) return;
    const t = this.t;
    const s = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(filter, t); f.Q.value = q;
    if (sweepTo != null) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfxGain);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /* ======================= COMBAT SFX ==================================== */
  gun() {
    if (!this.started || this.muted) return;
    this.noiseHit(0.05, { filter: 900, q: 0.7, gain: 0.28, sweepTo: 300 });
    this.tone(180, 0.06, { type: 'square', gain: 0.12, glideTo: 90, glideDur: 0.06 });
  }

  missileLaunch() {
    // whoosh: descending band-passed noise + a punchy thud
    this.noiseHit(0.5, { filter: 2600, q: 1.2, gain: 0.5, sweepTo: 320 });
    this.tone(140, 0.35, { type: 'sawtooth', gain: 0.28, glideTo: 60 });
  }

  flareDrop() {
    this.noiseHit(0.5, { filter: 5200, q: 0.6, type: 'highpass', gain: 0.34, sweepTo: 2600 });
    this.tone(760, 0.25, { type: 'triangle', gain: 0.1, glideTo: 1500 });
  }

  explosion(size = 1) {
    if (!this.started || this.muted) return;
    const t = this.t;
    // body: low noise rumble
    this.noiseHit(0.6 * size, { filter: 420, q: 0.6, type: 'lowpass', gain: 0.6 * size, sweepTo: 60 });
    this.noiseHit(0.25, { filter: 2600, q: 0.5, type: 'bandpass', gain: 0.4 * size, sweepTo: 400 });
    // sub thump
    this.tone(90, 0.5 * size, { type: 'sine', gain: 0.55 * size, glideTo: 32 });
  }

  hit() { this.noiseHit(0.08, { filter: 2400, q: 1.5, gain: 0.3, sweepTo: 800 }); this.tone(320, 0.06, { type: 'square', gain: 0.1 }); }

  uiBeep(f = 660) { this.tone(f, 0.09, { type: 'square', gain: 0.16 }); }
  uiMove() { this.tone(440, 0.05, { type: 'square', gain: 0.1 }); }

  /* Rising lock tone — per player. Call setLock(idx, progress 0..1) each frame,
   * lockDone(idx) on complete, lockOff(idx) when dropped/fired. */
  setLock(idx, progress) {
    if (!this.started || this.muted) return;
    let L = this.lockTones[idx];
    if (!L) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      g.gain.value = 0.0001;
      o.connect(g).connect(this.sfxGain);
      o.start();
      L = this.lockTones[idx] = { o, g, done: false };
    }
    const t = this.t;
    L.o.frequency.setTargetAtTime(520 + progress * 620, t, 0.03);
    // pulse faster as it approaches lock
    const pulse = 0.05 + 0.05 * Math.sin(t * (12 + progress * 40));
    L.g.gain.setTargetAtTime(L.done ? 0.001 : (0.03 + pulse * progress), t, 0.02);
  }
  lockDone(idx) {
    const L = this.lockTones[idx];
    if (L) { L.done = true; L.g.gain.setTargetAtTime(0.0001, this.t, 0.05); }
    // solid "TONE!" confirmation
    this.tone(1180, 0.18, { type: 'square', gain: 0.16 });
  }
  lockOff(idx) {
    const L = this.lockTones[idx];
    if (L) { try { L.g.gain.setTargetAtTime(0.0001, this.t, 0.03); L.o.stop(this.t + 0.1); } catch (e) {} delete this.lockTones[idx]; }
  }

  /* Incoming-missile alarm — per targeted player. */
  warnOn(idx) {
    if (!this.started || this.muted || this.warnTones[idx]) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 880;
    lfo.type = 'square'; lfo.frequency.value = 8; lfoG.gain.value = 0.12;
    lfo.connect(lfoG).connect(g.gain);
    g.gain.value = 0.14;
    o.connect(g).connect(this.sfxGain);
    o.start(); lfo.start();
    this.warnTones[idx] = { o, g, lfo };
  }
  warnOff(idx) {
    const W = this.warnTones[idx];
    if (W) { try { W.g.gain.setTargetAtTime(0.0001, this.t, 0.05); W.o.stop(this.t + 0.12); W.lfo.stop(this.t + 0.12); } catch (e) {} delete this.warnTones[idx]; }
  }

  /* Stylized radio "comms" blip — not speech, but reads as squelch + call. */
  radio(kind) {
    if (!this.started || this.muted) return;
    const t = this.t;
    // squelch open
    this.noiseHit(0.05, { filter: 3200, q: 4, gain: 0.12 });
    const map = {
      fight: [740, 900], fox2: [520, 340], guns: [300, 300, 300], flares: [1200, 1500],
      defend: [640, 480], winchester: [400, 300], splash: [900, 1300, 1700], generic: [660, 520],
    };
    const seq = map[kind] || map.generic;
    seq.forEach((f, i) => {
      const g = this.ctx.createGain();
      const o = this.ctx.createOscillator();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 5;
      o.type = 'sawtooth';
      const st = t + 0.04 + i * 0.075;
      o.frequency.setValueAtTime(f, st);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.16, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.07);
      o.connect(bp).connect(g).connect(this.sfxGain);
      o.start(st); o.stop(st + 0.1);
    });
  }

  /* ======================= ENGINE HUM ==================================== */
  engineStart(count = 2) {
    if (!this.started) return;
    this.engineStop();
    for (let i = 0; i < count; i++) {
      const o1 = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      const lp = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      const nz = this._noise();
      const nbp = this.ctx.createBiquadFilter();
      const ng = this.ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'triangle';
      o1.frequency.value = 70; o2.frequency.value = 71.5;
      lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 2;
      g.gain.value = 0.0001;
      nbp.type = 'bandpass'; nbp.frequency.value = 900; nbp.Q.value = 0.7;
      ng.gain.value = 0.0001;
      o1.connect(lp); o2.connect(lp); lp.connect(g).connect(this.sfxGain);
      nz.connect(nbp).connect(ng).connect(this.sfxGain);
      o1.start(); o2.start(); nz.start();
      this.engines.push({ o1, o2, lp, g, nbp, ng });
    }
  }
  engineSet(i, throttle, ab, alive) {
    const e = this.engines[i];
    if (!e || !this.started) return;
    const t = this.t;
    const base = 62 + throttle * 46 + (ab ? 30 : 0);
    e.o1.frequency.setTargetAtTime(base, t, 0.08);
    e.o2.frequency.setTargetAtTime(base * 1.02, t, 0.08);
    const vol = alive ? (0.028 + throttle * 0.03 + (ab ? 0.05 : 0)) : 0.0001;
    e.g.gain.setTargetAtTime(vol, t, 0.1);
    e.nbp.frequency.setTargetAtTime(700 + throttle * 900 + (ab ? 800 : 0), t, 0.1);
    e.ng.gain.setTargetAtTime(alive ? (ab ? 0.05 : 0.012 + throttle * 0.02) : 0.0001, t, 0.1);
  }
  engineStop() {
    for (const e of this.engines) { try { e.o1.stop(); e.o2.stop(); } catch (x) {} }
    this.engines = [];
  }

  /* ======================= SYNTHWAVE MUSIC =============================== */
  startMusic() {
    if (!this.started || this.musicPlaying) return;
    this.musicPlaying = true;
    this._step = 0;
    this._nextNoteTime = this.t + 0.1;
    this._scheduleLoop();
  }
  stopMusic() {
    this.musicPlaying = false;
    if (this._schedTimer) { clearTimeout(this._schedTimer); this._schedTimer = null; }
  }
  _scheduleLoop() {
    if (!this.musicPlaying) return;
    const spb = 60 / CONFIG.audio.bpm;      // seconds per beat
    const sixteenth = spb / 4;
    while (this._nextNoteTime < this.t + 0.12) {
      this._scheduleStep(this._step, this._nextNoteTime);
      this._nextNoteTime += sixteenth;
      this._step = (this._step + 1) % 64;    // 4 bars of 16 sixteenths
    }
    this._schedTimer = setTimeout(() => this._scheduleLoop(), 25);
  }
  // i–VI–III–VII in A minor: Am, F, C, G — one chord per bar.
  _scheduleStep(step, when) {
    if (this.muted) return;
    const bar = (step >> 4) & 3;
    const s16 = step & 15;
    const roots = [55.0, 43.65, 65.41, 49.0];        // A1, F1, C2, G1
    const chordSemis = [[0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12]];
    const root = roots[bar];
    const g = this.musicGain;

    // --- Drums ---
    if (s16 % 4 === 0) this._kick(when);                 // 4-on-the-floor
    if (s16 === 4 || s16 === 12) this._snare(when);       // backbeat
    if (s16 % 2 === 0) this._hat(when, s16 % 4 === 2 ? 0.05 : 0.03);

    // --- Bass arp (driving 16ths, octave up) ---
    const arpPat = [0, 12, 7, 12, 0, 12, 7, 12, 0, 12, 7, 12, 0, 12, 7, 12];
    const bfreq = root * 2 * Math.pow(2, arpPat[s16] / 12);
    this._bass(bfreq, when, sixteenthDur(this));

    // --- Pad (sustained triad, once per bar) ---
    if (s16 === 0) {
      const semis = chordSemis[bar];
      for (const st of semis) this._pad(root * 4 * Math.pow(2, st / 12), when, (60 / CONFIG.audio.bpm) * 4);
    }
    // --- sparse lead pluck on the "and" of beats 2 & 4 for movement ---
    if (s16 === 6 || s16 === 14) {
      const lead = root * 8 * Math.pow(2, (bar === 3 ? 7 : 12) / 12);
      this._pluck(lead, when);
    }
  }
  _kick(t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.musicGain); o.start(t); o.stop(t + 0.2);
  }
  _snare(t) {
    const s = this._noise(); s.loop = false;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(f).connect(g).connect(this.musicGain); s.start(t); s.stop(t + 0.18);
  }
  _hat(t, gain) {
    const s = this._noise(); s.loop = false;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(f).connect(g).connect(this.musicGain); s.start(t); s.stop(t + 0.05);
  }
  _bass(freq, t, dur) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = freq;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(220, t + dur); lp.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
    o.connect(lp).connect(g).connect(this.musicGain); o.start(t); o.stop(t + dur);
  }
  _pad(freq, t, dur) {
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = freq; o2.frequency.value = freq * 1.006;
    lp.type = 'lowpass'; lp.frequency.value = 1600; lp.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.4); g.gain.setTargetAtTime(0.0001, t + dur * 0.7, 0.3);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(this.musicGain);
    o1.start(t); o2.start(t); o1.stop(t + dur); o2.stop(t + dur);
  }
  _pluck(freq, t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.musicGain); o.start(t); o.stop(t + 0.32);
  }

  // Big title/round stings.
  sting() {
    if (!this.started || this.muted) return;
    const notes = [220, 277, 330, 440];
    notes.forEach((f, i) => this.tone(f, 0.5, { type: 'sawtooth', gain: 0.12, dest: this.musicGain }));
    this.tone(880, 0.6, { type: 'square', gain: 0.08 });
  }
}
function sixteenthDur(a) { return (60 / CONFIG.audio.bpm) / 4 * 0.95; }

const Audio = new AudioEngine();
