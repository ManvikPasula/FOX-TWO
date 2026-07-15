/* ============================================================================
 * FOX TWO  —  MAIN
 * ----------------------------------------------------------------------------
 * Boots the game, wires the menus/overlays, and runs the single rAF loop that
 * drives LOCAL / PRACTICE / ONLINE-HOST (authoritative sim) and ONLINE-CLIENT
 * (interpolated view). Also runs an "attract" dogfight behind the menus.
 * ========================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const canvas = $('game');
  const renderer = new Renderer(canvas);
  const game = new Game(Audio, renderer);
  const ai = new AIController(0.72);
  const net = new NetManager(game, Audio);

  // Attract-mode dogfight rendered behind the menus.
  const attract = new Game(Audio, renderer);
  attract.silent = true;
  const attractAI = new AIController(0.85);

  let appState = 'menu';     // 'menu' | 'local' | 'practice' | 'host' | 'client'
  let currentCallsigns = ['FALCON', 'RAZOR'];
  let selectedMap = CONFIG.defaultMap;
  let endShown = false;
  let frozen = false;         // true while a disconnect overlay is up
  let lastView = null;        // client's last view (for frozen render)
  let last = performance.now();

  /* ------------------------------------------------------------ sizing */
  function fitCanvas() { renderer.resize(window.innerWidth, window.innerHeight); }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  /* --------------------------------------------------------- audio boot */
  function bootAudio() { Audio.ensureStart(); if (Audio.started) { Audio.startMusic(); updateMuteBtn(); } }
  Input.onFirstGesture = bootAudio;
  window.addEventListener('pointerdown', bootAudio, { once: false });

  function updateMuteBtn() {
    const b = $('btn-mute');
    b.textContent = Audio.muted ? '♪ MUTED' : '♪ SOUND';
    b.classList.toggle('muted', Audio.muted);
  }

  /* ---------------------------------------------------------- UI helpers */
  const SCREENS = ['s-title', 's-menu', 's-online', 's-host', 's-join'];
  const MODALS = ['m-howto', 'm-controls', 'o-pause', 'o-end', 'o-disc'];
  function showScreen(id) { SCREENS.forEach((s) => $(s).classList.toggle('hidden', s !== id)); }
  function hideScreens() { SCREENS.forEach((s) => $(s).classList.add('hidden')); }
  function hideModals() { MODALS.forEach((s) => $(s).classList.add('hidden')); }
  let toastTimer = null;
  function toast(msg, ms = 3200) {
    const t = $('o-toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }
  function showHint(txt) { const h = $('hint'); if (!txt) { h.classList.add('hidden'); return; } h.textContent = txt; h.classList.remove('hidden'); }

  const LOCAL_HINT = 'P1  WASD move · L-Shift guns · Q missile · E flares · L-Ctrl burner      P2  ◄▲▼► move · / guns · . missile · , flares · R-Shift burner      [P] pause  [M] mute';
  const SOLO_HINT = 'WASD move · L-Shift guns · Q missile · E flares · L-Ctrl burner · [P] pause · [M] mute';
  const ONLINE_HINT = 'WASD move · L-Shift guns · Q missile · E flares · L-Ctrl burner · [M] mute';

  /* -------------------------------------------------------- callsigns */
  function clean(s, fallback) {
    s = (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return s || fallback;
  }
  ['cs1', 'cs2', 'cs-online', 'join-code'].forEach((id) => {
    const el = $(id);
    el.addEventListener('input', () => { el.value = el.value.toUpperCase().replace(id === 'join-code' ? /[^A-Z0-9]/g : /[^A-Z0-9]/g, ''); });
  });

  /* --------------------------------------------------- attract control */
  function startAttract() {
    attract.silent = true;
    attract.mode = 'local'; attract.netRole = null;
    attract.setWorldSize(window.innerWidth, window.innerHeight);
    attract.startMatch(['GHOST', 'REAPER'], selectedMap);
    attractAI.reset();
  }
  function stepAttract(dt) {
    if (attract.phase === 'matchEnd') startAttract();
    const in0 = attractAI.input(attract, 0, dt);
    const in1 = attractAI.input(attract, 1, dt);
    attract.step(dt, [in0, in1]);
  }

  /* -------------------------------------------------------- navigation */
  function gotoMenu() {
    frozen = false; endShown = false; lastView = null; game.paused = false;
    try { net.hangUp(); } catch (e) {}
    game.netRole = null; game.mode = 'local';
    Audio.engineStop(); Audio.lockOff(0); Audio.lockOff(1); Audio.warnOff(0); Audio.warnOff(1);
    appState = 'menu';
    hideModals(); showHint(null);
    showScreen('s-menu');
    if (attract.phase === 'matchEnd' || !attract.planes[0]) startAttract();
  }

  function beginLocal(practice) {
    const c1 = clean($('cs1').value, 'FALCON');
    const c2 = clean($('cs2').value, practice ? 'BOGEY' : 'RAZOR');
    currentCallsigns = [c1, c2];
    game.silent = false; game.mode = 'local'; game.netRole = null; game.localIdx = 0;
    game.paused = false;
    game.setWorldSize(window.innerWidth, window.innerHeight);
    game.startMatch(currentCallsigns, selectedMap);
    if (practice) ai.reset();
    appState = practice ? 'practice' : 'local';
    endShown = false; frozen = false;
    hideScreens(); hideModals();
    showHint(practice ? SOLO_HINT : LOCAL_HINT);
  }

  /* ------------------------------------------------------------- online */
  function wireNetCallbacks() {
    net.onStatus = (m) => { $('host-status').textContent = m; $('join-status').textContent = m; };
    net.onError = (m) => { toast(m, 4500); $('join-status').textContent = m; $('join-status').style.color = 'var(--warn)'; };
    net.onDisconnect = () => handleDisconnect();
  }

  function beginHost() {
    wireNetCallbacks();
    const call = clean($('cs-online').value, 'ACE');
    game.setWorldSize(window.innerWidth, window.innerHeight);
    net.onReady = (code) => {
      $('host-code').textContent = code;
      $('host-status').textContent = 'Waiting for a challenger…';
    };
    net.onConnected = (calls) => {
      currentCallsigns = calls;
      game.silent = false; game.paused = false;
      game.startMatch(calls, selectedMap);
      appState = 'host'; endShown = false; frozen = false;
      hideScreens(); hideModals(); showHint(ONLINE_HINT);
      toast(calls[1] + ' joined the fight!');
    };
    net.onRematchReq = () => { if (appState === 'host') doRematch(); };
    net.host(call);
    showScreen('s-host');
    $('host-code').textContent = '····';
  }

  function beginJoin() {
    wireNetCallbacks();
    const code = clean($('join-code').value, '');
    if (code.length < 4) { $('join-status').textContent = 'Enter the 4-character code.'; return; }
    const call = clean($('cs-online').value, 'GHOST');
    $('join-status').style.color = 'var(--ice)';
    net.onConnected = (calls) => {
      currentCallsigns = calls;
      if (Audio.started) { Audio.engineStart(2); Audio.startMusic(); }
      appState = 'client'; endShown = false; frozen = false;
      hideScreens(); hideModals(); showHint(ONLINE_HINT);
      toast('Linked with ' + calls[0]);
    };
    net.join(code, call);
    $('join-status').textContent = 'Connecting…';
  }

  function handleDisconnect() {
    if (appState !== 'host' && appState !== 'client') return;
    frozen = true;
    hideModals();
    $('o-disc').classList.remove('hidden');
    Audio.lockOff(0); Audio.lockOff(1); Audio.warnOff(0); Audio.warnOff(1);
    showHint(null);
  }

  /* --------------------------------------------------------- match end */
  function showEnd(winnerIdx, planes) {
    endShown = true;
    const wp = planes[winnerIdx];
    $('end-sub').textContent = (wp ? wp.callsign : 'PILOT') + ' WINS';
    $('end-sub').style.color = winnerIdx === 0 ? 'var(--ice)' : 'var(--sun)';
    $('o-end').classList.remove('hidden');
    // In online, only the host can truly restart; label the client's button.
    const rb = document.querySelector('#o-end [data-go="rematch"]');
    if (appState === 'client') rb.textContent = 'REQUEST REMATCH';
    else rb.textContent = 'REMATCH';
  }
  function doRematch() {
    endShown = false; hideModals();
    if (appState === 'client') { try { net.conn && net.conn.send({ t: 'rematch' }); } catch (e) {} toast('Rematch requested…'); return; }
    game.startMatch(currentCallsigns);
    if (appState === 'practice') ai.reset();
  }

  /* Host: accept client's rematch request. */
  net.onRematchReq = () => { if (appState === 'host') doRematch(); };
  // hook host data channel for rematch requests
  const _origHost = net.host.bind(net);
  net.host = function (c) {
    _origHost(c);
    const iv = setInterval(() => {
      if (net.conn) {
        clearInterval(iv);
        net.conn.on('data', (d) => { if (d && d.t === 'rematch' && net.onRematchReq) net.onRematchReq(); });
      }
    }, 100);
  };

  /* ------------------------------------------------------------- go() */
  function go(action) {
    switch (action) {
      case 'menu': gotoMenu(); break;
      case 'local': beginLocal(false); break;
      case 'practice': beginLocal(true); break;
      case 'online': showScreen('s-online'); break;
      case 'online-cancel': try { net.hangUp(); } catch (e) {} showScreen('s-online'); break;
      case 'host': beginHost(); break;
      case 'join': showScreen('s-join'); $('join-status').textContent = ''; setTimeout(() => $('join-code').focus(), 50); break;
      case 'join-go': beginJoin(); break;
      case 'resume': setPause(false); break;
      case 'quit': gotoMenu(); break;
      case 'rematch': doRematch(); break;
    }
    Audio.uiBeep(560);
  }

  function selectMap(id) {
    selectedMap = id;
    document.querySelectorAll('#map-opts .map-opt').forEach((el) => el.classList.toggle('sel', +el.getAttribute('data-map') === id));
    if (appState === 'menu') startAttract();   // preview the arena behind the menu
    Audio.uiBeep(600);
  }

  // Delegate clicks
  document.addEventListener('click', (e) => {
    const goEl = e.target.closest('[data-go]');
    if (goEl) { go(goEl.getAttribute('data-go')); return; }
    const mapEl = e.target.closest('[data-map]');
    if (mapEl) { selectMap(+mapEl.getAttribute('data-map')); return; }
    const modEl = e.target.closest('[data-modal]');
    if (modEl) { openModal(modEl.getAttribute('data-modal')); return; }
    const closeEl = e.target.closest('[data-close]');
    if (closeEl) { closeEl.closest('.modal').classList.add('hidden'); return; }
  });

  $('btn-mute').addEventListener('click', () => { bootAudio(); Audio.toggleMute(); updateMuteBtn(); });
  $('copy-link').addEventListener('click', () => {
    const code = $('host-code').textContent;
    const url = location.href.split('?')[0].split('#')[0] + '?room=' + code;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Invite link copied!'), () => toast(url));
    else toast(url, 6000);
  });
  $('ctl-reset').addEventListener('click', () => { Input.resetBindings(); buildControls(); });

  // Title/menu keyboard: Enter starts
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
      if (!$('s-title').classList.contains('hidden')) go('menu');
      else if (!$('o-end').classList.contains('hidden')) go('rematch');
    }
  });

  /* ------------------------------------------------------------ modals */
  function openModal(id) {
    if (id === 'm-controls') buildControls();
    $(id).classList.remove('hidden');
  }

  function buildControls() {
    ['p1', 'p2'].forEach((pl) => {
      const host = $('ctl-' + pl);
      host.innerHTML = '';
      ACTION_ORDER.forEach((act) => {
        const row = document.createElement('div'); row.className = 'ctl-row';
        const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = ACTION_LABELS[act];
        const key = document.createElement('button'); key.className = 'key';
        key.textContent = Input.keyLabel(Input.bindings[pl][act]);
        key.addEventListener('click', () => {
          key.classList.add('listening'); key.textContent = 'PRESS…';
          Input.beginRebind(pl, act, () => { buildControls(); });
        });
        row.appendChild(lbl); row.appendChild(key); host.appendChild(row);
      });
    });
  }

  /* ------------------------------------------------------------- pause */
  function setPause(p) {
    if (appState !== 'local' && appState !== 'practice') return;
    game.paused = p;
    $('o-pause').classList.toggle('hidden', !p);
    if (p) { Audio.lockOff(0); Audio.lockOff(1); Audio.warnOff(0); Audio.warnOff(1); }
  }

  /* --------------------------------------------------------- main loop */
  function stepGame(dt) {
    if (game.paused) return;
    if (game.hitStop > 0) { game.hitStop = Math.max(0, game.hitStop - dt); return; }
    let in0, in1;
    if (appState === 'local') { in0 = Input.snapshot('p1'); in1 = Input.snapshot('p2'); }
    else if (appState === 'practice') { in0 = Input.snapshot('p1'); in1 = ai.input(game, 1, dt); }
    else { in0 = Input.snapshot('p1'); in1 = net.hostInput(); } // host
    game.step(dt, [in0, in1]);
    game.updateAudio(dt);
    if (appState === 'host') net.hostTick(dt);
  }

  function checkEnd() {
    if (!endShown && game.phase === 'matchEnd') showEnd(game.matchWinner, game.planes);
  }

  function frame(ts) {
    let dt = (ts - last) / 1000; last = ts;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;   // clamp big gaps (tab switches)

    if (frozen) {
      // render last known frame under the disconnect overlay
      if (appState === 'client' && lastView) renderer.render(lastView);
      else if (game.planes[0]) renderer.render(game);
      requestAnimationFrame(frame); return;
    }

    if (appState === 'menu') {
      stepAttract(dt);
      renderer.render(attract);
    } else if (appState === 'local' || appState === 'practice' || appState === 'host') {
      stepGame(dt);
      renderer.render(game);
      checkEnd();
    } else if (appState === 'client') {
      const view = net.clientTick(dt);
      if (view) { lastView = view; renderer.render(view); if (!endShown && view.matchWinner >= 0) showEnd(view.matchWinner, view.planes); }
      else renderer.render(attract); // still connecting
    }

    // global keys
    if (Input.takeMute()) { Audio.toggleMute(); updateMuteBtn(); }
    if (Input.takePause()) {
      if (appState === 'local' || appState === 'practice') setPause(!game.paused);
      else if (appState === 'host' || appState === 'client') toast('No pause in online play.', 1500);
    }

    requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------- deep link */
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');

  function boot() {
    startAttract();
    updateMuteBtn();
    if (roomParam) {
      $('s-title').classList.add('hidden');
      showScreen('s-join');
      $('join-code').value = clean(roomParam, '');
      toast('Room code loaded — press CONNECT.', 4000);
    }
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
  }
  boot();

  // expose a few handles for tuning in the console
  window.FOXTWO = { game, net, renderer, Audio, Input, CONFIG, ai };
})();
