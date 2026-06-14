// car-sim /drive — wire-up: load baked district, spawn on a road, drive it.
import { makeView } from "./render/view.js";
import { loadMap } from "./map/tiles.js";
import { Car } from "./vehicle/car.js";
import { makeInput } from "./vehicle/input.js";
import { draw } from "./render/draw.js";
import { evalRules } from "./rules/limits.js";
import { makeHud } from "./hud/hud.js";
import { runLoop } from "./engine/loop.js";

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
  return {
    x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2,
    h: Math.atan2(c[1] - a[1], c[0] - a[0]),
  };
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
  let rules = evalRules(map, car);
  let dbg = null; // optional debug control override

  function update(dt) {
    const px = car.x, py = car.y;
    car.blocked = false;
    car.update(dt, dbg || input.controls());
    rules = evalRules(map, car);
    if (rules.boundary) {                 // map edge: hard stop, can't leave the city
      car.x = px; car.y = py; car.v = 0; car.blocked = true;
    } else if (rules.offRoad) {           // off the road surface: heavy drag ("grass"), not stuck
      car.v *= 0.90;
      car.blocked = true;
    }
  }

  function render() {
    // camera follows the car, with a little look-ahead by speed
    view.follow(car.x + Math.cos(car.h) * car.v * 0.35,
                car.y + Math.sin(car.h) * car.v * 0.35);
    draw(ctx, view, map, car);
    hud.update(rules);
  }

  // expose for headless/debug
  window.__drive = {
    car, map, view, rules: () => rules,
    set: (o) => { dbg = o; }, clear: () => { dbg = null; },
  };
  runLoop(update, render);
}

boot();
