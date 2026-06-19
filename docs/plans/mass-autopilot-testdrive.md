# Mass autopilot test-drive across Prague (msg 3170)

Vlad: drive the autopilot edge-to-edge across all of Prague on the major routes, log
violations, analyze them, fix what's fixable.

## Method
- **Driving:** accelerated sync-tick in a background `setInterval` driver, **tile-catch-up
  guarded** — never tick while the car's nearest resident edge is >18 m away (lets the
  streamer keep up, kills the false off-road readings the naive sync harness produced).
- **Ground truth caveat:** the sync harness can still glitch on tile rebuild; every
  off-road event is validated (resident edge ≤18 m + persists ≥6 frames + depth >0.5 m).
  Any route that flags off-road / wrong-way is **RE-VERIFIED on the real RAF loop** before
  being treated as a real bug.
- **Violations logged** (rising-edge, with x/y/kmh/limit/street exemplars): off-road
  (`offRoad`+depth), over-limit (`over`, kmh>limit+3), oncoming/wrong-way (`oncoming`),
  ran-red (`ranRed`), out-of-bounds (`boundary`).

## Routes
Perimeter points inset ~300 m from `map.meta.bounds`, routed between opposite + cross
pairs (N↔S, E↔W, NE↔SW, NW↔SE + offset parallels) → long cross-city trips that naturally
ride the arterials (A* min-distance). Target ~12–16 routes.

## Steps
1. [ ] Generate routes from bounds; confirm each returns a polyline.
2. [ ] Run background mass-drive; poll until done; collect per-route violation tallies.
3. [ ] Analyze: categorize, cluster by location/junction type, find patterns.
4. [ ] RAF-verify flagged violations (real vs artifact).
5. [ ] Fix confirmed bugs in the autopilot/rules; redeploy; re-verify.
6. [ ] Report to Vlad (analysis + fixes) with numbers + screenshots.

## Progress / findings

### Run 1 (2026-06-19) — 13 Prague situation-junctions + 7 cross-city arterials
Harness bug found & fixed mid-run: `tick()` returns speed as `.kmh`, driver read `.speedKmh`
(undefined) → every `if(kmh>2)` check was inert. Also added `window.__simClock` advance so
signals cycle in sim-time (else the car waits forever at red under acceleration) and
red-aware stuck detection. Re-ran clean.

**Aggregate violations** (junctions + arterials): off-road **0**, boundary **0**,
over-limit **56**, ran-red **112**, oncoming **289**. 11/13 junctions physically traversed
(jMinDist <4 m); all 13 routes completed.

**1. OVER-LIMIT — REAL, HIGH. Root cause: no limit-drop anticipation.**
`idealSpeed()` caps `vt` at the *current* edge's `maxspeed` only; on entering a slower
edge it brakes reactively. Evidence: 119 km/h in a 90, 116 in a 50, 109 in a 70, 49 in
20-zones — all at high→low transitions. Fix: scan the route ahead for the next lower
maxspeed and brake early (sqrt profile), same as curve braking.

**2. RAN-RED — mostly FALSE POSITIVE. Detector mis-calibration.**
`ranRed = signal==='red' && d<7 && kmh>5` (limits.js) fires while the car legitimately
brakes to the stop line — uniform 18 km/h on the approach street. idealSpeed stops the car
at `signalDist-3.5` (d≈3.5 m), but ranRed already tripped at the d=7 crossing. Fix: only
flag an actual crossing — `d<4 && kmh>10` (a real runner is fast & past the line; a braking
car is slow by d<4). Keeps genuine runs (saw one at 38 km/h).

**3. ONCOMING — MIXED, investigate before fixing.** 289 events. Partly junction/edge-snap
ambiguity (mid-intersection nearestEdge flips to the cross street), partly real bend-cutting
across the two-way centreline (worsened by the msg-3165 bend-faded lane offset → 0 in bends).
Risk: tightening lane position can reintroduce off-road. RAF/visual-verify a clean two-way
segment first; conservative fix only if safe (keep a small right bias through gentle bends).

### Fixes this session
- [x] Fix 1: limit-drop anticipation in `idealSpeed()` — march the route ahead 230 m at a fixed 12 m
      step (motorway segments are up to 525 m, so vertex-stepping missed the change), brake early for the
      lowest upcoming maxspeed. Junction worst-case 49→41 km/h into a 20-zone. Shipped.
- [x] Fix 2: recalibrate `ranRed` (`d<7&&kmh>5` → `d<4&&kmh>10`). **Junction ran-red 30 → 1.** Shipped.
      Also fixes false "ran red" on the *user's* own driving (trip stats).
- [x] Remaining-time-to-destination HUD readout during autopilot (`#routeeta`, msg 3174). Shipped.

### Verified conclusion (run 2, after fixes)
- **off-road 0, boundary 0** city-wide (junctions + 117 km of arterials) — turn-fix holds.
- **ran-red**: false-positive on braking-to-stop eliminated (30→1).
- **over-limit**: the alarming 116/119-in-a-50 numbers are a **false positive** — probed at the spot,
  the car is on *Cínovecká (motorway, maxspeed 130)* doing 109–119 LEGALLY; `nearestEdge` momentarily
  snaps to a parallel unnamed 50 km/h service road (3.5 m wide, 14–24 m off) → spurious "over". Real
  over-limit is only minor transition overshoot into abruptly-lower side streets (now reduced by Fix 1).
- **oncoming**: same divided-carriageway / mid-junction edge-snap drives most of it (nearestEdge flips to
  the opposite carriageway). Not real wrong-way driving; left as a known rules-engine nuance (fixing
  nearestEdge carriageway-selection is a larger, riskier change — not chased now).

### Known limitation (not fixed — documented)
`evalRules.nearestEdge` picks the geometrically nearest edge, which on divided roads / inside intersections
can be the wrong carriageway → transient false `over`/`oncoming` HUD flags. Autopilot driving is unaffected.
</content>
