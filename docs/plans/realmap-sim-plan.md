# Plan — real-map simulator, district vertical slice

From `docs/specs/realmap-sim.md`. Build order = a working vertical slice for ONE Prague district
(bake → render → drive → rules), then expand only after Vlad approves the slice. Small tasks,
each independently testable.

## Phase 0 — App shell & structure
- [ ] FastAPI app (`app/main.py`) with section routers; `/drive` serves the sim shell page.
- [ ] Repo layout per ARCHITECTURE (`app/`, `static/drive/`, `data/cities/`, `countries/`, `tools/`).
- [ ] `countries/cz.yaml` rules profile: driving side=right; default limits (obec 50, zóna 30,
      obytná 20, mimo obec 90, expressway 110, motorway 130); road-class → default lanes; sign set ref.
- [ ] Dockerfile + `docker-compose.castle.yml` (host `car-sim.troyanenko.com`, Traefik, priority=100) — not deployed yet.

## Phase 1 — Map bake (the core pipeline)
- [ ] `tools/bake_city.py`: Overpass fetch for a chosen district bbox (start: e.g. Vinohrady or Staré Město).
- [ ] Filter drivable highways; split ways at shared nodes into edges; resolve `{lanes, width, oneway, maxspeed, name, class}` via `cz.yaml`.
- [ ] Build junctions (degree ≥3 / signal / stop / give_way) + control (explicit OSM, else derived priority).
- [ ] Coarse backdrop polygons (buildings, parks, water).
- [ ] Tile by ~400 m grid → `data/cities/cz/praha/<district>/tiles/*.json` + `meta.json`.
- [ ] Validation: connectivity check, maxspeed-coverage %, and a **debug PNG** of the baked district (eyeball vs real map).

## Phase 2 — Static render
- [ ] `static/drive/` skeleton + `/drive` page (canvas + HUD containers).
- [ ] `map/tiles.js`: fetch + cache tiles for the viewport (+1 ring); spatial grid for `nearestEdge`/`onSurface`.
- [ ] `render/view.js` (world↔screen, metric zoom) + `render/draw.js`: road polygons, centre/lane markings, junctions, schematic buildings/areas.
- [ ] Free-look pan/zoom to verify the district renders correctly (looks like the real streets).

## Phase 3 — Vehicle & free-roam
- [ ] `vehicle/car.js` bicycle model + `vehicle/params.js` (accel/brake/hard-brake/steer-vs-speed/drag).
- [ ] `vehicle/input.js`: `↑↓←→ Space` (+ pointer fallback); `engine/loop.js` fixed-dt.
- [ ] Camera follows car; drive freely over the road surface.
- [ ] `onSurface` soft-block off-road; map-boundary → brake + stop.
- [ ] Headless test of the vehicle/loop core (DOM-free), like the scenario-sim harness.

## Phase 4 — Rules & HUD
- [ ] `rules/limits.js`: nearest-edge → current `maxspeed`; over-limit detection (+tolerance).
- [ ] `hud/hud.js`: speedometer (km/h), current-limit sign, over-limit warning, boundary warning — i18n (CZ/EN now, full set later).
- [ ] Tune feel (accel/brake/steer) for automatic-comfortable driving.

## Phase 5 — Slice polish & review
- [ ] Smooth ~60 fps for the district; fix culling/streaming hitches.
- [ ] Deploy `car-sim.troyanenko.com` (district slice on `/drive`, intro stub on `/`).
- [ ] Browser-verify live; capture screenshots/clip.
- [ ] **Demo to Vlad → get approval before expanding.**

## Phase 6+ — Expansion (post-approval)
- [ ] All-Prague bake via Geofabrik `.osm.pbf` + the same pipeline; tile-stream the whole city.
- [ ] Signals (cycling state) + sign rendering + oneway arrows (rules phase 2).
- [ ] Violation warnings: wrong-way, red-light, stop (rules phase 3).
- [ ] Fold in Quizzes (`/quiz/*`: port photo-quiz + scenario-sim; signs + rules trainers).
- [ ] Official-documents section; generalise add-country/city procedure; prove a 2nd city.

## Status log
- 2026-06-14: architecture + OSM research committed; sim spec + this plan written. Repo public at github.com/non4me/car-sim.
- 2026-06-14: **first iteration LIVE → https://car-sim.troyanenko.com**. Phases 0–4 done + Phase 5 deployed:
  - Phase 1 bake validated on Vinohrady (438 edges, 280 junctions; debug PNG matches the real grid + arteries).
  - Phase 0/2/3/4: FastAPI app + Canvas client engine (rasterized-grid tile loader, bicycle-model car with
    automatic feel, camera follow, road/markings/junction renderer, per-segment speed-limit + off-road +
    boundary rules, HUD). Headless vehicle test passes.
  - Verified: drives the real streets (clean 217 m run staying on-surface), live street names (Mánesova →
    náměstí Jiřího z Poděbrad → Slezská → Vlkova), 50 limit shown, off-road "Mimo vozovku" warning works.
  - Deployed (Docker + Traefik + Cloudflare, priority=100); browser-verified live.
  - **Known rough edges to refine ("dovést do ума"):** road-following at speed needs steering (no lane
    assist yet); over-limit warning logic done but visual capture flaky under headless RAF throttling;
    no signs/signals/buildings backdrop yet; one district only; camera zoom fixed. Awaiting Vlad's feedback.
