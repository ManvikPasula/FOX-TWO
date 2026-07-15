/* ============================================================================
 * FOX TWO  —  INPUT
 * ----------------------------------------------------------------------------
 * Tracks physical keys by KeyboardEvent.code (layout-independent, and the best
 * we can do about laptop key-ghosting is choosing physically separated
 * clusters — done in the default bindings below). Two full control profiles
 * share one keyboard for local play. Tap actions (missile/flare) use monotonic
 * press-counters so a quick tap is never dropped and edge-detection works
 * identically for local play and for host-authoritative netcode.
 * ========================================================================== */

const DEFAULT_BINDINGS = {
  p1: { rotLeft: 'KeyA', rotRight: 'KeyD', thrUp: 'KeyW', thrDown: 'KeyS',
        guns: 'ShiftLeft', missile: 'KeyQ', flare: 'KeyE', boost: 'ControlLeft' },
  p2: { rotLeft: 'ArrowLeft', rotRight: 'ArrowRight', thrUp: 'ArrowUp', thrDown: 'ArrowDown',
        guns: 'Slash', missile: 'Period', flare: 'Comma', boost: 'ShiftRight' },
};
const ACTION_LABELS = {
  rotLeft: 'Turn L', rotRight: 'Turn R', thrUp: 'Throttle +', thrDown: 'Throttle -',
  guns: 'Guns', missile: 'Fire Missile', flare: 'Flares', boost: 'Afterburner',
};
const ACTION_ORDER = ['rotLeft', 'rotRight', 'thrUp', 'thrDown', 'guns', 'missile', 'flare', 'boost'];

class InputManager {
  constructor() {
    this.down = new Set();                 // codes currently held
    this.pressCount = {};                   // code -> monotonic press counter
    this.bindings = this._load();
    this.onFirstGesture = null;             // hook to start audio
    this._gestured = false;
    this.rebindReq = null;                  // {player, action, cb} while capturing
    this.enabled = true;                    // false while typing in a text field
    this.globalPress = 0;                   // any-key counter (menus)
    this._pausePresses = 0;
    this._mutePresses = 0;
    this._bind();
  }

  _load() {
    try {
      const raw = localStorage.getItem('foxtwo_bindings');
      if (raw) {
        const b = JSON.parse(raw);
        if (b.p1 && b.p2) return b;
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  }
  save() { try { localStorage.setItem('foxtwo_bindings', JSON.stringify(this.bindings)); } catch (e) {} }
  resetBindings() { this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); this.save(); }

  _bind() {
    window.addEventListener('keydown', (e) => this._onDown(e), { passive: false });
    window.addEventListener('keyup', (e) => this._onUp(e));
    // Safety: if the window loses focus, treat all keys as released.
    window.addEventListener('blur', () => { this.down.clear(); });
  }

  _isTyping(e) {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  _onDown(e) {
    // First interaction anywhere unlocks audio.
    if (!this._gestured) { this._gestured = true; if (this.onFirstGesture) this.onFirstGesture(); }

    // Rebind capture takes precedence.
    if (this.rebindReq) {
      e.preventDefault();
      if (e.code === 'Escape') { const r = this.rebindReq; this.rebindReq = null; r.cb && r.cb(null); return; }
      const { player, action, cb } = this.rebindReq;
      this.bindings[player][action] = e.code;
      this.save();
      this.rebindReq = null;
      cb && cb(e.code);
      return;
    }

    if (this._isTyping(e)) return;         // let text inputs work normally

    const code = e.code;
    if (!e.repeat) {
      this.pressCount[code] = (this.pressCount[code] || 0) + 1;
      this.globalPress++;
      if (code === (this.bindings.global?.pause || 'KeyP')) this._pausePresses++;
      if (code === (this.bindings.global?.mute || 'KeyM')) this._mutePresses++;
    }
    this.down.add(code);

    if (this.enabled && this._isGameKey(code)) e.preventDefault();
  }

  _onUp(e) {
    this.down.delete(e.code);
  }

  _isGameKey(code) {
    // Prevent scrolling / quick-find on keys we use.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(code)) return true;
    for (const p of ['p1', 'p2']) for (const a in this.bindings[p]) if (this.bindings[p][a] === code) return true;
    return false;
  }

  isDown(code) { return this.down.has(code); }

  /* Snapshot a player's control state. player = 'p1' | 'p2'.
   * Level controls are booleans; tap controls carry a monotonic count. */
  snapshot(player) {
    const b = this.bindings[player];
    return {
      rotLeft: this.down.has(b.rotLeft),
      rotRight: this.down.has(b.rotRight),
      thrUp: this.down.has(b.thrUp),
      thrDown: this.down.has(b.thrDown),
      guns: this.down.has(b.guns),
      boost: this.down.has(b.boost),
      missileC: this.pressCount[b.missile] || 0,
      flareC: this.pressCount[b.flare] || 0,
    };
  }

  // Consume a pause/mute press (edge). Returns true once per physical press.
  takePause() { if (this._pausePresses > 0) { this._pausePresses = 0; return true; } return false; }
  takeMute() { if (this._mutePresses > 0) { this._mutePresses = 0; return true; } return false; }

  beginRebind(player, action, cb) { this.rebindReq = { player, action, cb }; }

  keyLabel(code) {
    if (!code) return '—';
    return code
      .replace('Key', '').replace('Digit', '').replace('Arrow', '')
      .replace('Left', ' L').replace('Right', ' R')
      .replace('Slash', '/').replace('Period', '.').replace('Comma', ',')
      .replace('Control', 'Ctrl').replace('Shift', 'Shift').replace('Space', 'SPACE');
  }
}

const Input = new InputManager();
