# Multi-city — plan & progress (Vlad msg 2931)

Goal (msg 2931): (a) remove the homepage "Start in: 🌍 All of Prague / Vinohrady (small sample)"
district selector — the **whole city is always selected**; (b) add the other cities from the original
plan (`realmap-sim-plan.md` Phase 6+: "generalise add-country/city procedure; prove a 2nd city";
spec: "scale to … other cities") + a homepage **city selector**, incrementally as cities are added.

The plan never named specific cities. Czech road rules (`countries/cz.yaml`) apply nationwide, so any
CZ city reuses the existing profile. Starting with the obvious order of CZ population:
**Brno → Ostrava → Plzeň → …** Brno first proves the pipeline + selector. Vlad can redirect.

## Enablers (already present — no downloads)
- `data/osm/czech-republic.osm.pbf` (892 MB) — local + on Castle. Any CZ city bakes from this.
- `osmium` CLI 1.19.1 (extract step) + `.venv` pyosmium 4.3.1 (bake step).
- `tools/bake_prague.py` (pbf → tiled artifact) is the template; reuses `bake_city.build_artifact`.

## Part (a) — remove district selector — DONE & LIVE
- [x] `intro.html`: removed the `.dist` block; the Jízda card always links `/drive` (defaults
      `district="prague"` = whole city). Jinja renders clean; selector strings now dead (harmless).
- [x] Deployed + browser-verified: homepage has 0 selector markup, `/drive` 200 (whole Prague).

## Part (b) — 2nd city + city selector — IN PROGRESS
Pipeline generalisation (keep Prague bake byte-identical):
- [ ] `bake_city.build_artifact(... , city="praha")` — meta `city` no longer hardcoded.
- [ ] `bake_prague.read_pbf(path, bbox=PRAGUE_BBOX)` + `read_water_areas(path, bbox=PRAGUE_BBOX)`
      — parametrise bbox (default = Prague, so Prague unchanged).
- [ ] `tools/bake_city_pbf.py` — generic CLI: `<pbf> --city <slug> --name <district> --bbox S,W,N,E
      --country cz`. Output `data/cities/<cc>/<city>/<name>/`.
- [ ] Bake Brno: `osmium extract -b W,S,E,N -s complete_ways czech-republic.osm.pbf -o brno.osm.pbf`
      then `bake_city_pbf.py brno.osm.pbf --city brno --name brno --bbox 49.108,16.428,49.295,16.728`.

App multi-city (keep Prague default):
- [ ] City registry (`app/cities.py` or const): `[{cc, slug, name, district, lat, lon}]`,
      filtered to what's baked on disk. Praha→prague, Brno→brno.
- [ ] `/drive?city=<slug>` resolves cc/city/district from the registry (Praha default, validated slug).
- [ ] `_district_dir` / `data_base` generalised to `<cc>/<city>/<district>`.
- [ ] Homepage: replace static "Praha" pick with a **city selector** (links `/drive?city=<slug>`),
      growing as cities are added.

Deploy + verify each city. NOTE: `data/cities` is COPY'd into the image (Dockerfile) — the deploy
rsync must INCLUDE the new city's tiles (exclude only `data/osm`) and run `--build` so the COPY picks
them up. A new city = one `osmium extract` + one `bake_city_pbf.py` + one `CITY_REGISTRY` line.

## Cities live
- [x] Praha (whole), Brno, Ostrava (25 574 edges), Plzeň (23 163 edges) — all baked + in CITY_REGISTRY.

## Remaining (incremental, by population)
- [ ] Liberec, Olomouc, then more — each: bake → registry line → deploy (rsync incl. tiles + --build).
- [ ] Polish: Jízda-card i18n hardcodes "Prahy" — make city-neutral when convenient.

## Status log
- 2026-06-17: msg 2931. Part (a) selector removed — shipped & live. Part (b) DONE & live: pipeline
  generalised (`build_artifact` city param, `read_pbf`/`read_water_areas` bbox params, `dedup_points`
  shared, new `bake_city_pbf.py`); Brno baked (2420 tiles, 38 534 edges); app made multi-city
  (`CITY_REGISTRY`, `_resolve_dir`/`_city`/`_available_cities`, `/drive?city=`, `/route?city=`,
  homepage MĚSTO selector); TestClient-validated; deployed & live-verified (Brno drives, limit 30).
