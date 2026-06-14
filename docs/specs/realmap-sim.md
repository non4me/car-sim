# Spec — real-map driving simulator (`/drive`)

The primary module. Free-roam driving of a car through a real city's actual streets, rendered
top-down in 2D, with real per-segment speed limits, signs/markings/signals, a speedometer, and live
warnings on rule violations. First target: **one Prague district**; the same engine + bake then
scale to all of Prague and other cities.

Derived from `docs/research/realmap-osm-feasibility.md` and `docs/architecture/ARCHITECTURE.md`.

## 1. Goals / non-goals

**Goals**
- Drive freely (no time limit, no rails) anywhere a normal car can go on the mapped street surface.
- Real geometry: street shapes, widths, one-ways, junctions match OSM for the area.
- Real rules surfaced: per-segment speed limit with over-limit warning; signals/priority/markings
  shown; map-boundary braking.
- Controls feel like an automatic car: `↑/↓` gas/reverse, `←/→` steer, `Space` hard brake.
- Runs smoothly in a browser; bake is offline and deterministic; adding a city is procedural.

**Non-goals (MVP)**
- Photoreal graphics, 3D, interiors/courtyards, traffic AI, pedestrians, parking logic.
- Full legal enforcement of every rule (start with speed + boundary + basic signal/oneway cues).
- Routing/navigation/destinations.

## 2. Vehicle model

Kinematic **bicycle model** (no full physics): state `{x, y, heading θ, speed v}`, wheelbase `L`.

- `↑` throttle → accelerate forward (a_accel, eased); `↓` → brake to 0 then reverse (slow).
- `←/→` → front-wheel steer angle δ, **clamped smaller as v rises** (no twitchy high-speed turns).
- `Space` → hard brake (a_brake_hard), strongest deceleration; also rapid stop from reverse.
- Idle (no throttle) → gentle engine-brake / rolling drag.
- Update per fixed dt (1/60): `θ += (v/L)·tan(δ)·dt`, `x += v·cosθ·dt`, `y += v·sinθ·dt`.
- The car **may exceed the limit** — that is the teaching point; speeding triggers a warning, not a cap.
- "Automatic feel" = smooth accel/decel curves, auto-hold at stop, no gear UI. Tunable constants in
  `vehicle/params.js` (accel, brake, hard-brake, max speed, steer-vs-speed curve, drag).

## 3. World & free-roam (the core design choice)

The car moves in **continuous 2D**, over the **road surface**, not snapped to lane centrelines.

- Each drivable OSM edge bakes to a **road-surface polygon** (a quad strip along its polyline,
  width = `lanes × 3.5 m`, default lanes by road class). The union of these polygons = the drivable
  surface. Junctions are filled where edges meet.
- **On-surface check** each frame: is the car's footprint on any road polygon? Resolved fast via a
  bake-time spatial grid (car → candidate edges in its grid cell → point/polygon test).
- **Off-surface within the city** (sidewalk / building / park): soft block — the car decelerates and
  can't push further in (a normal car can't mount a building). MVP: treat as a soft wall (stop +
  nudge back); refined later.
- **Outside the mapped area** (map boundary): brake the car to a stop with a "Dál cesta nevede —
  otočte se / No road ahead — turn around" warning, per the brief.
- Schematic **buildings** (OSM `building=*`) and **landuse/natural** (park, water) render as flat
  coloured areas for orientation only; buildings are also the off-road blockers.

## 4. Rules surfaced (MVP → later)

- **Speed limit (MVP):** locate the car's current edge (nearest-edge query on the grid) → its
  resolved `maxspeed`. Speedometer always visible; when `v > limit + tol` → red speedo + "překročení
  rychlosti / over the limit" warning. Limits resolved at bake from explicit `maxspeed` or the
  **country rules profile** defaults (CZ: obec 50, zóna 30, obytná 20, mimo obec 90, motorway 130).
- **Boundary (MVP):** as in §3.
- **Signals & signs (phase 2):** render traffic_signals at junctions (static state first, cycling
  later); render give_way/stop/derived-priority markers; oneway arrows.
- **Violations (phase 3):** wrong-way on a oneway, entering on red, ignoring stop — surfaced as
  non-blocking warnings (teaching, not game-over).

## 5. Map bake (`tools/bake_city.py`)

Offline, deterministic; input = OSM extract for a bbox + `countries/cz.yaml`; output =
`data/cities/cz/praha/<district>/` tiles + `meta.json`.

1. Fetch OSM (Overpass for a district bbox now; Geofabrik `.osm.pbf` for all-Prague later).
2. Keep drivable highways: motorway, trunk, primary, secondary, tertiary, unclassified, residential,
   living_street, service (filter out footway/steps/path/cycleway-only).
3. **Split ways at shared nodes** → edges (junction-to-junction). Edge attrs: polyline geometry,
   `lanes` (tag or class default), `width = lanes×3.5`, `oneway`, `maxspeed` (explicit → profile
   default), `name`, `class`.
4. **Junctions**: nodes of degree ≥ 3 or tagged signal/stop/give_way. Attach control: explicit
   OSM control, else **derived priority** (higher road class = priority; equal class ⇒ *přednost
   zprava*). (See research — OSM sign coverage is sparse, so derivation is required.)
5. **Backdrop**: simplify `building=*` footprints and `leisure=park`/`natural=water`/`landuse=*`
   to coarse polygons.
6. **Tile** by a ~400 m grid; write each tile `{edges[], junctions[], buildings[], areas[]}` as
   compact JSON; write `meta.json` `{bbox, district, grid, version, attribution, profile}`.
7. **Validate**: graph connectivity (no orphan islands in the slice), maxspeed coverage %, junction
   sanity, render a debug PNG of the baked district for eyeball check.

## 6. Runtime client (`static/drive/`)

ES-module canvas app, fixed-dt loop (1/60), DOM-free core where practical (testable like the
scenario sim).

```
drive/
  engine/loop.js      fixed-dt step + render schedule
  map/tiles.js        load/cache tiles for viewport; nearestEdge(pos); onSurface(pos)
  vehicle/car.js      bicycle model + params
  vehicle/input.js    keyboard (↑↓←→ Space), pointer fallback
  render/view.js      world↔screen, camera follows car
  render/draw.js      road polygons, markings, junctions, signs, buildings/areas, car
  rules/limits.js     current limit, over-limit + boundary checks → HUD events
  hud/hud.js          speedometer, limit sign, warnings (i18n)
  main.js             wire-up
```

- Camera: top-down, centred on the car (slight look-ahead by speed), fixed metric zoom (zoomable later).
- Performance budget: stream only viewport tiles + 1 ring; cull off-screen geometry; target 60 fps on a laptop for a district, ≥30 fps as coverage grows (WebGL/Pixi swap kept open behind `render/`).

## 7. Open questions (resolve during implementation, not assumed)

- Exact off-road model (soft wall vs slow-grass) and building collision fidelity.
- Lane-level vs single-surface driving at multi-lane roads / how to depict direction of travel.
- Tile size & streaming budget vs all-Prague; when (if) to move from Canvas 2D to WebGL.
- Junction-priority derivation rules — validate against known Prague junctions.
- How "real" signs get without OSM data (derive vs a supplementary sign source) — beyond speed.

## 8. Acceptance — district vertical slice (first milestone)

1. `bake_city.py` produces a valid tiled artifact for one Prague district (debug PNG looks like the
   real streets).
2. `/drive` loads it and renders the district top-down.
3. You can drive the car with `↑↓←→ Space`, feel automatic-like, follow the real streets freely.
4. Speedometer works; over-limit warning fires on a real low-limit street; map-boundary braking works.
5. Smooth (~60 fps) for the district. Then: demo to Vlad → approve → expand.
