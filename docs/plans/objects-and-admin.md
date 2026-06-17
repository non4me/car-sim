# Surfaces, named bridges, object icons + admin object editor (msg 2983)

Builds on the level work (msg 2980): edges now carry `lv` (carriageway level).

## Vlad's asks
1. layer/bridge/tunnel must have **different surface rendering** (tell a bridge from a tunnel from ground).
2. Named/numbered bridges & tunnels → show the **name/number next to them**.
3. Same naming for main city objects, landmarks, **squares (náměstí)**, airports, rail/bus stations.
4. Objects carry an icon **at their location**: standard icons (stations, airport…) or custom (landmarks).
5. **Admin UI** to add objects manually: a standard-icon library + custom-icon upload (correct format),
   with name, description, geolocation → placed on the map.

## Current state
- Roads render with one uniform `ASPHALT` colour (no level styling). Edges now have `lv`.
- `labels[]` (stations/landmarks) + `pois[]` stream per tile; rendered as a coloured **dot + glyph char**
  (`POI_GLYPH`, `LABEL_COLOR`), not real icons. Bridge/tunnel ways have `name`/`ref` in OSM but the bake
  doesn't surface them as labels.
- Accounts/admin layer exists (`app/auth.py`, `app/admin*`, SQLite via `app/db.py`, named volume `carsim-data`).

## Phasing

### Phase 1 — bridge/tunnel surfaces + names  (render + small bake; continues msg 2980)
- **Surface:** in `draw.js` road pass, style by `e.lv`: bridges (`lv>0`) get a lighter deck + a cast
  shadow/side casing so they read as "above"; tunnels (`lv<0`) render dashed / dimmed / under a faint
  overlay so they read as "below". Ground unchanged.
- **Names:** bake captures bridge/tunnel ways' `name`/`ref` → a `structures[]` sidecar (or reuse `labels`)
  with a `bridge`/`tunnel` kind + a representative on-structure point; `draw.js` labels them (e.g. "Karlův
  most") distinctly from street names. (Most bridges are unnamed → only the named ones get a label.)

### Phase 2 — real object icons (render + icon assets)
- Replace the glyph-char markers with a small **standard SVG icon set** keyed by kind (station, airport,
  bus, hospital, museum, castle, theatre, stadium, university, square…). Pre-rasterised/inline SVG drawn at
  the object location, zoom-gated like today. Squares (`place=square`) added to the bake's label set.
- Landmarks without a standard icon fall back to a generic "point of interest" icon.

### Phase 3 — admin object editor (DB + admin UI + custom render)
- **DB:** `map_objects` table (id, city, name, description, lat/lon → world x/y, icon_kind | custom_icon_path,
  created_by, created_at). `app/db.py` migration.
- **API:** `POST/PUT/DELETE /admin/objects` (admin-only, reuse the role gate), `GET /api/objects?city=` for
  the client; custom-icon upload endpoint (validate: SVG/PNG, size cap, sanitise) → stored under the
  `carsim-data` volume, served read-only.
- **Admin UI:** form with the standard-icon library picker, custom-icon upload, name/description, and a
  geolocation picker (click on a mini-map or lat/lon entry) so placement is correct.
- **Render:** client fetches `/api/objects?city=` and draws them like Phase-2 icons (custom icon if set),
  with the de-overlap guard; names from the object record.

## Order / proposal
Start Phase 1 (visible, continues the level work, no backend). Then Phase 2 (icons). Then Phase 3 (admin CRUD
— the biggest piece: upload handling, storage, validation, UI). Confirm priority with Vlad; proceed on 1.

## Status
- [x] Phase 1 surfaces + bridge/tunnel names (commit 21ade02) — 3-level road render (tunnel below/dashed,
      bridge above/lighter-deck+shadow) + named-structure labels; no re-bake (uses 2980 `lv`/`name`).
- [x] Phase 2 standard object icons (commit 2e3cdd8) — emoji pictograms on a dark badge for landmarks + POIs.
      **Squares (place=square) still TODO** — needs a bake change + re-bake; bundle with Phase 3 or a later pass.
- [x] Phase 3 admin object editor (DB + API + UI + upload) — DONE 2026-06-17:
      - `app/db.py`: `map_objects` table (city,name,description,kind,icon,lat,lon,x,y,created_by,created_at)
        + index + list/get/create/delete helpers; `init_db()` adds it idempotently to the prod DB.
      - `app/main.py`: public `GET /api/objects?city=` (world coords); admin `POST /admin/objects`
        (multipart create) + `POST /admin/objects/{id}/delete` behind `_require_admin`; custom-icon upload
        validated by magic bytes (PNG/JPG/WebP/SVG, ≤256 kB), stored under the `carsim-data` volume at
        `/app/var/uploads`, served by `IconStatic` (CSP `script-src 'none'` + nosniff so an SVG can't run
        script); lat/lon projected to world metres with the city's baked `proj` (matches `make_proj`).
        `STD_ICONS` mirrors `ICON_GLYPH`.
      - `templates/admin.html`: "Objekty na mapě" section — add form (city select, name, description,
        23-icon standard-library picker OR custom upload, lat/lon) + a list with delete.
      - client: `main.js` fetches `/api/objects?city=` into `map.objects`; `draw.js` `drawObjects()` renders
        a custom uploaded image (lazy-loaded + cached) or a standard emoji icon + name, gated at zoom≥3.
      - verified on prod in-browser: created a standard (🚉) + a custom-PNG object via the real admin form
        (incl. file upload), both rendered at the correct geolocation on /drive (street "Wilsonova" at
        Hlavní nádraží confirms placement); delete removed the rows AND unlinked the uploaded file (→404).
      - NOTE still pending: **squares (place=square)** in the bake label set (needs a re-bake) — separate pass.
