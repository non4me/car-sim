# Real-map Prague driving simulator — OSM data feasibility (research notes)

Grounded probe of OpenStreetMap via the Overpass API, central-Prague bbox
`50.0790,14.4130 → 50.0900,14.4300` (~1.2 × 1.0 km, Staré Město / Nové Město).
Purpose: verify that req-5 (free-roam driving on REAL Prague streets with real
geometry, speed limits, signs, markings) is buildable from real map data.

## What OSM gives us (measured)

| Data | Coverage in the test bbox | Verdict for the sim |
|---|---|---|
| Road **geometry** (polylines) | 2448 highway ways, **100 % have geometry** | ✅ accurate street geometry is free |
| **Drivable** subset | residential 338, living_street 59, service 150 (+ primary/secondary/tertiary elsewhere); footway/steps/pedestrian excluded | ✅ filter by `highway` class |
| **one-way** | 366 ways tagged | ✅ essential for realistic Prague centre |
| **lanes** | 281 ways tagged | ◑ partial; default by road class |
| **maxspeed** | 351 ways explicit; values 50 / 20 / 30 / `CZ:pedestrian_zone` | ◑ partial → fill with CZ statutory defaults |
| **traffic_signals** (lights) | 9 nodes | ✅ mapped |
| pedestrian **crossing** | 284 nodes | ✅ well mapped (markings/zebra) |
| **give_way** / **stop** signs | 19 / 4 nodes | ⚠️ sparse — most junctions untagged |
| general **traffic_sign** nodes | 4 | ⚠️ very sparse — cannot rely on OSM for signs |
| roundabouts | 4 | ✅ |
| Render scale | ~11 085 polyline points / km² | ✅ trivial for 2D + viewport culling |

## Conclusions

1. **Geometry & network: solid.** Real Prague streets, one-ways, and the drivable graph
   come straight from OSM. "Сгенерированный по реальным картам" is the right framing — this
   is real-map, not procedural. Viewport-culled 2D rendering of all Prague is tractable.
2. **Speed limits: derivable per segment.** Explicit `maxspeed` where present; otherwise CZ
   statutory defaults — obec 50, obytná zóna/zóna 30 where tagged, pedestrian zones, motorway/
   express elsewhere. So req-5 "предупреждения о превышении по конкретному участку" is feasible.
3. **Signals & crossings: usable from OSM.** Traffic lights and zebra crossings are mapped.
4. **Priority signs are the gap.** give-way/stop/general signs are sparsely mapped. Strategy:
   derive right-of-way at untagged junctions from road-class hierarchy (main road vs side road)
   + default *přednost zprava* (§22); use OSM's explicit give_way/stop/signals where present;
   optionally enrich later from a signs dataset. Markings (V-series) likewise inferred from
   lane/oneway/crossing tags rather than expected as explicit OSM features.

## Implications for architecture (to fold into the spec once scope is confirmed)

- **Offline bake step**: pull a Prague OSM extract (Overpass / Geofabrik `.osm.pbf`), build a
  routing-grade graph (nodes=junctions, edges=lane-centre polylines) + per-edge {class, maxspeed
  resolved, oneway, lanes, name} + junction control {signals/stop/give_way/derived-priority} +
  crossings. Serialize to a compact tiled JSON/binary the browser streams by viewport.
- **Runtime**: top-down canvas/WebGL; vehicle = kinematic car constrained to the drivable graph
  but free to choose turns; ↑↓ gas, ←→ steer, space brake; speedometer + per-segment limit
  check; map-boundary → brake + "no road, turn around".
- **Open questions for the spec phase**: lane-level vs centreline driving; collision model vs
  road-boundary soft-constraint; how far to push sign fidelity; tile size & streaming budget.

## Sources probed
- Overpass API (`overpass-api.de`) live, 2026-06-14. Data © OpenStreetMap contributors (ODbL).
- Geofabrik Czech extracts (`download.geofabrik.de/europe/czech-republic.html`) — candidate bulk source (not yet pulled).

_Status: initial feasibility only. Deeper research (rendering libs, vehicle model, tiling,
sign-derivation rules) pending Vlad's answers on scope (centre-slice vs all-Prague) and
app/repo/domain structure._
