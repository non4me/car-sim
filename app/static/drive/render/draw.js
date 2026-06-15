// Top-down renderer with a heading-up (rotating) camera. Roads, lane markings,
// junction control, subtle street-name labels on the roads, and the nose-up car.
import { PARAMS as P } from "../vehicle/params.js";

const BG = "#0e1118";
const ASPHALT = "#2c333f";   // single road-surface colour (uniform → no seams where roads cross)
// schematic backdrop fills (drawn behind the roads). Buildings get a brighter edge so
// the block structure reads like a city map; roads stay the lightest (drivable) layer.
const AREA_FILL = { building: "#232a3a", green: "#1f3327", water: "#1b517f" };   // water = clear river blue
const AREA_STROKE = { building: "#46526b", green: "#335039", water: "#3f82bd" };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function path(ctx, view, geom) {
  ctx.beginPath();
  for (let i = 0; i < geom.length; i++) {
    const [X, Y] = view.project(geom[i][0], geom[i][1]);
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  }
}

export function draw(ctx, view, map, car, rules, route) {
  const { w, h, dpr, zoom } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const R = view.visR();
  // narrowest first so wider roads paint last (on top) → clean crossings, hierarchy by width
  const vis = map.edges.filter((e) => view.boxVisible(e.bb)).sort((a, b) => a.width - b.width);

  // 0) schematic backdrop — buildings, greens, water (behind the roads)
  drawAreas(ctx, view, map);

  // 1) asphalt: ALL casings first, then ALL surfaces in ONE uniform colour. Per-class tints made
  //    crossing roads show a visible seam where two different shades overlapped (Vlad's screenshot);
  //    a single surface colour blends seamlessly, and road hierarchy still reads through width.
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const e of vis) {
    path(ctx, view, e.geom);
    ctx.strokeStyle = "#0a0c11";
    ctx.lineWidth = e.width * zoom + 4;
    ctx.stroke();
  }
  ctx.strokeStyle = ASPHALT;
  for (const e of vis) {
    path(ctx, view, e.geom);
    ctx.lineWidth = Math.max(2, e.width * zoom);
    ctx.stroke();
  }

  // 1b) computed route — a glowing blue ribbon laid over the asphalt (under markings/signs/car),
  //     so the suggested path reads clearly while the lane markings still show through at the edges.
  if (route && route.length > 1) drawRoute(ctx, view, route, zoom);

  // 2) dashed centre line on two-way roads
  ctx.setLineDash([zoom * 1.4, zoom * 1.6]);
  ctx.strokeStyle = "rgba(235,205,90,.45)";
  ctx.lineWidth = Math.max(1, zoom * 0.12);
  for (const e of vis) {
    if (e.oneway || e.width < 5.5) continue;
    path(ctx, view, e.geom);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 2b) one-way arrows along the flow direction (geometry order = direction of travel)
  if (zoom >= 7) {
    ctx.strokeStyle = "rgba(150,188,250,.55)";
    ctx.lineWidth = Math.max(1.5, zoom * 0.12);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const e of vis) {
      if (e.oneway) drawOnewayArrows(ctx, view, e.geom, zoom);
    }
  }

  // 2c) stop lines — a white transverse bar across each approach to a controlled junction
  //     (a road marking, so it's drawn on the asphalt and rotates with the road).
  if (zoom >= 9) drawStopLines(ctx, view, vis, map.junctions, zoom);

  // 2d) pedestrian crossings — a zebra ladder laid square across the road (road marking).
  if (zoom >= 8) drawCrossings(ctx, view, map, zoom);

  // 3) signs — billboarded glyphs (STOP / give-way / signal / priority-road), placed per
  //    approach (explicit OSM tags + derived from road-class priority). Zoomed out, the few
  //    explicitly-controlled junctions still get a faint dot so they read on the overview.
  if (zoom >= 6) {
    const ss = Math.max(9, Math.min(26, zoom * 1.15));
    for (const s of map.signs) {
      if (!view.near(s.x, s.y, R)) continue;
      const [X, Y] = view.project(s.x, s.y);
      drawSign(ctx, X, Y, s.kind, ss);
    }
  } else {
    for (const j of map.junctions) {
      if (j.ctrl === "priority" || !view.near(j.x, j.y, R)) continue;
      const [X, Y] = view.project(j.x, j.y);
      ctx.beginPath(); ctx.arc(X, Y, Math.max(2, zoom * 0.5), 0, 7);
      ctx.fillStyle = j.ctrl === "signals" ? "#f6c453" : j.ctrl === "stop" ? "#e5484d" : "#5b9cff";
      ctx.fill();
    }
  }

  // 4) street-name labels ON the connecting roads at intersections (NOT the current
  //    street — that name lives in the HUD info block now). Shows the names of adjoining streets.
  drawStreetLabels(ctx, view, vis, rules && rules.street);

  // 5) the car — sprite (heading-up) or a heading-pointing arrow (north-up overview)
  drawCar(ctx, view, car);
}

// Label each visible street at the point ON the road nearest the car, so the name
// actually sits in view as you drive (segment-midpoint placement fell off-screen on
// long blocks). One label per name, closest instance wins.
function drawAreas(ctx, view, map) {
  const areas = map.areas;
  if (!areas || !areas.length) return;
  // group by kind so we batch fills (water/green under buildings)
  for (const kind of ["water", "green", "building"]) {
    ctx.fillStyle = AREA_FILL[kind];
    ctx.strokeStyle = AREA_STROKE[kind];
    ctx.lineWidth = 1;
    const stroke = (kind === "building" && view.zoom > 6) || kind === "water";   // water always gets a shore line
    for (const a of areas) {
      if (a.kind !== kind || !view.boxVisible(a.bb)) continue;
      ctx.beginPath();
      ringPath(ctx, view, a.poly);
      if (a.holes) for (const h of a.holes) ringPath(ctx, view, h);   // islands (e.g. Vltava) cut out via even-odd
      a.holes ? ctx.fill("evenodd") : ctx.fill();
      if (stroke) ctx.stroke();   // building outlines (zoomed in) + water shoreline
    }
  }
}

function ringPath(ctx, view, poly) {
  for (let i = 0; i < poly.length; i++) {
    const [X, Y] = view.project(poly[i][0], poly[i][1]);
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  }
  ctx.closePath();
}

// Route ribbon: two passes — a soft wide glow then a solid core — so the path reads on any
// background. Width is in metres (scales with zoom) but floored so it stays visible when far out.
function drawRoute(ctx, view, route, zoom) {
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  path(ctx, view, route);
  ctx.strokeStyle = "rgba(90,156,255,.28)";
  ctx.lineWidth = Math.max(7, zoom * 3.2);          // wide translucent glow
  ctx.stroke();
  path(ctx, view, route);
  ctx.strokeStyle = "rgba(96,165,255,.95)";
  ctx.lineWidth = Math.max(3, zoom * 1.1);          // bright solid core
  ctx.stroke();
  ctx.restore();
}

// One-way arrows: chevrons every ~STEP metres along the flow (geometry order = travel direction).
function drawOnewayArrows(ctx, view, geom, zoom) {
  const STEP = 14;                                       // metres between chevrons
  const half = Math.min(11, Math.max(3.5, zoom * 0.5));  // chevron arm length in px
  let nextAt = STEP * 0.5, dist = 0;
  for (let i = 1; i < geom.length; i++) {
    const ax = geom[i - 1][0], ay = geom[i - 1][1];
    const bx = geom[i][0], by = geom[i][1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg < 1e-6) continue;
    const dx = (bx - ax) / seg, dy = (by - ay) / seg;
    while (nextAt <= dist + seg) {
      const t = (nextAt - dist) / seg;
      drawChevron(ctx, view, ax + (bx - ax) * t, ay + (by - ay) * t, dx, dy, half);
      nextAt += STEP;
    }
    dist += seg;
  }
}

function drawChevron(ctx, view, wx, wy, dirx, diry, half) {
  const [sx, sy] = view.project(wx, wy);
  const c = Math.cos(view.rot), s = Math.sin(view.rot);
  const ux = dirx * c - diry * s, uy = -(dirx * s + diry * c);  // world dir → screen dir (unit)
  const px = -uy, py = ux;                                       // perpendicular
  const vx = sx + ux * half * 0.6, vy = sy + uy * half * 0.6;    // chevron vertex (points forward)
  ctx.beginPath();
  ctx.moveTo(vx - ux * half + px * half * 0.8, vy - uy * half + py * half * 0.8);
  ctx.lineTo(vx, vy);
  ctx.lineTo(vx - ux * half - px * half * 0.8, vy - uy * half - py * half * 0.8);
  ctx.stroke();
}

// Stop lines: a white bar across the road on each approach to a controlled junction. For every
// controlled junction we find the visible edges that touch it and lay a transverse bar a few
// metres in from that end (projected from world space, so it sits on the asphalt and turns with it).
function drawStopLines(ctx, view, vis, junctions, zoom) {
  const R = view.visR();
  ctx.save();
  ctx.strokeStyle = "rgba(236,239,246,.72)";
  ctx.lineCap = "butt";
  ctx.lineWidth = Math.max(2, zoom * 0.55);          // ~0.55 m thick
  for (const j of junctions) {
    if (j.ctrl === "priority" || !view.near(j.x, j.y, R)) continue;
    for (const e of vis) {
      const g = e.geom, last = g.length - 1;
      const atStart = Math.hypot(g[0][0] - j.x, g[0][1] - j.y) < 3.5;
      const atEnd = !atStart && Math.hypot(g[last][0] - j.x, g[last][1] - j.y) < 3.5;
      if (!atStart && !atEnd) continue;
      let L = 0;
      for (let i = 1; i < g.length; i++) L += Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]);
      const wp = walkAlong(g, atStart, Math.min(4, L * 0.4));   // a few m in from the junction
      const px = -wp.diry, py = wp.dirx;               // world-space perpendicular (unit)
      const half = Math.max(1.5, e.width / 2);
      const [ax, ay] = view.project(wp.x + px * half, wp.y + py * half);
      const [bx, by] = view.project(wp.x - px * half, wp.y - py * half);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }
  ctx.restore();
}

// Pedestrian crossings: a zebra ladder. Each crossing carries its centre, the road tangent
// (tx,ty) and the carriageway width; we lay white bars transverse to the road, repeated along
// the travel direction over a fixed depth. All corners are projected from world space, so the
// zebra sits on the asphalt and turns with the heading-up camera.
function drawCrossings(ctx, view, map, zoom) {
  const cr = map.crossings;
  if (!cr || !cr.length) return;
  const R = view.visR();
  const DEPTH = 4.0, BAR = 0.5, GAP = 0.5;          // metres: band depth along road, bar + gap
  ctx.save();
  ctx.fillStyle = "rgba(236,239,246,.80)";
  for (const c of cr) {
    if (!view.near(c.x, c.y, R)) continue;
    const tx = c.tx, ty = c.ty;                     // road tangent (unit) — bars run across this
    const px = -ty, py = tx;                        // across-road perpendicular
    const half = (c.w || 6) / 2 + 0.3;              // span kerb-to-kerb (+ small overhang)
    for (let s0 = -DEPTH / 2; s0 < DEPTH / 2 - 1e-6; s0 += BAR + GAP) {
      const sc = s0 + BAR / 2;                       // bar centre along the road
      const mx = c.x + tx * sc, my = c.y + ty * sc;
      const ax = tx * (BAR / 2), ay = ty * (BAR / 2);   // half-thickness along road
      const bx = px * half, by = py * half;             // half-width across road
      const pts = [[mx + ax + bx, my + ay + by], [mx + ax - bx, my + ay - by],
                   [mx - ax - bx, my - ay - by], [mx - ax + bx, my - ay + by]];
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const [X, Y] = view.project(pts[i][0], pts[i][1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// Junction control signs, drawn BILLBOARDED (axis-aligned in screen space, so they stay upright
// and readable no matter how the heading-up camera is rotated). `s` is the glyph half-size in px.
function drawSign(ctx, X, Y, kind, s) {
  ctx.save();
  ctx.lineJoin = "round";
  if (kind === "stop") drawStopSign(ctx, X, Y, s);
  else if (kind === "give_way") drawYieldSign(ctx, X, Y, s);
  else if (kind === "signal" || kind === "signals") drawSignal(ctx, X, Y, s);
  else if (kind === "priority_road") drawPriorityRoad(ctx, X, Y, s);
  ctx.restore();
}

// "Hlavní pozemní komunikace" (priority road) — yellow diamond with a white border.
function drawPriorityRoad(ctx, X, Y, s) {
  const r = s * 1.02;
  ctx.beginPath();
  ctx.moveTo(X, Y - r); ctx.lineTo(X + r, Y); ctx.lineTo(X, Y + r); ctx.lineTo(X - r, Y);
  ctx.closePath();
  ctx.fillStyle = "#f4c20d"; ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.16); ctx.strokeStyle = "#fff"; ctx.stroke();
}

function drawStopSign(ctx, X, Y, s) {
  ctx.beginPath();                                   // red octagon (flat top + bottom)
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    const px = X + s * Math.cos(a), py = Y + s * Math.sin(a);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#d2231f"; ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.12); ctx.strokeStyle = "#fff"; ctx.stroke();
  if (s >= 18) {                                     // only legible once zoomed in close
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.round(s * 0.5)}px ui-sans-serif,system-ui,sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("STOP", X, Y + s * 0.05);
  }
}

function drawYieldSign(ctx, X, Y, s) {
  const r = s * 1.15;                                // downward equilateral triangle, white + red rim
  ctx.beginPath();
  ctx.moveTo(X, Y + r);                              // bottom point
  ctx.lineTo(X - r * 0.866, Y - r * 0.5);            // top-left
  ctx.lineTo(X + r * 0.866, Y - r * 0.5);            // top-right
  ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.lineWidth = Math.max(1.2, s * 0.22); ctx.strokeStyle = "#d2231f"; ctx.stroke();
}

function drawSignal(ctx, X, Y, s) {
  const w = s * 0.95, h = s * 2.1;                   // dark housing + three lights (red/amber/green)
  roundRect(ctx, X - w / 2, Y - h / 2, w, h, w * 0.32);
  ctx.fillStyle = "#15181f"; ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.1); ctx.strokeStyle = "#39404e"; ctx.stroke();
  const rr = w * 0.3, cols = ["#e5484d", "#f6c453", "#34d399"];
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(X, Y - h * 0.30 + i * h * 0.30, rr, 0, 7);
    ctx.fillStyle = cols[i]; ctx.fill();
  }
}

// Labels for the ADJOINING streets — placed AT THE START of each cross street (a short way
// into the street itself, running along it), not across the current road. The current street's
// name lives in the HUD info block. One label per name, nearest junction wins.
function drawStreetLabels(ctx, view, vis, currentStreet) {
  if (view.zoom < 8) return;                  // too zoomed out to be legible/useful
  const cx = view.cx, cy = view.cy;           // camera centre = car, in world metres
  const NEAR = 55 * 55;                        // the cross street's junction with us must be within ~55 m
  const INSET = 20;                            // place the label ~20 m into the adjoining street
  const byName = new Map();
  for (const e of vis) {
    if (!e.name || e.name === currentStreet) continue;
    const g = e.geom;
    const d0 = (g[0][0] - cx) ** 2 + (g[0][1] - cy) ** 2;
    const dN = (g[g.length - 1][0] - cx) ** 2 + (g[g.length - 1][1] - cy) ** 2;
    const nearD = Math.min(d0, dN);
    if (nearD > NEAR) continue;               // only streets whose junction with us is here
    const p = walkAlong(g, d0 <= dN, INSET);  // step into the street from its near (junction) end
    const prev = byName.get(e.name);
    if (!prev || nearD < prev.nearD) byName.set(e.name, { ...p, name: e.name, nearD });
  }
  ctx.font = "600 12px ui-sans-serif,system-ui,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const L of byName.values()) {
    const [sx, sy] = view.project(L.x, L.y);
    // direction in screen space so text runs along the cross street. project() rotates by
    // camera rot then flips y (canvas y grows down): sdx = dx·c − dy·s, sdy = −(dx·s + dy·c).
    const a = view.rot, c = Math.cos(a), s = Math.sin(a);
    let ang = Math.atan2(-(L.dirx * s + L.diry * c), L.dirx * c - L.diry * s);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI; // keep upright
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,12,17,.75)";
    ctx.strokeText(L.name, 0, 0);             // halo for legibility on asphalt
    ctx.fillStyle = "rgba(210,220,236,.82)";
    ctx.fillText(L.name, 0, 0);
    ctx.restore();
  }
}

// Walk `dist` metres along a polyline from one end; returns the point + local direction
// (pointing INTO the street, away from the starting end).
function walkAlong(geom, fromStart, dist) {
  const idx = fromStart ? geom.map((_, i) => i) : geom.map((_, i) => geom.length - 1 - i);
  let remain = dist;
  for (let k = 1; k < idx.length; k++) {
    const a = geom[idx[k - 1]], b = geom[idx[k]];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const L = Math.hypot(ex, ey);
    if (L < 1e-6) continue;
    if (remain <= L) {
      const t = remain / L;
      return { x: a[0] + ex * t, y: a[1] + ey * t, dirx: ex / L, diry: ey / L };
    }
    remain -= L;
  }
  // edge shorter than dist → far end + last segment direction
  const a = geom[idx[idx.length - 2]], b = geom[idx[idx.length - 1]];
  const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
  return { x: b[0], y: b[1], dirx: ex / L, diry: ey / L };
}

// Stylized top-down car (nose-up: forward = −y). Below ~5 px/m it becomes a fixed-size
// arrow for the bird's-eye overview mode (otherwise the real-scale car is a sub-pixel dot).
function drawCar(ctx, view, car) {
  const [X, Y] = view.anchor();
  if (view.zoom < 5) {
    // arrow pointing along the heading in the current camera frame (north-up in overview)
    const c = Math.cos(view.rot), s = Math.sin(view.rot);
    const ux = Math.cos(car.h) * c - Math.sin(car.h) * s;
    const uy = -(Math.cos(car.h) * s + Math.sin(car.h) * c);
    drawCarArrow(ctx, X, Y, ux, uy);
    return;
  }
  const L = P.length * view.zoom, W = P.width * view.zoom;
  const r = (x, y, w, h, rad) => roundRect(ctx, x, y, w, h, rad);
  ctx.save();
  ctx.translate(X, Y);

  // wheels (drawn under the body, poking out at the sides)
  const wl = L * 0.20, ww = W * 0.16, wx = W * 0.5 - ww * 0.35;
  ctx.fillStyle = "#15181f";
  for (const sy of [-L * 0.30, L * 0.30]) {      // front & rear axles
    for (const sx of [-wx, wx - ww]) {           // left & right
      r(sx, sy - wl / 2, ww, wl, ww * 0.35);
      ctx.fill();
    }
  }

  // body
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
  const grad = ctx.createLinearGradient(0, -L / 2, 0, L / 2);
  grad.addColorStop(0, "#6fa8ff"); grad.addColorStop(1, "#4a86e6");
  r(-W / 2, -L / 2, W, L, Math.min(L, W) * 0.30);
  ctx.fillStyle = grad; ctx.fill();
  ctx.shadowBlur = 0;
  // subtle body outline
  ctx.lineWidth = Math.max(1, W * 0.04); ctx.strokeStyle = "rgba(10,14,22,.5)"; ctx.stroke();

  // cabin (roof) — darker, toward the middle
  r(-W * 0.34, -L * 0.10, W * 0.68, L * 0.42, W * 0.16);
  ctx.fillStyle = "#39557f"; ctx.fill();
  // windshield (front of cabin) + rear window — glass
  ctx.fillStyle = "rgba(12,16,24,.88)";
  r(-W * 0.30, -L * 0.10 - L * 0.085, W * 0.60, L * 0.10, 2); ctx.fill();  // windshield
  r(-W * 0.27, L * 0.30, W * 0.54, L * 0.075, 2); ctx.fill();              // rear window

  // headlights (front) & taillights (rear)
  ctx.fillStyle = "#fff3c4";
  r(-W * 0.42, -L / 2 + L * 0.015, W * 0.20, L * 0.05, 1.5); ctx.fill();
  r(W * 0.22, -L / 2 + L * 0.015, W * 0.20, L * 0.05, 1.5); ctx.fill();
  ctx.fillStyle = "#e5484d";
  r(-W * 0.40, L / 2 - L * 0.05, W * 0.18, L * 0.035, 1.5); ctx.fill();
  r(W * 0.22, L / 2 - L * 0.05, W * 0.18, L * 0.035, 1.5); ctx.fill();

  ctx.restore();
}

// fixed-size arrow for overview mode, pointing along the screen unit vector (ux,uy)
function drawCarArrow(ctx, X, Y, ux, uy) {
  const r = 13;
  const px = -uy, py = ux;                 // perpendicular
  ctx.save();
  ctx.translate(X, Y);
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(ux * r, uy * r);                                  // tip (forward)
  ctx.lineTo(-ux * r * 0.8 + px * r * 0.72, -uy * r * 0.8 + py * r * 0.72);
  ctx.lineTo(-ux * r * 0.4, -uy * r * 0.4);                    // tail notch
  ctx.lineTo(-ux * r * 0.8 - px * r * 0.72, -uy * r * 0.8 - py * r * 0.72);
  ctx.closePath();
  ctx.fillStyle = "#5b9cff"; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(10,14,22,.6)"; ctx.stroke();
  ctx.restore();
}
