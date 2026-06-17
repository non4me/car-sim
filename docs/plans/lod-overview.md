# Whole-city LOD overview (zoom-out to see all of Prague)

Vlad asked (msg 2730/2732/2741) to navigate a "реально огромная" map and zoom out to the
whole city. Streaming is done + proven (100 km/h keeps up). What's missing: a usable
zoomed-OUT view of the entire city.

## Why naive zoom-out doesn't work
Resident tiles are capped at MAX_RESIDENT=80 and detail tiles are 400 m. At far zoom the
view spans tens of km but only ~80 tiles load (clustered at the camera) → you see a tiny
slice, not the city. So far-zoom needs its own low-detail artifact, not the detail tiles.

## Approach (MVP — to confirm direction with Vlad before building)
A separate lightweight **arterial skeleton**, switched in below a zoom threshold:
- Bake `overview.json`: filter edges to motorway/trunk/primary/secondary, simplify geometry
  hard (~50 m tolerance), one small file (target < 1 MB), NOT tiled — covers the whole city.
- Client: load it lazily on first deep zoom-out; below `OVERVIEW_LOD_Z` (~1.5 px/m) draw the
  skeleton + the car position marker instead of the detail tiles; lower ZMIN so you can pull
  all the way out to the whole city.
- Detail streaming continues unchanged above the threshold (no regression to the verified sim).

## Design fork to settle first
1. Separate overview file (above) — simplest, MVP. **Recommended.**
2. Full multi-resolution tile pyramid (z0..zN, like web maps) — proper, larger build.
Vlad was actively designing this (density-table idea, msg 2741) — get his steer on 1 vs 2 and
how much to show (arterials only? labels? districts?) before reworking zoom semantics.

## Risk
Touches ZMIN + the existing `view.zoom < OVERVIEW_Z` off-road-wall/overview-arrow logic that
the verified sim relies on. One change at a time; re-verify driving + streaming after.
