# Intersection seam fix (2026-06-20)

Diagnosis (tools/test_intersections.py): centerline topology is clean (0/73,739 misaligned). Visual
gaps/overshoots come from the junction-fill RENDERING in `app/static/drive/render/draw.js`:
- `junctionHulls` fills each junction's **convex hull** → bulges past concave (T/cross/skewed) junctions
  = OVERSHOOT ("выскакивает за край").
- Coverage gated to deg>=3 in map.junctions, zoom>=8, radius<=20m → uncovered/under-reached spots show
  the dark casing splay = GAP ("чуть не достаёт").
Plus 26 "unnoded-T" data defects (road ends on another road, no shared node).

## Tasks
- [x] 1. Rendering: replaced convex-hull fill with **union-of-arm-quads + centre disc** (each incident
      road = a quad of its own width from ~rad m back to centerPad past centre; disc r=widest-half seals
      the middle). Cannot bulge past roads; closes splay. Kept `core` polygon for sign-culling.
- [x] 2. Verified visually (junction j_x4_b/c no regression; isolated crossings before/after). Topology
      test unchanged (rendering-only; graph.json untouched → still 0 misaligned).
- [x] 2b. (msg 3022/3024 follow-ups) Zebra crossings: were transverse bars (overshooting width, reading
      "along the road" on narrow streets). Rewrote `drawCrossings` to the CZ V7 zebra — stripes PARALLEL
      to the road axis, tiled kerb-to-kerb, no overhang.
- [x] 2c. Route search: `hud/search.js` now folds diacritics + case (NFD strip U+0300–U+036F) on both the
      index key and the query → "vaclavske namesti" finds "Václavské náměstí".
- [x] 3. Deploy to Castle.
- [ ] 4. Bake: split through-roads at the 26 unnoded-T nodes (routing + fill). Assess rebake cost; may
      be a follow-up.

## Notes / progress
