# Plan — render ALL available road signs (msg 3149)

Vlad: the /drive map only shows derived главная/второстепенная (priority_road/give_way) + signal/stop. Add
ALL available OSM signs, incl. informational.

## Data reality (probed praha.osm.pbf)
- 347 `traffic_sign=*` nodes in Prague (full CZ pbf: 10894). Breakdown: 172 city_limit, 67 maxspeed,
  ~50 IZ (zone/town), ~14 B1/B2 (no-entry), scattered C (mandatory), IP/IS (info), few A (warning).
- These are STANDALONE roadside nodes (not junction vertices) → currently dropped entirely by the bake
  (read_pbf only keeps highway=control/crossing node tags).
- maxspeed already lives per-edge (over-limit detection); `traffic_sign=maxspeed[NN]` gives posted limit signs.

## Approach (faithful to existing system)
Capture the real OSM `traffic_sign` nodes, classify CZ codes → a small render-kind set, draw billboarded
glyphs like the existing signs. SKIP codes already covered by junction-control derivation (P2/P4/P6/
give_way/stop/priority) to avoid double-signs.

### Render kinds (new)
- `speed_limit` (value NN) — white roundel, red ring, black number (B20a / maxspeed[NN])
- `no_entry` — red disc + white bar (B1/B2/no_entry)
- `prohibitory` — white disc + red ring, generic (other B*)
- `mandatory` — blue disc + white up-arrow (C* / only_*)
- `info` — blue rounded square (IP/IS/IZ/city_limit + unmapped fallback so nothing available is dropped)
- `warning` — white up-triangle, red rim (A*)

## Changes
1. `bake_prague.py read_pbf` — also collect `{lat,lon,v:traffic_sign}` for nodes with a traffic_sign tag
   (in bbox); return as 7th list `sign_nodes`. Update both callers' unpack.
2. `bake_prague.py main` + `bake_city_pbf.py main` — pass `sign_nodes=` to build_artifact.
3. `bake_city.py build_artifact` — new `sign_nodes=None` param; `classify_traffic_sign(raw)->(kind,v)|None`;
   project lat/lon→xy, snap to nearest edge (≤30 m, else drop — keeps signs on roads), append
   `{x,y,kind,v?}` to `signs`; include `v` in the 12 m dedup key so different speed limits don't merge.
4. `draw.js` — `drawSign` dispatch + drawSpeedLimit/drawNoEntry/drawProhibitory/drawMandatory/drawInfoSign/
   drawWarning; pass `s.v`; add new kinds to RANK (speed_limit nearer the front, info last).

## Verify
- Re-bake all 4 cities via bake_city_pbf.py + re-run the 3 search.json patchers (re-bake resets search.json).
- Counts: print n_signs by kind. Expect Praha ~ +100-300 real signs (speed/no-entry/info).
- Browser (chrome-devtools): find a speed-limit + no-entry + info sign on prod, screenshot.
- Redeploy (rsync incl. data/cities, --build). Report + screenshots to Vlad.

## Secondary (msg 3151) — working traffic lights: assess feasibility separately, report cost, don't build yet.
