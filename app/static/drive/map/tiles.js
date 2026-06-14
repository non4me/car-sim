// Loads the baked district (meta + all tiles), dedupes edges, and builds a coarse
// spatial grid for nearestEdge()/onSurface() queries used by driving + rules.

function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function edgeDist(e, x, y) {
  let best = Infinity;
  const g = e.geom;
  for (let i = 1; i < g.length; i++) {
    const d = distPointSeg(x, y, g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]);
    if (d < best) best = d;
  }
  return best;
}

// nearest point on an edge + the local unit tangent (in geom/flow direction) — used for
// the oncoming-lane / wrong-way check, which needs which side of the centreline the car is on.
function nearestOnEdge(e, x, y) {
  let best = Infinity, px = x, py = y, tx = 1, ty = 0;
  const g = e.geom;
  for (let i = 1; i < g.length; i++) {
    const ax = g[i - 1][0], ay = g[i - 1][1], dx = g[i][0] - ax, dy = g[i][1] - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy, d = Math.hypot(x - cx, y - cy);
    if (d < best) { best = d; px = cx; py = cy; const L = Math.hypot(dx, dy) || 1; tx = dx / L; ty = dy / L; }
  }
  return { d: best, px, py, tx, ty };
}

const CELL = 60; // metres
const ckey = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;

export async function loadMap(base) {
  const meta = await (await fetch(base + "/meta.json")).json();
  const tiles = await Promise.all(
    meta.tiles.map((k) => fetch(`${base}/tiles/${k}.json`).then((r) => r.json()))
  );
  const bbox = (pts) => {
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const p of pts) {
      if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0];
      if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1];
    }
    return [mnx, mny, mxx, mxy];
  };

  const seen = new Set(), seenA = new Set();
  const edges = [], junctions = [], areas = [];
  for (const t of tiles) {
    for (const e of t.edges) {
      const sig = `${e.a}_${e.b}_${e.cls}_${e.geom.length}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      e.bb = bbox(e.geom);   // [minx,miny,maxx,maxy] for viewport culling (long sparse-vertex edges)
      edges.push(e);
    }
    for (const j of t.junctions) junctions.push(j);
    for (const a of t.areas || []) {     // schematic backdrop polygons (span tiles → dedupe)
      const sig = `${a.kind}_${a.poly.length}_${a.poly[0][0]}_${a.poly[0][1]}`;
      if (seenA.has(sig)) continue;
      seenA.add(sig);
      a.bb = bbox(a.poly);
      areas.push(a);
    }
  }

  // spatial grid: cell -> edge indices. Rasterize each SEGMENT into every cell it
  // crosses (not just vertex cells) so long straight edges are indexed mid-segment.
  const grid = new Map();
  edges.forEach((e, ei) => {
    const cells = new Set();
    const g = e.geom;
    for (let i = 1; i < g.length; i++) {
      const ax = g[i - 1][0], ay = g[i - 1][1], bx = g[i][0], by = g[i][1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        cells.add(ckey(ax + (bx - ax) * t, ay + (by - ay) * t));
      }
    }
    for (const c of cells) {
      if (!grid.has(c)) grid.set(c, []);
      grid.get(c).push(ei);
    }
  });

  function candidates(x, y) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    const out = new Set();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(`${cx + dx}:${cy + dy}`);
        if (arr) for (const i of arr) out.add(i);
      }
    return out;
  }

  function nearestEdge(x, y) {
    let best = null, bd = Infinity, info = null;
    for (const i of candidates(x, y)) {
      const r = nearestOnEdge(edges[i], x, y);
      if (r.d < bd) { bd = r.d; best = edges[i]; info = r; }
    }
    return info ? { edge: best, dist: bd, px: info.px, py: info.py, tx: info.tx, ty: info.ty }
                : { edge: null, dist: Infinity };
  }

  // on the drivable surface if within (road half-width + small margin) of an edge
  function onSurface(x, y, margin = 1.0) {
    for (const i of candidates(x, y)) {
      const e = edges[i];
      if (edgeDist(e, x, y) <= e.width / 2 + margin) return true;
    }
    return false;
  }

  return { meta, edges, junctions, areas, nearestEdge, onSurface };
}
