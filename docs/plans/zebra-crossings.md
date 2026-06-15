# Pedestrian crossings (zebra markings)

Goal: render zebra crossings on the map so the learner sees where pedestrians cross — on
Vlad's signs/markings realism theme (after signs, stop lines, oncoming-lane detection).

## Approach (mirror the existing sign/tile pipeline)
A crossing is a point with a road tangent + the road width. Bake captures `highway=crossing`
nodes that lie on a drivable way; the renderer lays a transverse zebra band across the road.

## Steps
- [x] P0 — bake_city.py: collect `crossing_nodes`; for each on a drivable way compute
      world pos + road tangent (from way neighbours) + width → `crossings[]`; tile them like
      signs; add `n_crossings` to meta. graph.json untouched.
- [x] P1 — bake_prague.py: capture `highway=crossing` nodes from the pbf (they're tagged, so
      EmptyTagFilter passes them; stored before the way pass so the tangent survives).
- [x] P2 — re-bake all-Prague (pbf, ~22 s) → new tiles + meta with crossings.
- [x] P3 — tiles.js: stream `crossings` per tile (default []), expose `map.crossings`.
- [x] P4 — draw.js: drawCrossings() — ladder of white bars across the road (zoom ≥ 8),
      drawn on the asphalt under signs/car.
- [x] P5 — deploy (tiles + code), browser-verify a zebra renders square across a road, report.

## Risk
Touches the streaming tile format. Mitigated: `crossings` is a NEW optional array (old tiles
default to []), graph/routing untouched, streaming already verified — re-verify after deploy.
