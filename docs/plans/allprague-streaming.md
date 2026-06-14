# All-Prague + tile streaming — plan & progress

Goal (Vlad msg 2730/2732): make the map "really huge" (all of Prague, max volume) with virtual
load/unload so only the active fragment is resident in memory. Data currency confirmed: Geofabrik
Czech extract snapshot **2026-06-13** (answered to Vlad).

## Approach
- **Data:** Geofabrik `czech-republic-latest.osm.pbf` (~900 MB), filter to Prague bbox, process with
  pyosmium (streaming). BBBike has no Praha preset.
- **Bake:** new `.pbf` path that reuses the existing edge/area/junction/sign pipeline but reads from
  pbf instead of Overpass, over the whole Prague bbox, tiled by the existing 400 m grid.
- **Runtime streaming:** replace `loadMap` (which `Promise.all`s ALL tiles) with a `TileStore` that
  keeps only a ring of tiles around the camera resident; load-on-approach, evict-behind (+LRU,
  hysteresis); spatial grid becomes incremental (add/remove a tile's segments on load/unload).
- **Snapshot date:** stamp extract timestamp into meta.json + show in UI.
- **LOD pyramid:** follow-up (note as TODO) — needed for clean far zoom-out over the whole city.

## Prague bbox
~ S 49.94, W 14.22, N 50.18, E 14.71 (city ≈ 30×27 km, ~500 km²).

## Phases
- [x] P0. Tooling: pyosmium 4.3.1 in `.venv`; osmium-tool 1.19.1 (brew); CZ .pbf downloaded
      (935 MB, snapshot 2026-06-13).
- [x] P1. `.pbf` bake: `osmium extract -s complete_ways` Prague bbox → praha.osm.pbf (52 MB);
      `tools/bake_prague.py` (reuses `build_artifact`) → **5293 tiles, 113 593 edges, 73 328 junctions,
      283 551 areas, 79 162 signs**, 103 MB on disk (avg 18 KB/tile). snapshot 2026-06-13 in meta.
- [x] P2. Streaming runtime: `loadMap` rewritten as a tile store — resident set near camera, velocity-
      biased prefetch, evict-behind, incremental grid rebuilt on resident change, MAX_RESIDENT=80.
      `main.js` calls `map.update()` each frame; spawn at bounds centre; app default district=prague.
- [ ] P3. Deploy + verify: drive across districts, tiles stream in/out, memory stays flat, perf OK,
      snapshot date visible.

## Decisions / notes
- Prague tiles gitignored (103 MB, regenerable); shipped to Castle via rsync, NOT git.
- Resident set stays small at ALL zooms: even at min zoom 2 px/m the viewport spans ~550 m (< 2 tiles),
  so "whole-Prague-at-once" needs LOD (follow-up); driving/overview are local → ≤~16 tiles resident.
- rsync deploy MUST `--exclude data/osm` (949 MB of pbf) — shipping only the tiles.

## Issues / notes
- (log problems + decisions here as they come up)
