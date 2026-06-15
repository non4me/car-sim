# Railways, stations, landmarks + rich per-street info (msg 2771)

Vlad: add railway tracks + stations (named), major city landmarks (figure out how to
pick them) with labels, and for the street you're driving show max info — house numbers,
POIs (pharmacy, ATM, restaurant, …), everything known.

Two phases (each: bake capture → tile arrays → render → deploy → browser-verify → report).

## Phase 1 — railways + stations + landmarks  ← THIS COMMIT
- bake: capture `railway=rail/light_rail/narrow_gauge/tram` ways (skip subway/tunnel underground)
  → `rails[]` (geom, kind). Capture named LABELS: `railway=station/halt` (kind=station) + major
  landmarks via a curated tag set with a name — museum/gallery, attraction/zoo, castle/palace,
  monument/memorial, theatre, university, hospital, townhall, stadium, aerodrome, and
  place_of_worship ONLY when it carries wikidata/wikipedia (notability gate). From nodes AND
  building/way centroids. → `labels[]` (x,y,kind,name).
- tiles: new `rails`, `labels` arrays (streamed like edges/signs; old tiles default []).
- render: rail lines (gray + dashed overlay = track symbol; tram thinner) under roads; label
  markers (dot by category) + name, shown zoom ≥ 3 so they aid orientation in overview too.

## Phase 2 — per-street POIs + house numbers  ← NEXT COMMIT
- bake: `pois[]` (amenity pharmacy/atm/bank/restaurant/cafe/fast_food/fuel/police/…, shop
  supermarket/convenience/bakery) {x,y,kind,name?}; `addrs[]` house numbers from addr:housenumber
  nodes + building centroids {x,y,n}.
- render: zoom-gated + near-car only — POI icons+labels at zoom ≥ ~13, house numbers at zoom ≥ ~15,
  so the street you're on shows its full detail without flooding the whole map.

## Notes
- Determining "major objects": named + curated significant tag, with a wikidata/wikipedia gate on
  the noisy class (churches). This is the "понять сам как определять" heuristic.
- Data volume: rails few-k ways; labels few-hundred; pois ~40k; addrs ~250k (building centroids).
  addrs grow tiles most → render only very zoomed-in. Re-bake per phase (~30–40 s).
