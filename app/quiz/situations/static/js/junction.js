// Build intersection geometry (metres) from a high-level scenario. Right-hand traffic.
// Everything here is view-independent; render.js maps to screen via world.js.
import { V, densify } from "./world.js";

const DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPP = { N: "S", S: "N", E: "W", W: "E" };
const LANE_W = 3.5;            // one lane
const ROAD_HALF = LANE_W;      // 2 lanes (one each way) → half-width = 3.5 m
const LANE_OFF = LANE_W / 2;   // lane centre offset from road centreline
const RAIL_OFF = 0.7;          // tram rail offset from centreline

function armForDir(d) {
  for (const k in DIR) if (Math.abs(DIR[k][0] - d[0]) < 1e-6 && Math.abs(DIR[k][1] - d[1]) < 1e-6) return k;
  return null;
}
export function rightArm(from) { const h = [-DIR[from][0], -DIR[from][1]]; return armForDir([-h[1], h[0]]); }
export function leftArm(from) { const h = [-DIR[from][0], -DIR[from][1]]; return armForDir([h[1], -h[0]]); }
export function targetArm(from, turn) {
  if (!turn || turn === "straight") return OPP[from];
  if (turn === "right") return rightArm(from);
  if (turn === "left") return leftArm(from);
  return turn; // explicit arm letter
}
export function turnOf(from, to) {
  if (to === OPP[from]) return "straight";
  if (to === rightArm(from)) return "right";
  if (to === leftArm(from)) return "left";
  return "straight";
}

function quad(p0, c, p1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
              u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
  return out;
}

export function buildJunction(scn) {
  const W = scn.world?.w ?? 80, H = scn.world?.h ?? 80;
  const C = [W / 2, H / 2];
  const arms = scn.arms ?? ["N", "E", "S", "W"];
  const R = ROAD_HALF + 0.5;        // junction "mouth" radius

  const edge = (arm) => {
    const d = DIR[arm]; let t = Infinity;
    if (d[0] > 0) t = Math.min(t, (W - C[0]) / d[0]);
    if (d[0] < 0) t = Math.min(t, (0 - C[0]) / d[0]);
    if (d[1] > 0) t = Math.min(t, (H - C[1]) / d[1]);
    if (d[1] < 0) t = Math.min(t, (0 - C[1]) / d[1]);
    return [C[0] + d[0] * t, C[1] + d[1] * t];
  };

  // a lane-centre path from arm `from` to arm `to`, through the junction
  function pathFor(from, to) {
    const hIn = [-DIR[from][0], -DIR[from][1]];
    const offIn = V.mul(V.right(hIn), LANE_OFF);
    const offOut = V.mul(V.right(DIR[to]), LANE_OFF);
    const entryEdge = V.add(edge(from), offIn);
    const entryMouth = V.add(V.add(C, V.mul(DIR[from], R)), offIn);
    const exitMouth = V.add(V.add(C, V.mul(DIR[to], R)), offOut);
    const exitEdge = V.add(edge(to), offOut);
    const curve = quad(entryMouth, C, exitMouth, 10);
    return densify([entryEdge, ...curve, exitEdge], 0.5);
  }

  // entry stop-line / mouth point for an arm (right lane), + perpendicular span
  function mouth(arm) {
    const hIn = [-DIR[arm][0], -DIR[arm][1]];
    const off = V.mul(V.right(hIn), LANE_OFF);
    return V.add(V.add(C, V.mul(DIR[arm], R)), off);
  }

  // --- rendering primitives ---
  const roads = arms.map((a) => ({ a: C, b: edge(a), halfW: ROAD_HALF }));
  const centerlines = arms.map((a) => ({ a: V.add(C, V.mul(DIR[a], R)), b: edge(a) }));
  const edges = [];
  for (const a of arms) {
    const d = DIR[a], perp = V.right(d);
    for (const s of [1, -1]) {
      const o = V.mul(perp, ROAD_HALF * s);
      edges.push({ a: V.add(V.add(C, V.mul(d, R)), o), b: V.add(edge(a), o) });
    }
  }

  // stop / give-way lines from signs or control
  const lineKind = {}; // arm -> 'stop' | 'give' | 'lights'
  const signList = [];
  for (const sg of (scn.signs ?? [])) {
    signList.push({ ...sg, pos: signAnchor(C, sg.arm, R) });
    if (sg.code === "P6") lineKind[sg.arm] = "stop";
    else if (sg.code === "P4") lineKind[sg.arm] = "give";
  }
  if (scn.control === "lights") for (const a of arms) lineKind[a] = "lights";

  const stopLines = [];
  for (const [arm, kind] of Object.entries(lineKind)) {
    const m = mouth(arm), perp = V.right([-DIR[arm][0], -DIR[arm][1]]);
    stopLines.push({
      kind,
      a: V.add(m, V.mul(perp, -LANE_OFF * 1.6)),
      b: V.add(m, V.mul(perp, LANE_OFF * 1.6)),
    });
  }

  // pedestrian crossings (zebra) just outside the mouth of given arms
  const zebras = (scn.crossings ?? []).map((cr) => {
    const a = cr.arm, d = DIR[a], perp = V.right(d);
    const center = V.add(C, V.mul(d, R + 1.6));
    return { center, dir: d, perp, halfW: ROAD_HALF, arm: a };
  });

  // tram corridor: a pair of rails along the two tram arms through the centre
  let rails = null;
  if (scn.tram?.arms?.length === 2) {
    const [a1, a2] = scn.tram.arms;
    const line = [edge(a1), C, edge(a2)];
    const dir = V.norm(V.sub(edge(a2), edge(a1)));
    const perp = V.right(dir);
    rails = {
      a: line.map((p) => V.add(p, V.mul(perp, RAIL_OFF))),
      b: line.map((p) => V.add(p, V.mul(perp, -RAIL_OFF))),
      center: line,
    };
  }

  return {
    C, R, W, H, arms, roadHalf: ROAD_HALF, laneOff: LANE_OFF,
    roads, centerlines, edges, stopLines, zebras, rails, signs: signList,
    pathFor, mouth, edge, DIR,
  };
}

function signAnchor(C, arm, R) {
  const d = DIR[arm], hIn = [-d[0], -d[1]];
  // to the right of the approaching driver, just before the mouth
  return V.add(V.add(C, V.mul(d, R + 2.2)), V.mul(V.right(hIn), ROAD_HALF + 1.8));
}

export { LANE_W, ROAD_HALF, DIR };
