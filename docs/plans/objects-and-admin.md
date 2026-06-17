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
- [ ] Phase 1 surfaces + bridge/tunnel names
- [ ] Phase 2 standard/custom object icons + squares
- [ ] Phase 3 admin object editor (DB + API + UI + upload)
