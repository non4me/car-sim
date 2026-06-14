// Top-down renderer with a heading-up (rotating) camera. Roads, lane markings,
// junction control, subtle street-name labels on the roads, and the nose-up car.
import { PARAMS as P } from "../vehicle/params.js";

const BG = "#0e1118";
const ASPHALT = "#2c333f";
const CLASS_TINT = {
  motorway: "#48525f", trunk: "#444e5c", primary: "#3e4654",
  secondary: "#39414e", tertiary: "#343c48",
};

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

export function draw(ctx, view, map, car) {
  const { w, h, dpr, zoom } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const R = view.visR();
  const vis = map.edges.filter((e) => view.boxVisible(e.bb));

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

  // 4) street-name labels ON the roads (subtle), one per name nearest the car
  drawStreetLabels(ctx, view, vis);

  // 5) the car — always nose-up at the anchor
  drawCar(ctx, view);
}

function drawStreetLabels(ctx, view, vis) {
  const zoom = view.zoom;
  if (zoom < 8) return;                       // too zoomed out to be legible/useful
  const [acx, acy] = view.anchor();
  const byName = new Map();
  for (const e of vis) {
    if (!e.name) continue;
    // longest segment of this edge
    let bi = 1, bl = 0;
    for (let i = 1; i < e.geom.length; i++) {
      const L = Math.hypot(e.geom[i][0] - e.geom[i - 1][0], e.geom[i][1] - e.geom[i - 1][1]);
      if (L > bl) { bl = L; bi = i; }
    }
    if (bl * zoom < 70) continue;             // segment too short on screen to label
    const a = e.geom[bi - 1], b = e.geom[bi];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [sx, sy] = view.project(mid[0], mid[1]);
    const d = (sx - acx) ** 2 + (sy - acy) ** 2;
    const prev = byName.get(e.name);
    if (!prev || d < prev.d) byName.set(e.name, { a, b, sx, sy, d, name: e.name });
  }
  ctx.font = "600 12px ui-sans-serif,system-ui,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const L of byName.values()) {
    const [ax, ay] = view.project(L.a[0], L.a[1]);
    const [bx, by] = view.project(L.b[0], L.b[1]);
    let ang = Math.atan2(by - ay, bx - ax);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI; // keep upright
    ctx.save();
    ctx.translate(L.sx, L.sy);
    ctx.rotate(ang);
    ctx.fillStyle = "rgba(220,228,242,.5)";
    ctx.fillText(L.name, 0, 0);
    ctx.restore();
  }
}

function drawCar(ctx, view) {
  const [X, Y] = view.anchor();
  const L = P.length * view.zoom, W = P.width * view.zoom;
  ctx.save();
  ctx.translate(X, Y);                        // nose-up: forward = -y (screen up)
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
  roundRect(ctx, -W / 2, -L / 2, W, L, Math.min(L, W) * 0.28);
  ctx.fillStyle = "#5b9cff";
  ctx.fill();
  ctx.shadowBlur = 0;
  // windshield toward the front (top)
  roundRect(ctx, -W * 0.34, -L / 2 + L * 0.08, W * 0.68, L * 0.22, 2);
  ctx.fillStyle = "rgba(12,16,24,.85)";
  ctx.fill();
  ctx.restore();
}
