import { signalState } from "./signals.js";

// Evaluate what the car is doing against the map: current segment + speed limit,
// over-limit, off-surface, and out-of-bounds (map edge). Pure, testable.
export function evalRules(map, car) {
  const b = map.meta.bounds;
  const M = 25; // metres of slack past the baked bounds before "no road"
  const inBounds = b && car.x > b.minx - M && car.x < b.maxx + M &&
                        car.y > b.miny - M && car.y < b.maxy + M;
  let ne = map.nearestEdge(car.x, car.y, car.layer ?? null);   // prefer the car's carriageway level (msg 2980)
  // Carriageway-level transition: if our current-level road is now off to the side (>½ width) but a road on
  // ANOTHER level sits right under us, we've driven onto a ramp/bridge span baked at a different lv while
  // car.layer hasn't caught up. Without this the layer penalty keeps the old-level segment "winning" at
  // >½ width for ~22 m → a false "off road" (Mimo vozovku) across the whole bridge approach. Only switches
  // when the same-level road is genuinely off-surface, so msg 2980 (don't snap to an overpass above/below) holds.
  if (ne.edge && ne.dist > ne.edge.width / 2 + 1.2) {
    const raw = map.nearestEdge(car.x, car.y, null);
    if (raw.edge && raw.dist < ne.dist - 2) ne = raw;   // a clearly-closer other-level road → we're on it
  }
  const edge = ne.edge, dist = ne.dist;
  const onSurface = edge ? dist <= edge.width / 2 + 1.2 : false;
  const kmh = Math.round(Math.abs(car.v) * 3.6);
  const limit = edge ? edge.maxspeed : null;
  const over = limit != null && onSurface && kmh > limit + 3;

  // oncoming-lane / wrong-way (RHT, §). On a one-way street, geom = flow direction, so a
  // heading pointing against it is wrong-way. On a two-way road, being clearly on the LEFT of
  // your own travel direction means you've crossed the centre line into the oncoming lane.
  let oncoming = false;
  if (edge && onSurface) {
    const along = Math.cos(car.h) * ne.tx + Math.sin(car.h) * ne.ty;   // >0: travelling in geom dir
    if (edge.oneway) {
      oncoming = along < -0.35;                       // facing against the flow
    } else if (edge.width >= 5) {
      const cross = ne.tx * (car.y - ne.py) - ne.ty * (car.x - ne.px); // >0: left of geom tangent
      const leftOfTravel = (along >= 0 ? 1 : -1) * cross;
      oncoming = leftOfTravel > 0.8;                  // ≥0.8 m past centre into the oncoming half
    }
  }

  // traffic signals (msg 3151): the nearest signal head AHEAD of the car (per-approach heads carry their
  // phase group `grp` + junction centre `jx,jy`). signal = its current aspect; ranRed pulses when the car
  // rolls past a red head while moving (rising-edge → a "ran red" violation, fed into the trip stats).
  let signal = null, signalDist = Infinity, ranRed = false;
  const ch = Math.cos(car.h), shy = Math.sin(car.h);
  for (const s of map.signs) {
    if (s.kind !== "signal" || s.grp === undefined) continue;
    const dx = s.x - car.x, dy = s.y - car.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 30 * 30) continue;
    const d = Math.sqrt(d2) || 1;
    if ((dx * ch + dy * shy) / d < -0.3) continue;            // only heads in front (or just crossed)
    if (d < signalDist) {
      signalDist = d;
      signal = signalState(s.jx, s.jy, s.grp);
      // a genuine red-run: actually entering the junction (d<4 m of the head) still moving (>10 km/h).
      // The old d<7 & kmh>5 tripped on the legitimate braking approach (car slows to a stop at d≈3.5 m,
      // but passed d=7 m at ~18 km/h) → false "ran red" on every stop (mass test-drive, msg 3170).
      ranRed = signal === "red" && d < 4 && kmh > 10;
    }
  }

  return {
    limit, over, onSurface, oncoming,
    signal, signalDist, ranRed,
    boundary: !inBounds,
    offRoad: inBounds && !onSurface,
    street: edge ? (edge.name || "") : "",
    ref: edge ? (edge.ref || "") : "",           // road number(s) for the HUD badge (msg 3030)
    iref: edge ? (edge.iref || "") : "",         // E-route number, if any
    cls: edge ? (edge.cls || "") : "",           // highway class → badge colour
    width: edge ? edge.width : 7,
    lv: edge ? (edge.lv || 0) : (car.layer || 0),     // carriageway level the car is on (msg 2980)
    kmh,
  };
}
