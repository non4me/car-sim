// Top-down renderer with a heading-up (rotating) camera. Roads, lane markings,
// junction control, subtle street-name labels on the roads, and the nose-up car.
import { PARAMS as P } from "../vehicle/params.js";

const BG = "#0e1118";
const ASPHALT = "#2c333f";
const CLASS_TINT = {
  motorway: "#48525f", trunk: "#444e5c", primary: "#3e4654",
  secondary: "#39414e", tertiary: "#343c48",
};
// schematic backdrop fills (drawn behind the roads). Buildings get a brighter edge so
// the block structure reads like a city map; roads stay the lightest (drivable) layer.
const AREA_FILL = { building: "#232a3a", green: "#1f3327", water: "#173757" };
const AREA_STROKE = { building: "#46526b", green: "#335039", water: "#2c577a" };

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

export function draw(ctx, view, map, car, rules) {
  const { w, h, dpr, zoom } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const R = view.visR();
  const vis = map.edges.filter((e) => view.boxVisible(e.bb));

  // 0) schematic backdrop — buildings, greens, water (behind the roads)
  drawAreas(ctx, view, map);

  // 1) asphalt (casing then surface)
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const e of vis) {
    path(ctx, view, e.geom);
    ctx.strokeStyle = "#0a0c11";
    ctx.lineWidth = e.width * zoom + 4;
    ctx.stroke();
  }
  for (const e of vis) {
    path(ctx, view, e.geom);
    ctx.strokeStyle = CLASS_TINT[e.cls] || ASPHALT;
    ctx.lineWidth = Math.max(2, e.width * zoom);
    ctx.stroke();
  }

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

  // 3) junction control dots
  for (const j of map.junctions) {
    if (j.ctrl === "priority" || !view.near(j.x, j.y, R)) continue;
    const [X, Y] = view.project(j.x, j.y);
    ctx.beginPath(); ctx.arc(X, Y, Math.max(2.5, zoom * 0.5), 0, 7);
    ctx.fillStyle = j.ctrl === "signals" ? "#f6c453" : j.ctrl === "stop" ? "#e5484d" : "#5b9cff";
    ctx.fill();
  }

  // 4) street-name labels ON the connecting roads at intersections (NOT the current
  //    street — that name lives in the HUD info block now). Shows the names of adjoining streets.
  drawStreetLabels(ctx, view, vis, rules && rules.street);

  // 5) the car — always nose-up at the anchor
  drawCar(ctx, view);
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
    const stroke = kind === "building" && view.zoom > 6;
    for (const a of areas) {
      if (a.kind !== kind || !view.boxVisible(a.bb)) continue;
      ctx.beginPath();
      for (let i = 0; i < a.poly.length; i++) {
        const [X, Y] = view.project(a.poly[i][0], a.poly[i][1]);
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
      ctx.closePath();
      ctx.fill();
      if (stroke) ctx.stroke();   // crisp building outlines when zoomed in
    }
  }
}

// Labels for the ADJOINING streets at intersections — every visible named street EXCEPT
// the one the car is on (that name is shown in the HUD info block). One per name, nearest
// instance, only within range so it reads as "the cross street here is X".
function drawStreetLabels(ctx, view, vis, currentStreet) {
  const zoom = view.zoom;
  if (zoom < 8) return;                       // too zoomed out to be legible/useful
  const cx = view.cx, cy = view.cy;           // camera centre = car, in world metres
  const MAXD = 90 * 90;                        // only label cross streets within ~90 m
  const byName = new Map();
  for (const e of vis) {
    if (!e.name || e.name === currentStreet) continue;   // skip the current street
    // nearest point on this edge's polyline to the car, plus that segment's direction
    let bd = Infinity, bx = 0, by = 0, dirx = 1, diry = 0;
    for (let i = 1; i < e.geom.length; i++) {
      const ax = e.geom[i - 1][0], ay = e.geom[i - 1][1];
      const gx = e.geom[i][0], gy = e.geom[i][1];
      const ex = gx - ax, ey = gy - ay, l2 = ex * ex + ey * ey || 1;
      let t = ((cx - ax) * ex + (cy - ay) * ey) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * ex, py = ay + t * ey;
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d < bd) { bd = d; bx = px; by = py; dirx = ex; diry = ey; }
    }
    if (bd > MAXD) continue;
    const prev = byName.get(e.name);
    if (!prev || bd < prev.bd) byName.set(e.name, { bd, bx, by, dirx, diry, name: e.name });
  }
  ctx.font = "600 12px ui-sans-serif,system-ui,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const L of byName.values()) {
    const [sx, sy] = view.project(L.bx, L.by);
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
    ctx.fillStyle = "rgba(210,220,236,.78)";
    ctx.fillText(L.name, 0, 0);
    ctx.restore();
  }
}

// Stylized top-down car (nose-up: forward = −y). Body + cabin/glass + wheels + lights.
function drawCar(ctx, view) {
  const [X, Y] = view.anchor();
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
