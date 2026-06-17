# Signs at complex junctions + multi-level interchanges (msg 2980)

## Problem (Vlad, Plzeň Studentská interchange screenshot)
1. **Sign duplication / overload.** At complex junctions and multi-level interchanges a huge cluster of
   derived give-way (🔻) + priority-road (🟡) signs appears. Caused by the msg-2715 derivation emitting a
   sign per approach at *every* junction node — and at an interchange the ramp split-nodes cluster densely,
   plus grade-separated merges (which in reality have no give-way) still get derived signs.
2. **Multi-level interchanges let the car hop between roads on different levels.** The runtime
   `nearestEdge(x,y)` returns the geometrically-closest centerline regardless of level, so a car on the
   surface street snaps its lane-align/rules onto the overpass passing above. The bake stores **no** layer
   data for drivable roads (only railways check `tunnel`), so nothing can distinguish levels.

## Root causes
- `tools/bake_city.py`: edges have no `layer`/`bridge`/`tunnel`. Sign derivation (`build_artifact`) emits
  give_way on every minor approach + priority_road on every main approach at every mixed-class node; no
  grade-separation check, no dedupe, no degree cap.
- `app/static/drive/map/tiles.js`: `nearestEdge` / `onSurface` are level-agnostic (pick nearest centerline).
- Connectivity itself is fine: OSM bridges don't share nodes with the road below, so the *graph* has no
  false junction — the jumping is purely a snapping/level issue, not a graph-topology one.

## Design

### A. Capture level in the bake (`build_artifact`)
- Per drivable way read `layer` (int), `bridge`, `tunnel`. Effective level
  `lv = int(layer)` if present else `+1` if `bridge=yes` else `-1` if `tunnel=yes` else `0`.
- Store `lv` on each edge **only when != 0** (runtime defaults missing → 0); keeps tiles small + old tiles valid.

### B. Level-aware snapping (runtime)
- `nearestEdge(x, y, layer)` minimises `edgeDist + (e.lv !== layer ? LAYER_PENALTY : 0)` (`LAYER_PENALTY ≈ 20 m`)
  → strongly prefers the car's current level; a *much* closer different-level edge can still win (genuine
  ramp transitions, where no same-level road is near).
- `car.layer` tracks the snapped edge's `lv` each frame; the penalty gives hysteresis so the car stays on
  its level and only changes level by driving a connected ramp (ramps share nodes → continuous geometry).
- `onSurface(x, y, layer)` counts only same-level edges → the off-road wall is per-level, so a car under a
  bridge is on the *street* surface, not the bridge → it can't drift onto the overpass.
- Net: you can only get onto the overpass by driving the ramp that physically connects to it.

### C. Optimise sign derivation (bake) — targeted, no regression on normal junctions
- **Suppress derived signs at grade-separated / interchange nodes:** skip derivation when the junction has
  any motorway/trunk/`*_link` incident edge, OR incident edges differ in `lv` (a level-transition node),
  OR degree ≥ 6 (interchange merge). Explicit OSM signals/stop/give_way still render.
- **Dedupe co-located signs:** after derivation collapse same-kind signs within `R ≈ 12 m` to one.
- Normal at-grade mixed-class town junctions keep the msg-2715 behaviour (give_way on minors, priority_road
  on the main) — that was Vlad-requested and looks right; only the interchange explosion is removed.

### D. Re-bake + roll out
- Validate on **Plzeň first** (the screenshot city, small 9 MB pbf): re-bake, deploy, verify the interchange
  is clean and the car can't hop levels. Then re-bake Praha/Brno/Ostrava and deploy.
- Re-bake is required (layer + signs live in the streamed tiles; no post-bake sidecar can add per-edge level).

## Verify
- Plzeň Studentská interchange: only a few clean signs; no give-way swarm.
- Drive the surface street under the overpass: lane-align/rules stay on the street; the car cannot transfer
  onto the overpass except via the ramp.

## Status — DONE (2026-06-17)
- [x] A bake: capture `lv` (`road_level()`; layer/bridge/tunnel → edge `lv`, omitted when 0)
- [x] C bake: suppress derived signs at grade-separated nodes (motorway/trunk/`*_link`, mixed `lv`, deg≥6),
      **drop service/living_street as sign-generating** (the big win — driveways were half the edges), dedupe
      same-kind within 12 m
- [x] B runtime: `nearestEdge(x,y,layer)` with a 22 m level penalty; `onSurface(…,layer)`; `car.layer`
      tracked each frame from the snapped edge (kept while off-road); `offroadPen`/`laneAlign`/`evalRules`/
      `goTo` all level-aware
- [x] re-bake Plzeň, deploy, verify: signs **15 023 → 4 311** (−71%); interchange swarm gone; tunnel/ground
      crossing — `nearestEdge(…,-1)` returns tunnel, `nearestEdge(…,0)` returns ground
- [x] re-bake Praha (79 162 → 24 042), Brno (→4 819), Ostrava (→4 701), deploy; Praha drive regression-tested OK

## Result
~70 % fewer signs in every city, interchange swarm eliminated, car can't hop carriageway levels. Follow-up
(msg 2983): differentiate bridge/tunnel **surfaces** + their names, object icons (standard + custom) at
locations, admin UI to add objects manually.
