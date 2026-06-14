// car-sim /drive — heading-up free-roam: load district, spawn on a road, drive.
import { makeView } from "./render/view.js";
import { loadMap } from "./map/tiles.js";
import { Car } from "./vehicle/car.js";
import { makeInput } from "./vehicle/input.js";
import { draw } from "./render/draw.js";
import { evalRules } from "./rules/limits.js";
import { makeHud } from "./hud/hud.js";
import { makeMinimap } from "./hud/minimap.js";
import { runLoop } from "./engine/loop.js";

const ZMIN = 14, ZMAX = 150;        // absolute zoom bounds (px per metre)
const UMUL_MIN = 0.6, UMUL_MAX = 4.0;  // mouse-wheel zoom multiplier range

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
  const g = best.geom, i = Math.max(1, Math.floor(g.length / 2));
  const a = g[i - 1], c = g[i];
  return { x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2, h: Math.atan2(c[1] - a[1], c[0] - a[0]) };
}

// Default framing pulled ~2× further out than the first cut (Vlad: "зум слишком близкий"):
// the road occupies ~15–35% of viewport width by its real width. The wheel (userMul 0.6–4.0)
// then reaches ~2× the old default at the close end. At speed the zoom eases out a touch more
// for look-ahead.
function autoZoom(view, roadWidth, speed = 0) {
  const t = Math.min(1, Math.max(0, (roadWidth - 3.5) / (14 - 3.5)));
  const pct = 0.15 + t * 0.20;               // 15%..35% of viewport width by road width
  const base = (pct * view.w) / roadWidth;
  const sf = 1 - 0.25 * Math.min(1, speed / 16);  // 1.0 at rest → 0.75 at ~58 km/h
  return base * sf;
}

async function boot() {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const view = makeView(canvas);
  view.resize();
  window.addEventListener("resize", view.resize);

  const map = await loadMap(window.CARSIM.dataBase);
  const sp = pickSpawn(map);
  const car = new Car(sp.x, sp.y, sp.h);
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
  view.zoom = autoZoom(view, rules.width, Math.abs(car.v)) * view.userMul;

  // mouse-wheel zoom (user bias within bounds)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    view.userMul *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.userMul = Math.max(UMUL_MIN, Math.min(UMUL_MAX, view.userMul));
  }, { passive: false });

  function update(dt) {
    const px = car.x, py = car.y;
    car.blocked = false;
    car.update(dt, dbg || input.controls());
    rules = evalRules(map, car);
    if (rules.boundary) { car.x = px; car.y = py; car.v = 0; car.blocked = true; }
    else if (rules.offRoad) { car.v *= 0.90; car.blocked = true; }
  }

  const zoomEl = document.getElementById("zoomind");
  function render() {
    const target = Math.max(ZMIN, Math.min(ZMAX, autoZoom(view, rules.width, Math.abs(car.v)) * view.userMul));
    view.zoom += (target - view.zoom) * 0.12;   // smooth zoom transitions
    view.setCamera(car.x, car.y, car.h);         // heading-up
    draw(ctx, view, map, car, rules);
    hud.update(rules);
    minimap.draw(map, car, rules.street);
    // live zoom readout so Vlad can orient/direct by the number (current · wheel × · range)
    if (zoomEl) {
      const base0 = autoZoom(view, rules.width, 0);   // at-rest framing for a stable range
      const lo = Math.round(Math.max(ZMIN, base0 * UMUL_MIN));
      const hi = Math.round(Math.min(ZMAX, base0 * UMUL_MAX));
      zoomEl.textContent = `zoom ${Math.round(view.zoom)} px/m · ×${view.userMul.toFixed(2)} · ${lo}–${hi}`;
    }
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
