// Streaming tile store: loads the baked district meta, then keeps ONLY the tiles near the
// camera resident in memory — fetching tiles on approach and evicting them behind, so the map
// can be city-huge (all of Prague) while memory stays ~constant. nearestEdge()/onSurface() query
// a spatial grid rebuilt from the resident tiles whenever the resident set changes.

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

function bbox(pts) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const p of pts) {
    if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0];
    if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1];
  }
  return [mnx, mny, mxx, mxy];
}

const CELL = 60;                 // spatial-grid cell size (m)
const ckey = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
const MAX_RESIDENT = 80;         // hard cap on resident tiles (≈1.4 MB) — bounds memory at extreme zoom

export async function loadMap(base) {
  const meta = await (await fetch(base + "/meta.json")).json();
  const TILE = meta.tile_m || 400;
  const available = new Set(meta.tiles);            // tile keys that actually exist
  const resident = new Map();                       // key -> {edges,junctions,areas,signs}
  const loading = new Set();                        // keys currently being fetched

  // merged, deduped view of the resident tiles (what the renderer + rules read)
  const map = { meta, edges: [], junctions: [], areas: [], signs: [], crossings: [], rails: [], labels: [], pois: [], addrs: [], nearestEdge, onSurface, update };
  let grid = new Map();

  function buildGrid(edges) {
    const g = new Map();
    for (const e of edges) {
      const cells = new Set();
      const gm = e.geom;
      for (let i = 1; i < gm.length; i++) {
        const ax = gm[i - 1][0], ay = gm[i - 1][1], bx = gm[i][0], by = gm[i][1];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          cells.add(ckey(ax + (bx - ax) * t, ay + (by - ay) * t));
        }
      }
      for (const c of cells) { if (!g.has(c)) g.set(c, []); g.get(c).push(e); }
    }
    return g;
  }

  // merge the resident tiles into deduped arrays + rebuild the spatial grid. Edges/areas span
  // tiles (dedupe by signature); junctions/signs are baked into exactly one tile (no dupes).
  function rebuild() {
    const seen = new Set(), seenA = new Set(), seenR = new Set(), seenL = new Set();
    const edges = [], junctions = [], areas = [], signs = [], crossings = [], rails = [], labels = [], pois = [], addrs = [];
    for (const t of resident.values()) {
      for (const e of t.edges) {
        const sig = `${e.a}_${e.b}_${e.cls}_${e.geom.length}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        if (!e.bb) e.bb = bbox(e.geom);
        edges.push(e);
      }
      for (const j of t.junctions) junctions.push(j);
      for (const a of t.areas || []) {
        const sig = `${a.kind}_${a.poly.length}_${a.poly[0][0]}_${a.poly[0][1]}`;
        if (seenA.has(sig)) continue;
        seenA.add(sig);
        if (!a.bb) a.bb = bbox(a.poly);
        areas.push(a);
      }
      for (const s of t.signs || []) signs.push(s);
      for (const c of t.crossings || []) crossings.push(c);
      for (const r of t.rails || []) {                         // rails span tiles → dedupe like edges
        const sig = `${r.kind}_${r.geom.length}_${r.geom[0][0]}_${r.geom[0][1]}`;
        if (seenR.has(sig)) continue;
        seenR.add(sig);
        if (!r.bb) r.bb = bbox(r.geom);
        rails.push(r);
      }
      for (const l of t.labels || []) {                        // labels baked per-tile; guard cross-tile dupes
        const sig = `${l.kind}_${l.name}_${l.x}_${l.y}`;
        if (seenL.has(sig)) continue;
        seenL.add(sig);
        labels.push(l);
      }
      for (const po of t.pois || []) pois.push(po);             // POIs + house numbers: 1 tile each, no dedupe
      for (const ad of t.addrs || []) addrs.push(ad);
    }
    grid = buildGrid(edges);
    map.edges = edges; map.junctions = junctions; map.areas = areas; map.signs = signs; map.crossings = crossings;
    map.rails = rails; map.labels = labels; map.pois = pois; map.addrs = addrs;
  }

  function candidates(x, y) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    const out = new Set();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(`${cx + dx}:${cy + dy}`);
        if (arr) for (const e of arr) out.add(e);
      }
    return out;
  }

  // When `layer` is given, edges on a DIFFERENT carriageway level pay a big distance penalty so the car
  // can't snap onto an overpass/underpass passing above/below it (msg 2980). A much-closer different-level
  // edge can still win — that's a genuine ramp transition, where no same-level road is near.
  const LAYER_PENALTY = 22;
  function nearestEdge(x, y, layer = null) {
    let best = null, bestScore = Infinity, info = null;
    for (const e of candidates(x, y)) {
      const r = nearestOnEdge(e, x, y);
      const score = r.d + (layer != null && (e.lv || 0) !== layer ? LAYER_PENALTY : 0);
      if (score < bestScore) { bestScore = score; best = e; info = r; }
    }
    return info ? { edge: best, dist: info.d, px: info.px, py: info.py, tx: info.tx, ty: info.ty }
                : { edge: null, dist: Infinity };
  }

  function onSurface(x, y, margin = 1.0, layer = null) {
    for (const e of candidates(x, y)) {
      if (layer != null && (e.lv || 0) !== layer) continue;
      if (edgeDist(e, x, y) <= e.width / 2 + margin) return true;
    }
    return false;
  }

  // tiles wanted around a camera at (cx,cy) seeing radius R, biased AHEAD by velocity so fast
  // driving prefetches in the direction of travel. Capped to the nearest MAX_RESIDENT.
  function desiredTiles(cx, cy, R, vx, vy) {
    const speed = Math.hypot(vx, vy);
    const look = Math.min(800, speed * 6);                 // up to ~800 m ahead at speed
    const ex = speed > 0.1 ? cx + (vx / speed) * look : cx;
    const ey = speed > 0.1 ? cy + (vy / speed) * look : cy;
    const margin = TILE;                                   // a tile beyond the view
    const minx = Math.min(cx, ex) - R - margin, maxx = Math.max(cx, ex) + R + margin;
    const miny = Math.min(cy, ey) - R - margin, maxy = Math.max(cy, ey) + R + margin;
    const out = [];
    for (let tx = Math.floor(minx / TILE); tx <= Math.floor(maxx / TILE); tx++)
      for (let ty = Math.floor(miny / TILE); ty <= Math.floor(maxy / TILE); ty++) {
        const k = `${tx}_${ty}`;
        if (!available.has(k)) continue;
        const dcx = (tx + 0.5) * TILE - cx, dcy = (ty + 0.5) * TILE - cy;
        out.push({ k, d: dcx * dcx + dcy * dcy });
      }
    out.sort((a, b) => a.d - b.d);
    return new Set(out.slice(0, MAX_RESIDENT).map((o) => o.k));
  }

  function loadTile(k) {
    if (resident.has(k) || loading.has(k)) return null;
    loading.add(k);
    return fetch(`${base}/tiles/${k}.json`).then((r) => r.json()).then((t) => {
      loading.delete(k);
      resident.set(k, { edges: t.edges || [], junctions: t.junctions || [], areas: t.areas || [], signs: t.signs || [], crossings: t.crossings || [], rails: t.rails || [], labels: t.labels || [], pois: t.pois || [], addrs: t.addrs || [] });
    }).catch(() => { loading.delete(k); });
  }

  // streaming step (fire-and-forget): evict far tiles, fetch missing ones, rebuild on change.
  let lastX = NaN, lastY = NaN;
  function update(cx, cy, R, vx = 0, vy = 0) {
    if (Number.isFinite(lastX) && Math.hypot(cx - lastX, cy - lastY) < 15 && Math.hypot(vx, vy) < 0.1) return;
    lastX = cx; lastY = cy;
    const desired = desiredTiles(cx, cy, R, vx, vy);
    let changed = false;
    for (const k of [...resident.keys()]) if (!desired.has(k)) { resident.delete(k); changed = true; }
    const missing = [...desired].filter((k) => !resident.has(k) && !loading.has(k));
    if (missing.length) {
      Promise.all(missing.map(loadTile)).then(() => rebuild());
    }
    if (changed) rebuild();
  }

  // initial synchronous load of the ring around the spawn (city-bounds centre) so the first
  // frame + spawn pick have data; the centre is also returned as a spawn hint.
  const cx0 = (meta.bounds.minx + meta.bounds.maxx) / 2;
  const cy0 = (meta.bounds.miny + meta.bounds.maxy) / 2;
  const first = desiredTiles(cx0, cy0, 500, 0, 0);
  await Promise.all([...first].map(loadTile));
  rebuild();
  map.spawnHint = { x: cx0, y: cy0 };
  return map;
}
