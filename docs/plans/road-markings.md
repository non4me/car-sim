# Proper road markings at junctions & complex interchanges (msg 2997)

## Vlad's ask
"знаки ты поправил но важно на перекрёстках и особенно сложных развязок добавить правильную дорожную
разметку" (+ screenshot of the Plzeň Studentská interchange). Signs are now placed correctly (msg 2980),
but the **carriageway markings are missing**: the junction interiors and approaches are a bare grey blob.

## What exists today (`render/draw.js`)
- Asphalt in 3 level-layers; a single **dashed yellow centre line** on two-way roads (width ≥ 5.5);
  one-way flow chevrons (zoom ≥ 7); **stop bars** at every non-priority junction approach (zoom ≥ 9);
  zebra crossings (zoom ≥ 8); billboarded signs.
- Missing: **lane-divider lines**, **edge (kerb) lines**, **give-way markings** (shark teeth) distinct
  from stop bars, **per-lane turn arrows**, channelization on complex interchanges.

## What the bake gives us (`tools/bake_city.py`, per edge)
`cls, name, oneway, lanes` (int count), `width` (= lanes × lane_width), `maxspeed`, `geom`, `a`, `b`,
optional `lv`. Junctions: `{x, y, ctrl, deg}` where `ctrl ∈ signals|stop|give_way|priority`.
**Not baked:** `turn:lanes` / `lanes:forward|backward` → per-lane turn designations need a bake change.

## Phasing

### Phase 1 — lane/edge lines + control-correct approach markings (NO re-bake) ✅ ship first
All in `render/draw.js`, world-space offsets (rotate with the heading-up camera), gated by zoom + class.
1. **Lane markings per drivable edge** (zoom ≥ ~10), drawn on the geometry **trimmed ~5 m from each end**
   so markings stop before the junction box (realistic; keeps the intersection interior clean):
   - **Edge lines**: solid, faint white at ±width/2.
   - **Lane dividers**: dashed white at each interior lane boundary. Two-way → split lanes evenly per
     direction (lanes:forward/backward not in data → assume N/2 each); the centre boundary (dividing
     opposing flows) is the **centre line**; off-centre boundaries are dashed lane dividers. One-way →
     all interior boundaries are dashed dividers, no centre line.
   - Narrow roads (1 lane/dir, width < ~5.5 m): centre line (two-way) + faint edge lines only.
   - Helper: `offsetGeom(geom, off)` (per-vertex averaged normal) + `trimGeom(geom, margin)`.
2. **Approach markings by control type** (supersede the uniform stop bar in `drawStopLines`):
   - `stop` / `signals` → solid white **stop bar** (as today).
   - `give_way` → **shark-teeth** give-way line (row of white triangles pointing at the driver).
   - derived `priority` junctions: draw shark teeth on the **minor** approaches only (incident edge whose
     `cls` ranks below the max incident class) — matches the ▽ give-way signs already placed there; the
     priority (main) approaches get nothing. (Today priority junctions get no marking at all.)
   - CZ markings are **white** (current centre line is yellow/US-style → switch lane markings to white).

### Phase 2 — per-lane turn arrows + squares (ONE re-bake) 
- Bake: capture `turn:lanes` (+ `:forward`/`:backward`) and `lanes:forward|backward` per edge.
- Render: draw real **per-lane turn arrows** (←/↑/→/combos) in the approach lanes near each junction.
- Bundle the still-pending **squares (`place=square`)** label addition (from msg 2983) into the same
  re-bake of the 4 cities, then deploy.

## Verify
- Plzeň Studentská interchange (the screenshot): approaches show lane lines + give-way shark teeth where
  the ▽ signs are; the through (priority) road reads clearly; markings stop before the junction box.
- A normal multi-lane two-way street: centre line + dashed lane dividers + edge lines, markings clean.

## Status
- [x] Phase 1 — lane/edge lines + control-correct approach markings (no re-bake) — DONE 2026-06-17:
      `drawLaneMarkings()` (edge lines + dashed lane dividers + white centre line on trimmed geometry,
      `offsetGeom`/`trimGeom` helpers, zoom≥10, service/living_street + <3 m skipped) replaces the old
      yellow centre line; `drawApproachMarkings()` replaces `drawStopLines` — stop bar for stop/signals,
      give-way **shark teeth** for give_way AND the minor (lower-class) approaches of derived-priority
      junctions (matches the ▽ signs). White (CZ). Verified on prod: Plzeň Studentská interchange (teeth
      on yielding approaches, junction interior clean, marks stop before the box) + Jateční arterial
      (edge + lane dividers + centre line). No console errors. (Render-only, no re-bake.)
- [x] Phase 2 — turn:lanes capture + per-lane arrows + place=square (one re-bake) — DONE 2026-06-17:
      bake now captures `tl`/`tlb` (turn:lanes forward/backward) + `lf`/`lb` (lanes:forward/backward) per
      edge (free — the way tags were already preserved by read_pbf), and `label_for` emits `place=square`
      as a `square` label (⛲, already in ICON_GLYPH). `drawTurnArrows()`/`drawLaneArrow()` render per-lane
      arrows on the approaching direction a few m before the junction (zoom≥12, billboarded). Re-baked all
      4 cities + re-ran the 3 search.json patch tools (admin/road_refs/landmarks counts identical to before
      → no minimap regression). Verified on prod: Plzeň turn-lane approach shows left/right arrows; squares
      (Husovo náměstí …) render with ⛲. turn:lanes coverage is sparse (~3% of edges) but real, esp. on ramps.
      Closes the pending msg 2983 squares item.

## Refinements (msg 3007/3008/3009 — same Studentská interchange, render-only)
- **3007 street names off the junction:** `drawStreetLabels` rewritten — ONE label per street NAME (was
  one per edge-end → a complex interchange = one street split into dozens of "Studentská" connector edges
  that swarmed the junction). Keep the nearest candidate per name, on a real approach edge (len ≥ 20 m, so
  the short connectors inside the junction box are skipped), placed ≥10 m INTO the street from the node.
- **3008 remove give-way shark teeth:** they cluttered complex junctions → removed entirely; only stop/signal
  approaches get a solid stop bar now. The ▽ give-way sign still marks give-way junctions. (`drawSharkTeeth`,
  `CLASS_RANK`/`classRank` deleted.)
- **3009 multi-level visibility:** strengthened the bridge/tunnel surface cues so "which is higher/lower"
  reads — bridges: wider dark drop-shadow (pad 11) + clearly lighter deck (#475164) + bright **parapet edge
  lines** (railings); tunnels: dimmer (#1d222c) + dashed; bridges/tunnels sorted by `lv` so higher decks paint
  last. Verified: most U Jána reads as an elevated bridge over the river; interchange decks read above the
  ground roads.

## Road-number shields (msg 3015 + 3017 declutter)
- **3015:** bake captures per-edge `ref` + `int_ref` (free — way tags already preserved). `draw.js`
  `drawRoadRefs()`/`drawRefBadge()`/`refStyle()` draw CZ-coloured shields: red dálnice (D), blue I. třída
  (trunk/primary), yellow II/III (secondary/tertiary), green E-routes (stacked under the national ref).
  Re-baked all 4 cities (3rd re-bake; admin/road_refs/landmark counts still unchanged).
- **3017 declutter (before commit):** first cut put a shield at EVERY edge midpoint → a swarm across the
  interchange (same anti-pattern as the names). Fixed to Google-style: skip short connector edges
  (len < 45 m, so shields stay OFF the junction box), place at a long edge's midpoint, process longest-first,
  and keep same-`ref` shields ≥ 150 m apart. Verified: junction interior clean, one neat blue "20" per road.
