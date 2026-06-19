// Deterministic traffic-signal phase model (msg 3151 — working traffic lights).
//
// A signals-controlled junction runs a fixed-length cycle. Its incoming approaches are split into TWO
// groups by bearing — the E-W axis (group 0) and the N-S axis (group 1), so opposite approaches share a
// group and the two groups are half a cycle out of phase: when one axis is green the cross axis is red.
//
// The phase is a PURE function of wall-clock seconds + a per-junction offset (a stable hash of the junction
// coordinates) → reproducible, no stored state, and every signal across the city is independently phased.
// Real OSM has no signal timing/grouping, so this 2-phase cycle is SYNTHESIZED (plausible, not the real plan).

export const CYCLE = 46;          // s — full cycle length
const AMBER = 3;                  // s — amber duration at the end of each green
const HALF = CYCLE / 2;           // each group: green for (HALF − AMBER), then amber AMBER, then red for HALF

// Group of an approach from its unit tangent (pointing away from the junction, into the road):
// E-W (|tx| ≥ |ty|) = 0, N-S = 1. Same rule used in the bake (Python) so heads/stop-bars/enforcement agree.
export function grpOf(tx, ty) {
  return Math.abs(tx) >= Math.abs(ty) ? 0 : 1;
}

// Seconds clock. Monotonic since page load; overridable via window.__simClock for deterministic tests.
export function signalClock() {
  if (typeof window !== "undefined" && window.__simClock != null) return window.__simClock;
  return (typeof performance !== "undefined" ? performance.now() : 0) / 1000;
}

function hash01(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);                          // 0..1, stable per coordinate pair
}

// → "green" | "amber" | "red" for a junction at (jx,jy), approach group grp, at time t (s).
export function signalState(jx, jy, grp, t = signalClock()) {
  const off = hash01(jx, jy) * CYCLE;
  const lt = (((t + off + (grp ? HALF : 0)) % CYCLE) + CYCLE) % CYCLE;
  if (lt < HALF - AMBER) return "green";
  if (lt < HALF) return "amber";
  return "red";
}
