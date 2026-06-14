// car-sim /drive — heading-up free-roam: load district, spawn on a road, drive.
import { makeView } from "./render/view.js";
import { loadMap } from "./map/tiles.js";
import { Car } from "./vehicle/car.js";
import { makeInput } from "./vehicle/input.js";
import { draw } from "./render/draw.js";
import { evalRules } from "./rules/limits.js";
import { makeHud } from "./hud/hud.js";
import { makeMinimap } from "./hud/minimap.js";
import { loadSearchIndex, makeSearchBox } from "./hud/search.js";
import { runLoop } from "./engine/loop.js";

const ZMIN = 2, ZMAX = 25;      // absolute zoom bounds in px/metre (Vlad msg 2691: min 2 = overview)
const ZOOM_DEFAULT = 16;        // starting zoom (px/m), wheel-adjustable, persisted
const OVERVIEW_Z = 5;           // below this px/m → bird's-eye overview (car drawn as an arrow)
const OFFROAD_WALL = 4.3;       // metres the car may sink off-road before a wall blocks going deeper

function pickSpawn(map) {
  const b = map.meta.bounds;
  const cx = (b.minx + b.maxx) / 2, cy = (b.miny + b.maxy) / 2;
  let best = null, bd = Infinity;
  for (const e of map.edges) {
    if (e.geom.length < 2) continue;
    const mid = e.geom[Math.floor(e.geom.length / 2)];
    const d = Math.hypot(mid[0] - cx, mid[1] - cy) - (e.width > 6 ? 50 : 0);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return { x: cx, y: cy, h: 0 };   // no resident road yet (streaming) — spawn at centre
  const g = best.geom, i = Math.max(1, Math.floor(g.length / 2));
  const a = g[i - 1], c = g[i];
  return { x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2, h: Math.atan2(c[1] - a[1], c[0] - a[0]) };
}

// Zoom is now an absolute px/metre the user controls with the wheel (Vlad directs by the
// on-screen number). At speed it eases out a touch for look-ahead, never below ZMIN.
const speedEase = (speed) => 1 - 0.2 * Math.min(1, speed / 16);   // 1.0 at rest → 0.8 at ~58 km/h

async function boot() {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const view = makeView(canvas);
  view.resize();
  window.addEventListener("resize", view.resize);

  const map = await loadMap(window.CARSIM.dataBase);
  const sp = pickSpawn(map);
  const car = new Car(sp.x, sp.y, sp.h);
  // metres the car's centre is past the road edge (0 = on the drivable surface)
  const offroadPen = (x, y) => {
    const ne = map.nearestEdge(x, y);
    return ne.edge ? Math.max(0, ne.dist - (ne.edge.width / 2 + 1.0)) : 0;
  };
  const input = makeInput();
  const hud = makeHud();
  const minimap = makeMinimap(
    document.getElementById("mini"),
    document.getElementById("miniPlus"),
    document.getElementById("miniMinus"),
    document.getElementById("miniLevel"),
  );
  let rules = evalRules(map, car);
  let dbg = null;
  let paused = false;
  let miniCollapsed = false;

  // minimap opacity (10–100%) + collapse-to-icon, both persisted (msg 2691)
  const miniEl = document.getElementById("minimap");
  const miniRestore = document.getElementById("miniRestore");
  const miniOpacity = document.getElementById("miniOpacity");
  const applyOpacity = (v) => { miniEl.style.opacity = (v / 100).toFixed(2); };
  const savedOp = parseInt(localStorage.getItem("carsim_mini_opacity"), 10);
  miniOpacity.value = Number.isFinite(savedOp) ? savedOp : 100;
  applyOpacity(miniOpacity.value);
  miniOpacity.addEventListener("input", () => {
    applyOpacity(miniOpacity.value);
    localStorage.setItem("carsim_mini_opacity", miniOpacity.value);
  });
  const setCollapsed = (c) => {
    miniCollapsed = c;
    miniEl.classList.toggle("hidden", c);
    miniRestore.classList.toggle("hidden", !c);
    localStorage.setItem("carsim_mini_collapsed", c ? "1" : "0");
  };
  document.getElementById("miniCollapse").addEventListener("click", (e) => { e.preventDefault(); setCollapsed(true); });
  miniRestore.addEventListener("click", (e) => { e.preventDefault(); setCollapsed(false); });
  setCollapsed(localStorage.getItem("carsim_mini_collapsed") === "1");

  // persisted absolute zoom (px/m), restored across sessions
  const clampZoom = (z) => Math.max(ZMIN, Math.min(ZMAX, z));
  let zTarget = clampZoom(parseFloat(localStorage.getItem("carsim_zoom")) || ZOOM_DEFAULT);
  view.zoom = zTarget;

  // mouse-wheel zoom (absolute px/m within bounds; persisted)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zTarget = clampZoom(zTarget * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    localStorage.setItem("carsim_zoom", zTarget.toFixed(2));
  }, { passive: false });

  // controls overlay (first visit only, then "?"), pause (Esc), any-key dismiss
  const ov = document.getElementById("helpOverlay");
  const pauseEl = document.getElementById("pauseOverlay");
  const overlayOpen = () => !ov.classList.contains("hidden");
  const closeHelp = () => { ov.classList.add("hidden"); localStorage.setItem("carsim_help_seen", "1"); };
  const openHelp = () => ov.classList.remove("hidden");
  const setPaused = (p) => { paused = p; pauseEl.classList.toggle("hidden", !paused); };
  document.getElementById("helpBtn").addEventListener("click", (e) => { e.preventDefault(); openHelp(); });
  document.getElementById("helpClose").addEventListener("click", (e) => { e.preventDefault(); closeHelp(); });
  ov.addEventListener("click", (e) => { if (e.target === ov) closeHelp(); });
  const typingInBox = () => {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  };
  window.addEventListener("keydown", (e) => {
    if (typingInBox()) return;                        // let the search box keep its own keys (Esc/Enter/arrows)
    if (overlayOpen()) { closeHelp(); return; }      // any key dismisses the controls overlay
    if (e.key === "Escape") { e.preventDefault(); setPaused(!paused); }   // Esc = pause/resume while driving
  });
  // auto-pause when the window/tab loses focus, so keys that never reach the page can't be
  // mistaken for "the car won't move/turn" (msg 2699). Returning focus resumes.
  window.addEventListener("blur", () => { if (!overlayOpen()) setPaused(true); });
  window.addEventListener("focus", () => setPaused(false));
  pauseEl.addEventListener("click", () => setPaused(false));   // click the pause overlay to resume

  // street / district search → teleport: jump to the target, stream its tiles, snap onto the road
  async function goTo(x, y) {
    setPaused(false);
    car.x = x; car.y = y; car.v = 0;                  // jump there; render() now streams around it
    for (let i = 0; i < 30; i++) {
      const ne = map.nearestEdge(x, y);
      if (ne.edge && ne.dist < 60) { car.x = ne.px; car.y = ne.py; car.h = Math.atan2(ne.ty, ne.tx); car.v = 0; return; }
      await new Promise((r) => setTimeout(r, 80));    // wait for the destination tiles to stream in
    }
  }
  loadSearchIndex(window.CARSIM.dataBase).then((items) => {
    makeSearchBox(document.getElementById("searchInput"), document.getElementById("searchResults"), items, goTo);
  });

  function update(dt) {
    if (paused) return;                               // Esc / lost focus freezes the sim
    const controls = dbg || input.controls();
    // ONE driving model everywhere (heading-up, rotate-in-place): the car always points up and
    // turns the same way at every zoom. Overview (zoom < OVERVIEW_Z) only tightens the off-road
    // wall so the car effectively can't leave the road network (msg 2691); at normal zoom the car
    // may sink ~one body-length off-road before the wall blocks going deeper (msg 2694).
    const wall = view.zoom < OVERVIEW_Z ? 0.2 : OFFROAD_WALL;
    const px = car.x, py = car.y;
    car.blocked = false;
    car.update(dt, controls);
    rules = evalRules(map, car);
    if (rules.boundary) { car.x = px; car.y = py; car.v = 0; car.blocked = true; }
    else {
      // off-road (sidewalk/"black zone"): no speed penalty — drive in/along/out freely, but once
      // the car has sunk past `wall` metres, block going DEEPER like a wall. Off-road is flagged as
      // a violation by the rules (HUD "Mimo vozovku").
      const pen = offroadPen(car.x, car.y);
      if (pen > wall && pen > offroadPen(px, py)) { car.x = px; car.y = py; car.v = 0; car.blocked = true; }
    }
  }

  const zoomEl = document.getElementById("zoomind");
  function render() {
    const target = clampZoom(zTarget * speedEase(Math.abs(car.v)));
    view.zoom += (target - view.zoom) * 0.12;   // smooth zoom transitions
    view.setCamera(car.x, car.y, car.h);         // heading-up at every zoom — car always points up
    // stream tiles around the car (≥480 m so the minimap always has data) + look ahead by velocity
    map.update(car.x, car.y, Math.max(view.visR(), 480), car.v * Math.cos(car.h), car.v * Math.sin(car.h));
    draw(ctx, view, map, car, rules);
    hud.update(rules);
    if (!miniCollapsed) minimap.draw(map, car, rules.street);
    // live zoom readout so Vlad can orient/direct by the number (current px/m · range)
    if (zoomEl) zoomEl.textContent = `zoom ${Math.round(view.zoom)} px/m · ${ZMIN}–${ZMAX}`;
  }

  window.__drive = {
    car, map, view, rules: () => rules,
    set: (o) => { dbg = o; }, clear: () => { dbg = null; },
    // manual deterministic advance (for headless verification when RAF is throttled)
    tick: (n = 1) => { for (let i = 0; i < n; i++) update(1 / 60); render(); return { x: car.x, y: car.y, h: car.h, kmh: car.speedKmh, street: rules.street, zoom: +view.zoom.toFixed(1) }; },
  };
  runLoop(update, render);
}

boot();
