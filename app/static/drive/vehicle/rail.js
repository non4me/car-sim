// On-rails navigation for the bird's-eye overview mode (Vlad msg 2691): the car cannot
// leave the road network. ↑/↓ drive along the current street; at a junction ←/→ take the
// nearest matching turn, otherwise continue straight; with no match the car bumps (stops).
const DEG = Math.PI / 180;

export function makeRail(map) {
  const E = map.edges;
  const len = E.map(edgeLen);

  // adjacency: junction node id -> [{ei, atStart}]
  const adj = new Map();
  const add = (node, rec) => { (adj.get(node) || adj.set(node, []).get(node)).push(rec); };
  E.forEach((e, ei) => { add(e.a, { ei, atStart: true }); add(e.b, { ei, atStart: false }); });

  let cur = -1, s = 0, dir = 1;     // dir +1 → travelling a→b (s increasing); −1 → b→a

  function edgeLen(e) {
    let L = 0; const g = e.geom;
    for (let i = 1; i < g.length; i++) L += Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]);
    return L;
  }
  // point + unit tangent (in +geom direction) at arc-length s from geom[0]
  function at(ei, s) {
    const g = E[ei].geom; let acc = 0;
    for (let i = 1; i < g.length; i++) {
      const dx = g[i][0] - g[i - 1][0], dy = g[i][1] - g[i - 1][1], L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      if (s <= acc + L) { const t = (s - acc) / L; return { x: g[i - 1][0] + dx * t, y: g[i - 1][1] + dy * t, tx: dx / L, ty: dy / L }; }
      acc += L;
    }
    const n = g.length - 1, dx = g[n][0] - g[n - 1][0], dy = g[n][1] - g[n - 1][1], L = Math.hypot(dx, dy) || 1;
    return { x: g[n][0], y: g[n][1], tx: dx / L, ty: dy / L };
  }

  // snap the car onto the nearest edge, matching travel direction to its heading
  function attach(car) {
    const ne = map.nearestEdge(car.x, car.y);
    cur = E.indexOf(ne.edge);
    if (cur < 0) { cur = 0; }
    // project car position to arc-length, and pick dir from the car's heading
    const g = E[cur].geom; let acc = 0, bestD = Infinity, bestS = 0, bestTx = 1, bestTy = 0;
    for (let i = 1; i < g.length; i++) {
      const ax = g[i - 1][0], ay = g[i - 1][1], dx = g[i][0] - ax, dy = g[i][1] - ay, L2 = dx * dx + dy * dy || 1;
      let t = ((car.x - ax) * dx + (car.y - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t, py = ay + dy * t, d = (px - car.x) ** 2 + (py - car.y) ** 2;
      if (d < bestD) { bestD = d; bestS = acc + Math.hypot(dx, dy) * t; const L = Math.hypot(dx, dy) || 1; bestTx = dx / L; bestTy = dy / L; }
      acc += Math.hypot(dx, dy);
    }
    s = bestS;
    dir = (Math.cos(car.h) * bestTx + Math.sin(car.h) * bestTy) >= 0 ? 1 : -1;
    place(car);
  }

  function place(car) {
    const p = at(cur, s);
    car.x = p.x; car.y = p.y;
    car.h = Math.atan2(dir > 0 ? p.ty : -p.ty, dir > 0 ? p.tx : -p.tx);
  }

  // choose the next edge leaving `node` given the desired turn; returns {ei, dir} or null (bump)
  function chooseNext(node, fromEi, headx, heady, turn) {
    const cand = [];
    for (const { ei, atStart } of (adj.get(node) || [])) {
      if (ei === fromEi) continue;
      const g = E[ei].geom;
      // outgoing tangent = into the edge, away from the junction
      let ox, oy;
      if (atStart) { ox = g[1][0] - g[0][0]; oy = g[1][1] - g[0][1]; }
      else { const n = g.length - 1; ox = g[n - 1][0] - g[n][0]; oy = g[n - 1][1] - g[n][1]; }
      const L = Math.hypot(ox, oy) || 1; ox /= L; oy /= L;
      const ang = Math.atan2(headx * oy - heady * ox, headx * ox + heady * oy); // +left, −right
      cand.push({ ei, dir: atStart ? 1 : -1, ang });
    }
    if (!cand.length) return null;
    if (turn > 0) {            // left: nearest left turn (smallest positive angle past threshold)
      const left = cand.filter((c) => c.ang > 20 * DEG).sort((a, b) => a.ang - b.ang);
      return left[0] || null;
    }
    if (turn < 0) {            // right: nearest right turn
      const right = cand.filter((c) => c.ang < -20 * DEG).sort((a, b) => b.ang - a.ang);
      return right[0] || null;
    }
    // straight: most aligned continuation (allow up to ~70°), else bump
    const straight = cand.filter((c) => Math.abs(c.ang) < 70 * DEG).sort((a, b) => Math.abs(a.ang) - Math.abs(b.ang));
    return straight[0] || null;
  }

  function step(car, overshoot, turn) {
    // we just hit an end of `cur`; node + heading depend on travel direction
    const g = E[cur].geom, n = g.length - 1;
    const node = dir > 0 ? E[cur].b : E[cur].a;
    const hx = Math.cos(car.h), hy = Math.sin(car.h);
    const next = chooseNext(node, cur, hx, hy, turn);
    if (!next) { car.v = 0; s = dir > 0 ? len[cur] : 0; return false; }  // bump
    cur = next.ei; dir = next.dir;
    s = dir > 0 ? overshoot : len[cur] - overshoot;
    const p = at(cur, s);                              // keep heading current for the next hop
    car.h = Math.atan2(dir > 0 ? p.ty : -p.ty, dir > 0 ? p.tx : -p.tx);
    return true;
  }

  function update(dt, c, car) {
    car.longitudinal(dt, c);
    let move = car.v * dt * dir;          // signed distance along +geom
    s += move;
    let guard = 0;
    while (guard++ < 8) {
      if (s > len[cur]) { if (!step(car, s - len[cur], c.turn)) break; }
      else if (s < 0) { if (!step(car, -s, c.turn)) break; }
      else break;
    }
    place(car);
  }

  return { attach, update };
}
