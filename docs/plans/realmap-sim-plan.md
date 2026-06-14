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

## Refinements from Vlad's first-iteration feedback (msg 2663 / 2664 / 2666 / 2667 / 2668) — DONE, LIVE

### Core driving UX — shipped 2026-06-14, browser-verified on car-sim.troyanenko.com
- [x] **Controls (1/2666):** ←/→ rotate the car IN PLACE when stopped, steer while moving (turn applied to
      heading every frame); ↑ accelerate **gently** (2.8 m/s², ~20 km/h after 2 s — fixes "too fast");
      ↓ smooth brake then gentle reverse; **Space = sharp brake (30 m/s²), stops <1 m**.
- [x] **No auto-decel (2668):** releasing ↑ holds speed (cruise) — only ↓/Space slow the car. Verified: 20 km/h
      held through 2 s of no input.
- [x] **Real-scale speed (2667):** 1 m = 1 m projection + gentle accel → no longer crosses a block in seconds.
- [x] **Heading-up camera (4):** car always nose-up at the anchor (0.68 down); the MAP rotates (rot = π/2 − heading).
- [x] **Dynamic zoom (2):** road occupies 30–70 % of viewport width by real width; smooth ease between roads.
      Fixed bbox-based viewport culling (vertex-only cull dropped long edges mid-segment at close zoom).
- [x] **Wheel zoom (2/2664):** mouse wheel biases zoom within clamped bounds (0.45–3.2×), on top of auto-fit.
- [x] **Street names ON roads (3):** label placed at the point on the road nearest the car, offset past the
      car's nose (scales with zoom), oriented along the road with a dark halo. Verified "Mánesova" on-road.
- [x] **Deploy correctness (root-cause fix):** path-versioned static (`/s/<build>/`, immutable) + no-cache HTML;
      replaces the 4 h `max-age` that served stale JS after every deploy. Deploys now live instantly, no CDN purge.

### Backlog — bigger features, each its own research → spec → plan → impl
- [ ] **House numbers (3):** bake OSM `addr:housenumber` nodes; render subtly near buildings. (needs bake + backdrop)
- [ ] **User accounts + progress (5):** registration/login; per-user stats — violations, time driven,
      progress/regress over time; shown to the user. → needs an auth + storage layer (see docs/specs/accounts.md).
- [ ] **Admin panel (6):** overall stats, user management, and a **trip-replay player** (variable speed) over
      recorded trip logs. → needs trip logging + admin UI (see docs/specs/admin.md).
- [x] **Schematic backdrop:** buildings + parks/water from OSM — DONE & LIVE (Vinohrady: 1621 buildings,
      185 green, 4 water). Baked as tiled area polygons, rendered behind roads with building outlines.
      (Still TODO from here: off-road building collision + house numbers.)

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
- 2026-06-14: **control + camera rework SHIPPED & verified** (msgs 2663–2668) — see the DONE checklist above.
  Notified Vlad (TG) with a live screenshot. Per-spec dynamic zoom + wheel zoom + heading-up + on-road labels +
  cruise (no decay) + gentle accel + rotate-in-place. Also fixed the static-asset cache so deploys go live at once.
- 2026-06-14: **schematic city backdrop SHIPPED & verified** — bake fetches OSM buildings/greens/water as tiled
  area polygons; client draws them behind the roads with brightened building outlines. Browser-verified at the
  Mánesova × náměstí Jiřího z Poděbrad junction (recognisable square, courtyards, cross-street markings). Notified
  Vlad (TG) with a screenshot. **Next candidates: house numbers on buildings; off-road building collision; then
  accounts+stats (5) and admin+trip-replay (6) as their own modules. Hold all-Prague expansion until Vlad OKs this slice.**
