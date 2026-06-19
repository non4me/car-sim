# Plan — ideal-driver autopilot + route ETA (msg 3161)

Vlad: autopilot should drive like an ideal driver — obey ALL rules, hold the MAX allowed speed, stay in the
correct (right, RHT) lane so it enters turns from the right lane. And the route calc should also compute the
travel time at max allowed speed obeying the rules. (The off-road car in the sign/light screenshots was just
manual framing, not the autopilot.)

## Part A — route ETA (bake + server + UI)
- Bake (`bake_city.py`): graph rows gain per-edge maxspeed → `[a,b,ow,geom,ms]`. Re-bake all 4 cities
  (graph.json is a bake output).
- `routing.py`: parse optional 5th element; store edge speed; accumulate travel time over the chosen
  (shortest-distance) route → return `time_s` (fallback 50 km/h where ms missing). Cost stays distance.
- `main.py /route`: returns the dict as-is (time_s flows through).
- `main.js` route panel: show `trasa X.XX km · ≈N min`.

## Part B — ideal-driver autopilot (main.js, the `following` branch)
Currently auto-STEERS only; throttle/brake are the user's. Make it FULLY autonomous:
- **Longitudinal planner** `targetSpeed()`: vTarget = min of
  - posted limit (rules.limit km/h, default 50),
  - curve limit: scan the route ahead (~60 m); at each vertex estimate the corner radius (circumradius of 3
    consecutive points) → vCurve = sqrt(A_LAT·R); apply a braking profile sqrt(vCurve² + 2·A_BRK·d) so it
    slows EARLY for the bend,
  - red/amber signal: brake to 0 at the stop line (rules.signal/ signalDist),
  - stop sign ahead: brake to ~0 at the line, latch so it proceeds after stopping,
  - destination: brake to 0 at the end.
  Controller: throttle if v < vTarget−0.5, brake if v > vTarget+0.3, hard-brake if v ≫ vTarget; deadband
  holds speed (car has no auto-decel). A_LAT≈3.0, A_BRK≈3.0 (comfortable), never exceed limit.
- **Lane discipline**: offset the pure-pursuit look-ahead target to the RIGHT of the route direction by
  ~min(2.0, width/4) on two-way roads (RHT right lane); one-way stays near centre. So it tracks the right
  lane and enters turns from it. (Multi-lane left-turn positioning = future.)

## Verify
- ETA: /route returns time_s; panel shows minutes; sanity vs length/limit.
- Autopilot: headless `window.__drive` — set a route, follow, confirm: holds ~limit on straights, slows for a
  sharp bend, stops at a red light, sits in the right lane (lateral offset > 0 to the right), stops at the end.
  Screenshot the car self-driving in the right lane. Re-bake 4 cities, deploy, browser-verify, report.
