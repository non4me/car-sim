# car-sim — overall architecture

**car-sim.troyanenko.com** — a driving-education web app scoped to a chosen *country → city*.
The flagship is a **free-roam, real-map 2D top-down driving simulator**; supporting it are a
**Quizzes** section and an **Official-Documents** section. Adding a new country/city is a
**defined, repeatable procedure** (runbook + AI prompt + validation), because every place has its
own rules (right-/left-hand traffic, default limits, sign set, local specifics).

> Status: living document. Each module is taken independently through
> research → analysis → spec → planning → implementation, but all share this structure.
> First milestone: **one Prague district**, end-to-end, before any expansion.

## 1. Sections (each on its own `/url`)

| Route | Section | Role | Source of content |
|---|---|---|---|
| `/` | **Intro** | Pick country → city → UI language; entry to sections | config |
| `/drive` | **Real-map simulator** (PRIMARY) | Free-roam driving on real streets, real limits/signs, violation warnings | baked OSM map + rules profile |
| `/quiz` | **Quizzes** (secondary) hub | Index of the four trainers below | — |
| `/quiz/photo` | · Photo quiz | Identify rules/signs on real street photos | Panoramax photo banks (built) |
| `/quiz/situations` | · Situation simulator | Curated junction scenarios, freeze-and-explain | scenario sim (built) |
| `/quiz/signs` | · Sign trainer + quiz | Learn & test the country's sign catalog | sign catalog |
| `/quiz/rules` | · Rules flashcards + quiz | Memorise the rules of the road | rules dataset |
| `/docs` | **Official documents** (secondary) | Laws/regulations + search + freshness tracking; outdated → archive (marked) | docs index |

The intro selection (country, city, language) is persisted (cookie) and scopes every section:
the sim loads that city's map, the quizzes load that city/country's banks, docs load that
country's legal corpus.

## 2. Module structure (monorepo)

```
car-sim/
  app/                       FastAPI unified backend (one deploy, one domain)
    main.py                  app factory + router mounting + intro
    sections/
      drive.py               serves the sim shell + map-tile/meta endpoints
      quiz/ photo.py situations.py signs.py rules.py
      docs.py                doc list + search + freshness/archive
    templates/               shared base.html (header: country/city/language) + per-section
    static/
      drive/                 the real-map sim CLIENT (ES-module canvas app)
        engine/  render/  vehicle/  map/  hud/  rules/
      quiz/  signs/  rules/  common/
  countries/
    cz.yaml                  rules profile: side=right, default limits, priority model, sign set, legal sources
  data/
    cities/cz/praha/
      map/                   baked tiled map artifacts (graph + control + geometry)
      meta.json              bbox, districts, version, attribution
    quiz/  (photo banks, sign catalog, rules dataset)
    docs/cz/                 legal corpus + index + archive
  tools/
    bake_city.py             OSM extract → normalized tiled map artifact (the core pipeline)
    add_city.py              onboarding orchestrator (uses a country rules profile)
    photo_pipeline/          Panoramax sample/reproject/gen/verify (built, ported)
  docs/                      research / architecture / specs / plans / procedures (the trail)
```

## 3. The real-map simulator (primary module) — architecture sketch

Two halves: an **offline bake** and a **runtime client**.

**Offline bake (`tools/bake_city.py`)** — turns a city's OSM data into a runtime-ready artifact:
- Input: OSM extract (Geofabrik `.osm.pbf` or Overpass) for a bbox + the country rules profile.
- Build a **road graph**: junction nodes; edges = drivable ways split at junctions, carrying
  lane-centre polyline geometry + resolved attributes `{class, maxspeed (explicit or CZ default),
  oneway, lanes, name}`.
- Attach **junction control**: traffic_signals / stop / give_way from OSM where present; otherwise
  **derive priority** from road-class hierarchy + default *přednost zprava* (the OSM sign gap, see research).
- Attach **crossings** and infer simple **markings** (centreline, lane arrows) from tags.
- Serialize to **compact tiles** (grid by ~250–500 m) the browser streams by viewport, + a `meta.json`.

**Runtime client (`static/drive/`)** — a self-contained ES-module canvas app:
- `map/` streams + caches tiles for the viewport; resolves "which edge am I on".
- `vehicle/` kinematic car (automatic-transmission feel): ↑/↓ = gas/reverse, ←/→ = steer,
  **space = hard brake**; free continuous motion, softly constrained to the drivable surface.
- `render/` top-down camera follows the car; draws roads/markings/signs/signals; buildings &
  landscape schematic; renderer behind an interface (Canvas 2D MVP → WebGL/Pixi if scale needs).
- `rules/` real-time: locate car → current segment → **speed limit** → speedometer + over-limit
  warning; signal/priority/violation cues.
- Map-edge → brake the car + "no road here, turn around" warning.

Hard/novel problems (free-roam-on-graph, vehicle feel, sign/priority derivation, tiling & perf)
are resolved in the **sim spec** via a dedicated research/design pass — not assumed here.

## 4. Adding a country / city — defined procedure

Deliverables (`docs/procedures/add-city.md` + `tools/add_city.py` + a prompt template):
1. **Country rules profile** (`countries/<cc>.yaml`): driving side (R/L), default speed limits
   (urban/rural/expressway/motorway), priority model, sign catalogue + legal sources. (Once per country.)
2. **City bake**: choose bbox/extract → `bake_city.py` → validate (graph connectivity, limit
   coverage, junction sanity) → publish `data/cities/<cc>/<city>/`.
3. **Quiz banks** (optional per city): photo pipeline + sign/rules from the country profile.
4. **Validation checklist** before a city goes live (sources cited, geometry spot-checked, rules correct).
The **AI-prompt** form encodes the same: sources → ordered steps → validation gates, so the process
is reproducible by a human or an assistant.

## 5. Tech & cross-cutting

- **Backend**: FastAPI + Jinja2 + HTMX + Tailwind (reuse the quiz stack). Sim & quizzes are
  client islands; pages are server-rendered. No DB initially (static artifacts + in-memory state).
- **i18n**: the existing 10-language system (per-key English fallback, real SVG flags) is promoted
  app-wide; UI language is independent of country/city.
- **Deploy**: one Docker container behind Traefik + Cloudflare at `car-sim.troyanenko.com`
  (same overlay pattern as the existing sites).
- **Repo**: `github.com/non4me/car-sim`, public, updated regularly; commits authored by the owner.
- **Data licensing**: OSM © OpenStreetMap (ODbL); photos Panoramax (CC-BY-SA); legal texts public.

## 6. Build order (incremental, approval-gated)

0. Repo + this architecture + sim research/spec/plan committed. ← *now*
1. **Prague district vertical slice**: bake one district → render it → drive it (vehicle + camera
   + speed limits + boundary). Get Vlad's OK.
2. Expand sim coverage (more districts → all Prague) once the slice is approved.
3. Fold in Quizzes (port photo-quiz + scenario-sim; add signs + rules trainers).
4. Official-Documents section (corpus + search + freshness/archive).
5. Generalise the add-country/city procedure; prove it on a second city.

Existing `ulice` (photo quiz) and `ulice-sim` (scenario sim) keep running until their content is
ported into `/quiz/*`; nothing is discarded.
