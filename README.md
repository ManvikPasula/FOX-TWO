# ✈️ FOX TWO

**A Top Gun–style 2D dogfighting game.** Sunset over the ocean, an aircraft
carrier below, afterburner glory, and cocky radio chatter. Two jets, one arena,
three weapon systems locked in a rock‑paper‑scissors knife‑fight.

> *"Fox Two"* is the real radio brevity call a pilot makes when firing a
> heat‑seeking (IR) missile — the heart of this game.

Built with **HTML5 Canvas + vanilla JavaScript**. All art, particles, and sound
are generated **procedurally in code** — there are no image or audio files.
Runs at 60 FPS on a normal laptop.

---

## ▶ Play right now (local, zero setup)

**Double‑click `index.html`.** That's it. No install, no server, no internet
required. Two players share one keyboard, or play **PRACTICE** against the AI.

*(Online mode needs the files hosted — see [Play online](#-play-online-1v1) below.)*

---

## 🎮 Controls

Two physically separated key clusters so both pilots can move **and** fire at the
same time without laptop keyboard "ghosting."

| Action | Player 1 (ice‑blue) | Player 2 (sunset‑red) |
|---|---|---|
| Turn left / right | `A` / `D` | `←` / `→` |
| Throttle up / down | `W` / `S` | `↑` / `↓` |
| **Guns** (hold) | `Left Shift` | `/` |
| **Fire missile** (Fox Two) | `Q` | `.` |
| **Flares** | `E` | `,` |
| **Afterburner** (hold) | `Left Ctrl` | `Right Shift` |

Global: **`P`** pause (local only) · **`M`** mute.
Controls are **remappable** from the menu → *CONTROLS*.

**Online:** both pilots use the Player‑1 (WASD) layout on their own keyboard.

---

## 🕹️ How to play

Score **3 round wins** (best of five) to take the match.

- **GUNS** — short range, must be aimed. Fire in **bursts**: hold the trigger
  too long and they **overheat** and lock out for ~1.8s; ease off and they cool
  on their own. A few solid hits down a jet.
- **FOX TWO (IR missile)** — hold the enemy in your nose cone until **LOCK**
  completes, then fire. It chases heat. Only **4 per round** with a short
  reload between launches, so you can't spam them.
- **FLARES** — pop hot decoys to spoof an incoming missile. **Flare *and* break
  hard together** to reliably shake it.

**Energy management:** fly *slow* to turn tight, *fast* to cover ground (but you
turn wide). **Afterburner** is fast — but it lights you up like a beacon on IR,
making you far easier to lock and track. Deliberate risk/reward.

**Beating a missile** (it's always survivable):
1. **Flares + a hard break** — the reliable answer at any range.
2. **Out‑run its fuel** — a missile fired from far away can be defeated by a
   well‑timed hard break as its motor burns out (it goes dumb and overshoots).
3. Close‑range shots are deadly — that's what flares are for.

Use **ships** for cover — the carrier and destroyers block guns, missiles, and
line‑of‑sight (so they can break a lock), but scrape their hull and you take
damage. Pick your **arena** on the menu:

- **OPEN SKIES** — no obstacles, pure dogfight.
- **CARRIER** — one aircraft carrier in the middle.
- **TASK FORCE** — a carrier plus two destroyers (top‑left & bottom‑right).

The arena has **hard walls** — you can't fly off one side and reappear on the
other, so there's nowhere to run. Stay in the fight.

---

## 🌐 Play online (1v1)

Online uses **WebRTC via PeerJS** — peer‑to‑peer, with PeerJS's free cloud only
brokering the initial handshake. **There is no game server to run.** The gameplay
data flows directly between the two players.

Online mode needs the files **hosted** (browsers won't do WebRTC from a
double‑clicked `file://` page). Drop the folder on any free static host:

- **GitHub Pages:** push this folder to a repo → *Settings → Pages* → deploy from
  the branch root → share the `https://<you>.github.io/<repo>/` URL.
- **Netlify / Vercel:** drag‑and‑drop the folder, or connect the repo.
- **itch.io:** zip the folder (with `index.html` at the top) and upload as an
  HTML5 project.

Then both players open the same URL:

1. One clicks **ONLINE 1V1 → HOST A FIGHT** and shares the 4‑character **room
   code** (or the **COPY INVITE LINK** button — the link auto‑fills the code).
2. The other clicks **ONLINE 1V1 → JOIN A FIGHT** and enters the code.

**Netcode:** host‑authoritative. The host runs the whole simulation (one source
of truth); the client sends its inputs and renders interpolated snapshots with
light local prediction so its own controls feel responsive. Best on decent,
same‑region connections. The host has near‑zero latency — a small, fair edge for
casual play. If someone drops, you'll see **OPPONENT DISCONNECTED** and can bail
back to the menu.

---

## 🔧 Tuning

**Every balance constant lives in one place: [`js/config.js`](js/config.js)** —
speeds, turn rates, lock time, missile fuel/turn/speed, flare decoy behavior,
damage, ammo, health, boost, round count, and network tick rates. Each is
commented. Tweak and reload; the game reads them live.

A few starting points:
- Missiles too strong? Raise `missile.lockTime`, lower `missile.turnRate` or
  `missile.fuel`, or lower `missile.speed`.
- Dogfights too fast/slow? `plane.maxSpeed`, `plane.turnRateLow/High`.
- Rounds too long? `plane.maxHealth`, `guns.damage`, `match.roundsToWin`.

There's also a live handle in the browser console: `FOXTWO.CONFIG`, plus
`FOXTWO.game`, `FOXTWO.net`, etc.

---

## 📁 Project structure

```
index.html        Canvas, menus/overlays, CRT layer, script includes (+ PeerJS CDN, SRI‑pinned)
style.css         80s neon / sunset UI + CRT scanlines & vignette
js/
  config.js       ★ ALL tunable balance constants
  utils.js        math + toroidal (wrap‑aware) geometry helpers
  audio.js        procedural Web Audio: synthwave music, engine hum, SFX, radio blips
  input.js        dual‑keyboard input (by physical key), remappable, anti‑ghosting layout
  entities.js     Plane (energy flight), Bullet, Missile (IR seeker), Flare, Ship (carrier/destroyer), particles
  render.js       sunset/ocean/carrier backdrop, jets, effects, military HUD
  ai.js           dogfighting bot (drives PRACTICE mode + the menu "attract" fight)
  game.js         authoritative simulation, collisions, rounds, scoring, events
  net.js          WebRTC/PeerJS host‑authoritative netcode + client interpolation
  main.js         boot, menu flow, the single 60 FPS game loop
```

The local game is entirely self‑contained; PeerJS is only used for online play
and fails gracefully (local still works) if it can't load.

---

## Modes

- **LOCAL 1V1** — two pilots, one keyboard.
- **PRACTICE** — you vs. an AI wingman (a good warm‑up).
- **ONLINE 1V1** — host/join a peer‑to‑peer match.

Fight's on. **Fox Two!** 🔥
