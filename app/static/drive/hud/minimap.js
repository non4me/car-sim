// North-up minimap with three modes (msg 2691 + 2777 + 2784):
//   • local  — nearby streets around the car, 3 zoom levels (+/- buttons).
//   • city   — the WHOLE city: main districts (ranked by size) + major objects, de-overlapped.
//   • route  — the selected route, scaled to fit; localities graded by distance to the route
//              (adjacent = full, next ring = semi-transparent, third ring = 20%, farther = hidden).
const RADII = [110, 240, 430];   // world metres shown each way (local mode), for levels +1, +2, +3

// district ranking (OSM place kind) — smaller rank = more important = bigger/brighter label.
// The city's OWN districts (suburb/quarter — Vinohrady, Smíchov, Karlín…) outrank the surrounding
// independent towns/villages that fall inside the baked bbox but lie OUTSIDE Prague (Říčany, Jesenice…),
// so the City overview shows the main districts Vlad asked for, not a scatter of peripheral villages (msg 2811).
const PLACE_RANK = { city: 0, suburb: 1, quarter: 2, town: 3, neighbourhood: 4, village: 5 };
const PLACE_FONT = { city: 12, suburb: 11, quarter: 10, town: 9, neighbourhood: 8, village: 8 };
// landmark significance (msg 2784) — what's worth showing at a whole-city scale
const LM_RANK = { airport: 0, castle: 1, stadium: 2, station: 3, university: 4, hospital: 5, museum: 6, theatre: 7 };
// route-distance tiers (metres): adjacent / next / third — beyond the last is hidden (msg 2784)
const TIER = [[450, 1.0], [1050, 0.5], [1900, 0.22]];

function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distToLine(px, py, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = distPointSeg(px, py, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    if (d < best) best = d;
  }
  return best;
}

export function makeMinimap(canvas, plusBtn, minusBtn, levelEl, cityBtn, routeBtn) {
  const ctx = canvas.getContext("2d");
  let level = 0;                  // 0..2  → +1.. +3
  let mode = "local";             // local | city | route
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = canvas.clientWidth || 138;
  canvas.width = canvas.height = Math.round(size * dpr);

  const setLevel = (l) => {
    level = Math.max(0, Math.min(RADII.length - 1, l));
    if (levelEl) levelEl.textContent = "+" + (level + 1);
    localStorage.setItem("carsim_minilevel", String(level));   // persist across sessions
  };
  const saved = parseInt(localStorage.getItem("carsim_minilevel"), 10);
  setLevel(Number.isFinite(saved) ? saved : 0);

  const setMode = (m) => {
    mode = m;
    if (cityBtn) cityBtn.classList.toggle("on", m === "city");
    if (routeBtn) routeBtn.classList.toggle("on", m === "route");
    const zoomActive = m === "local";
    [plusBtn, minusBtn, levelEl].forEach((b) => b && (b.style.opacity = zoomActive ? "" : ".35"));
  };

  plusBtn.addEventListener("click", (e) => { e.preventDefault(); if (mode === "local") setLevel(level + 1); });
  minusBtn.addEventListener("click", (e) => { e.preventDefault(); if (mode === "local") setLevel(level - 1); });
  if (cityBtn) cityBtn.addEventListener("click", (e) => { e.preventDefault(); setMode(mode === "city" ? "local" : "city"); });
  if (routeBtn) routeBtn.addEventListener("click", (e) => {
    e.preventDefault(); if (routeBtn.disabled) return; setMode(mode === "route" ? "local" : "route");
  });

  // de-overlapping label placer: keeps placed bounding boxes for the frame and skips any new label
  // that would collide (so the overview stays readable — also Vlad's "надписи не перекрываются").
  function makePlacer() {
    const placed = [];
    return (X, Y, text, color, alpha, fontPx) => {
      ctx.font = `700 ${fontPx}px ui-sans-serif,system-ui,sans-serif`;
      const w = ctx.measureText(text).width, h = fontPx + 1, pad = 1.5;
      const box = [X - w / 2 - pad, Y - h / 2 - pad, X + w / 2 + pad, Y + h / 2 + pad];
      if (box[0] < 2 || box[2] > size - 2 || box[1] < 11 || box[3] > size - 2) return false;
      for (const b of placed)
        if (!(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])) return false;
      placed.push(box);
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(8,10,15,.8)"; ctx.strokeText(text, X, Y);
      ctx.fillStyle = color; ctx.fillText(text, X, Y);
      ctx.globalAlpha = 1;
      return true;
    };
  }

  function bg() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#0a0d13"; ctx.fillRect(0, 0, size, size);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
  }

  function carTriangle(ax, ay, h) {        // heading triangle (north-up frame)
    const ux = Math.cos(h), uy = -Math.sin(h), px = -uy, py = ux;
    ctx.beginPath();
    ctx.moveTo(ax + ux * 8, ay + uy * 8);
    ctx.lineTo(ax - ux * 5 + px * 5, ay - uy * 5 + py * 5);
    ctx.lineTo(ax - ux * 5 - px * 5, ay - uy * 5 - py * 5);
    ctx.closePath(); ctx.fillStyle = "#ffd24a"; ctx.fill();
  }
  function tag(text) {
    ctx.globalAlpha = 1; ctx.fillStyle = "rgba(170,180,200,.85)";
    ctx.font = "700 8px ui-sans-serif,system-ui,sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(text, 4, 3);
  }
  function northTick() {
    ctx.globalAlpha = 1; ctx.fillStyle = "rgba(170,180,200,.7)";
    ctx.font = "700 9px ui-sans-serif,system-ui,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("N", size / 2, 3);
  }

  function draw(map, car, currentStreet, ov) {
    ov = ov || {};
    const route = ov.route && ov.route.line && ov.route.line.length > 1 && ov.route.box ? ov.route : null;
    if (routeBtn) {
      routeBtn.disabled = !route;
      routeBtn.style.display = route ? "" : "none";        // hide the Trasa button entirely with no route (msg 2811)
    }
    if (mode === "route" && !route) setMode("local");      // route cleared while shown → fall back
    bg();
    if (mode === "city") return drawCity(map, car, ov);
    if (mode === "route" && route) return drawRoute(map, car, route, ov);
    return drawLocal(map, car, currentStreet);
  }

  // ---- local (car-centred) ----------------------------------------------------------------------
  function drawLocal(map, car, currentStreet) {
    const R = RADII[level], s = (size / 2) / R, cx = car.x, cy = car.y;
    const toM = (wx, wy) => [size / 2 + (wx - cx) * s, size / 2 - (wy - cy) * s];
    for (const e of map.edges) {
      const bb = e.bb;
      if (bb[0] > cx + R || bb[2] < cx - R || bb[1] > cy + R || bb[3] < cy - R) continue;
      ctx.beginPath();
      for (let i = 0; i < e.geom.length; i++) { const [X, Y] = toM(e.geom[i][0], e.geom[i][1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      const cur = e.name && e.name === currentStreet;
      ctx.strokeStyle = cur ? "#5b9cff" : "rgba(150,165,190,.55)";
      ctx.lineWidth = cur ? 3 : Math.max(1.2, e.width * s * 0.6);
      ctx.stroke();
    }
    carTriangle(size / 2, size / 2, car.h);
    northTick();
  }

  // ---- city (whole map) -------------------------------------------------------------------------
  function fitToBox(box, pad) {
    const span = Math.max(box.w, box.h, 1), s = (size - pad * 2) / span;
    const cx = box.cx, cy = box.cy;
    return { s, toM: (wx, wy) => [size / 2 + (wx - cx) * s, size / 2 - (wy - cy) * s] };
  }

  function drawCity(map, car, ov) {
    const b = map.meta && map.meta.bounds;
    if (!b) return drawLocal(map, car, "");
    const box = { cx: (b.minx + b.maxx) / 2, cy: (b.miny + b.maxy) / 2, w: b.maxx - b.minx, h: b.maxy - b.miny };
    const { toM } = fitToBox(box, 10);
    const cxw = box.cx, cyw = box.cy;

    // faint resident streets (only near the car — a hint of where you are in the city)
    ctx.strokeStyle = "rgba(120,135,160,.16)"; ctx.lineWidth = 1;
    for (const e of map.edges) {
      ctx.beginPath();
      for (let i = 0; i < e.geom.length; i++) { const [X, Y] = toM(e.geom[i][0], e.geom[i][1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke();
    }
    // every district as a faint dot — the spread of dots gives the city its body & full extent, so the
    // overview reads as a map of all Prague rather than a few labels floating in black (msg 2811)
    ctx.fillStyle = "rgba(140,160,190,.45)";
    for (const d of (ov.districts || [])) { const [X, Y] = toM(d.x, d.y); ctx.beginPath(); ctx.arc(X, Y, 1.3, 0, 7); ctx.fill(); }

    const place = makePlacer();
    // label the MAIN districts: by rank (city's own suburbs/quarters first), then central-first within a
    // rank so the well-known inner districts win the de-overlap over far-out ones.
    const districts = (ov.districts || []).slice().sort((a, b2) =>
      ((PLACE_RANK[a.kind] ?? 9) - (PLACE_RANK[b2.kind] ?? 9))
      || (Math.hypot(a.x - cxw, a.y - cyw) - Math.hypot(b2.x - cxw, b2.y - cyw)));
    for (const d of districts) {
      const [X, Y] = toM(d.x, d.y);
      const fp = PLACE_FONT[d.kind] ?? 8;
      const alpha = (PLACE_RANK[d.kind] ?? 9) <= 2 ? 0.97 : 0.66;
      place(X, Y, d.name, "rgba(224,231,243,1)", alpha, fp);
    }
    // then major objects, by significance, lower priority than districts
    const lms = (ov.landmarks || []).slice().sort((a, b2) => (LM_RANK[a.kind] ?? 9) - (LM_RANK[b2.kind] ?? 9));
    let shown = 0;
    for (const l of lms) {
      if (shown >= 16) break;
      const [X, Y] = toM(l.x, l.y);
      if (place(X, Y - 4, l.name, "rgba(150,200,255,.9)", 0.9, 8)) {
        ctx.globalAlpha = 0.9; ctx.fillStyle = "#5b9cff";
        ctx.beginPath(); ctx.arc(X, Y, 1.8, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        shown++;
      }
    }
    // car position
    const [px, py] = toM(car.x, car.y);
    ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "#0a0d13"; ctx.stroke();
    tag("CITY");
  }

  // ---- route (Trasa) ----------------------------------------------------------------------------
  function drawRoute(map, car, route, ov) {
    const { line, box } = route;
    const { toM } = fitToBox(box, 12);

    // faint resident streets where they happen to be loaded
    ctx.strokeStyle = "rgba(120,135,160,.16)"; ctx.lineWidth = 1;
    for (const e of map.edges) {
      ctx.beginPath();
      for (let i = 0; i < e.geom.length; i++) { const [X, Y] = toM(e.geom[i][0], e.geom[i][1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke();
    }

    // the full route ribbon + start/end
    ctx.beginPath();
    for (let i = 0; i < line.length; i++) { const [X, Y] = toM(line[i][0], line[i][1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.strokeStyle = "rgba(96,165,255,.95)"; ctx.lineWidth = 2.4; ctx.stroke();
    const [sx, sy] = toM(line[0][0], line[0][1]), [ex, ey] = toM(line[line.length - 1][0], line[line.length - 1][1]);
    ctx.fillStyle = "#37d67a"; ctx.beginPath(); ctx.arc(sx, sy, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = "#ff5a6a"; ctx.beginPath(); ctx.arc(ex, ey, 3.4, 0, 7); ctx.fill();

    // localities graded by distance to the route: adjacent full / next semi / third 20% / rest hidden.
    // graded.tier ascending so adjacent labels win the de-overlap.
    const graded = [];
    for (const d of (ov.districts || [])) {
      const dist = distToLine(d.x, d.y, line);
      let ti = -1;
      for (let t = 0; t < TIER.length; t++) if (dist <= TIER[t][0]) { ti = t; break; }
      if (ti >= 0) graded.push({ d, dist, ti });
    }
    graded.sort((a, b2) => a.dist - b2.dist);
    const place = makePlacer();
    for (const g of graded) {
      const [X, Y] = toM(g.d.x, g.d.y);
      place(X, Y, g.d.name, "rgba(218,226,240,1)", TIER[g.ti][1], g.ti === 0 ? 9 : 8);
    }
    // a few major objects right by the route (within the adjacent+next rings)
    const near = [];
    for (const l of (ov.landmarks || [])) {
      const dist = distToLine(l.x, l.y, line);
      if (dist <= TIER[1][0]) near.push({ l, dist });
    }
    near.sort((a, b2) => (LM_RANK[a.l.kind] ?? 9) - (LM_RANK[b2.l.kind] ?? 9) || a.dist - b2.dist);
    let shown = 0;
    for (const n of near) {
      if (shown >= 8) break;
      const [X, Y] = toM(n.l.x, n.l.y);
      if (place(X, Y - 4, n.l.name, "rgba(150,200,255,.9)", 0.85, 8)) {
        ctx.globalAlpha = 0.85; ctx.fillStyle = "#5b9cff";
        ctx.beginPath(); ctx.arc(X, Y, 1.7, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        shown++;
      }
    }
    // car position along the route
    const [px, py] = toM(car.x, car.y);
    ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "#0a0d13"; ctx.stroke();
    tag("TRASA");
  }

  // expose the current mode so the caller can keep its own button state in sync if needed
  return { draw, mode: () => mode };
}
