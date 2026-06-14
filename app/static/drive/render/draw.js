// Top-down canvas renderer: road surfaces, lane markings, junctions, the car.
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
    const X = view.sx(geom[i][0]), Y = view.sy(geom[i][1]);
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  }
}

export function draw(ctx, view, map, car) {
  const { w, h, dpr, zoom } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const vis = map.edges.filter((e) => e.geom.some((p) => view.onScreen(p[0], p[1])));

  // 1) asphalt (slightly darker casing under, then surface)
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const e of vis) {
    path(ctx, view, e.geom);
    ctx.strokeStyle = "#0a0c11";
    ctx.lineWidth = Math.max(3, e.width * zoom + 3);
    ctx.stroke();
  }
  for (const e of vis) {
    path(ctx, view, e.geom);
    ctx.strokeStyle = CLASS_TINT[e.cls] || ASPHALT;
    ctx.lineWidth = Math.max(2, e.width * zoom);
    ctx.stroke();
  }

  // 2) centre line (two-way) + edge of road hint
  if (zoom > 3) {
    ctx.setLineDash([zoom * 1.6, zoom * 1.8]);
    ctx.strokeStyle = "rgba(235,205,90,.5)";
    ctx.lineWidth = Math.max(1, zoom * 0.18);
    for (const e of vis) {
      if (e.oneway || e.width < 5.5) continue;
      path(ctx, view, e.geom);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 3) junctions with explicit control (signals/stop/give_way)
  for (const j of map.junctions) {
    if (j.ctrl === "priority" || !view.onScreen(j.x, j.y)) continue;
    const X = view.sx(j.x), Y = view.sy(j.y);
    ctx.beginPath(); ctx.arc(X, Y, Math.max(2.5, zoom * 0.7), 0, 7);
    ctx.fillStyle = j.ctrl === "signals" ? "#f6c453" : j.ctrl === "stop" ? "#e5484d" : "#5b9cff";
    ctx.fill();
  }

  drawCar(ctx, view, car);
}

function drawCar(ctx, view, car) {
  const X = view.sx(car.x), Y = view.sy(car.y);
  const L = P.length * view.zoom, W = P.width * view.zoom;
  ctx.save();
  ctx.translate(X, Y);
  ctx.rotate(-car.h);            // local +x = forward
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
  roundRect(ctx, -L / 2, -W / 2, L, W, Math.min(L, W) * 0.28);
  ctx.fillStyle = car.blocked ? "#d76b6b" : "#5b9cff";
  ctx.fill();
  ctx.shadowBlur = 0;
  // windshield toward front
  roundRect(ctx, L * 0.08, -W * 0.34, L * 0.22, W * 0.68, 2);
  ctx.fillStyle = "rgba(12,16,24,.85)";
  ctx.fill();
  ctx.restore();
}
