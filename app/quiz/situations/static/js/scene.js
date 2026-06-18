// Build renderable geometry for a REAL junction from authored data (msg 3093 redesign).
// Coordinates are METRES in a centre-origin frame (origin = junction centre, +x east, +y south
// to match the y-down canvas). Everything here is view-independent; render.js maps to px.
//
// A junction is authored as a set of road centrelines (+ lane count → width), tram-track polylines,
// upright signs at explicit positions, pedestrian crossings, stop/give-way lines, lane arrows and
// street labels. This is a superset of the old symmetric N/E/S/W builder, so any real layout — skewed
// arms, unequal widths, trams off the centreline — can be reproduced to scale by tracing ortofoto/DTMP.
import { V } from "./world.js";

const LANE_W = 3.25;   // default carriageway lane width (m)

// offset a centreline polyline by `d` metres to its right-of-travel (per V.right, y-down)
function offsetPath(cl, d) {
  const out = [];
  for (let i = 0; i < cl.length; i++) {
    const dir = i < cl.length - 1
      ? V.norm(V.sub(cl[i + 1], cl[i]))
      : V.norm(V.sub(cl[i], cl[i - 1]));
    out.push(V.add(cl[i], V.mul(V.right(dir), d)));
  }
  return out;
}

export function buildScene(scn) {
  const g = scn.geom || {};
  const roads = [], edges = [], centerlines = [];

  for (const rd of g.roads || []) {
    const cl = rd.centerline.map((p) => p.slice());
    const lanes = rd.lanes || 2;
    const halfW = rd.halfW != null ? rd.halfW : (lanes * LANE_W) / 2;
    roads.push({ centerline: cl, halfW, name: rd.name, priority: !!rd.priority });
    edges.push(offsetPath(cl, halfW), offsetPath(cl, -halfW));   // both kerb lines
    if (lanes >= 2 && !rd.oneway) centerlines.push(cl);          // dashed lane divider
  }

  const rails = (g.rails || []).map((r) => r.map((p) => p.slice()));

  const zebras = (g.crossings || []).map((c) => {
    const dir = V.norm(c.dir || [1, 0]);
    return { center: c.center.slice(), dir, perp: V.right(dir), halfW: c.halfW || 6 };
  });

  const stopLines = (g.stoplines || []).map((s) => ({ a: s.a.slice(), b: s.b.slice(), kind: s.kind || "stop" }));
  const signs = (g.signs || []).map((s) => ({ code: s.code, pos: [s.x, s.y] }));
  const arrows = (g.arrows || []).map((a) => ({ pos: [a.x, a.y], dir: V.norm(a.dir || [0, -1]), kind: a.kind || "straight" }));
  const labels = (g.labels || []).map((l) => ({ pos: [l.x, l.y], text: l.text, rot: l.rot || 0 }));

  // junction core: an asphalt disc that masks lane markings crossing the open intersection
  // (real kerb/centre lines stop at the junction). Rails are redrawn on top so tracks continue.
  const core = g.core ? { pos: [g.core.x, g.core.y], r: g.core.r } : null;

  const bbox = scn.view
    ? [scn.view.minx, scn.view.miny, scn.view.maxx, scn.view.maxy]
    : autoBounds(roads, rails);

  return { roads, edges, centerlines, rails, zebras, stopLines, signs, arrows, labels, core, bbox };
}

function autoBounds(roads, rails) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const acc = (p) => {
    minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]);
    maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]);
  };
  for (const r of roads) for (const p of r.centerline) acc(p);
  for (const r of rails) for (const p of r) acc(p);
  if (!isFinite(minx)) return [-40, -40, 40, 40];
  return [minx, miny, maxx, maxy];
}

export { LANE_W };
