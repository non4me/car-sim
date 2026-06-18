// Procedural Canvas-2D renderer for the schematic top-down scene. All shapes drawn
// in metres, mapped to px via the view. No external assets.
import { V } from "./world.js";

const ASPHALT = "#2a2f3c", MARK = "#e8edf6", MARK_DIM = "#9aa3b2";
const RAIL = "#525a6b";

function line(ctx, view, a, b, wMetres, color, dash) {
  ctx.beginPath();
  ctx.lineWidth = Math.max(1, view.s(wMetres));
  ctx.strokeStyle = color;
  ctx.setLineDash(dash ? dash.map((d) => view.s(d)) : []);
  ctx.moveTo(view.sx(a[0]), view.sy(a[1]));
  ctx.lineTo(view.sx(b[0]), view.sy(b[1]));
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawStatic(ctx, view, jun) {
  // asphalt arms
  ctx.lineCap = "butt";
  for (const r of jun.roads) line(ctx, view, r.a, r.b, r.halfW * 2, ASPHALT);
  // central junction square so the cross fills cleanly
  const R = jun.roadHalf;
  ctx.fillStyle = ASPHALT;
  ctx.fillRect(view.sx(jun.C[0] - R), view.sy(jun.C[1] - R), view.s(R * 2), view.s(R * 2));

  // outer edge lines (V1a solid)
  for (const e of jun.edges) line(ctx, view, e.a, e.b, 0.15, MARK_DIM);
  // centre lines (V2a dashed)
  for (const c of jun.centerlines) line(ctx, view, c.a, c.b, 0.18, MARK_DIM, [2.2, 2.2]);

  // tram rails + sleepers
  if (jun.rails) {
    polyline(ctx, view, jun.rails.a, 0.18, RAIL);
    polyline(ctx, view, jun.rails.b, 0.18, RAIL);
    const c = jun.rails.center;
    for (let i = 1; i < c.length; i++) {
      const seg = 12;
      for (let k = 0; k <= seg; k++) {
        const p = V.lerp(c[i - 1], c[i], k / seg);
        const dir = V.norm(V.sub(c[i], c[i - 1])), perp = V.right(dir);
        line(ctx, view, V.add(p, V.mul(perp, 0.95)), V.add(p, V.mul(perp, -0.95)), 0.1, RAIL);
      }
    }
  }

  // pedestrian crossings (zebra)
  for (const z of jun.zebras) drawZebra(ctx, view, z);

  // stop / give-way lines
  for (const s of jun.stopLines) {
    if (s.kind === "give") line(ctx, view, s.a, s.b, 0.4, MARK, [0.7, 0.7]);
    else line(ctx, view, s.a, s.b, 0.55, MARK); // stop / lights
  }

  // signs
  for (const sg of jun.signs) drawSign(ctx, view, sg.code, sg.pos);
}

// Renderer for an authored REAL junction (scene.js output). Reuses the same primitives as
// drawStatic but takes arbitrary-geometry roads (centreline + width) instead of symmetric arms.
export function drawScene(ctx, view, sc) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // asphalt: a thick round-capped stroke per centreline; overlaps merge into a clean junction
  for (const r of sc.roads) polyline(ctx, view, r.centerline, r.halfW * 2, ASPHALT);
  // kerb lines (V1a) + dashed lane dividers (V2a)
  for (const e of sc.edges) polyline(ctx, view, e, 0.15, MARK_DIM);
  for (const c of sc.centerlines) polyline(ctx, view, c, 0.18, MARK_DIM, [2.4, 2.4]);
  // mask markings inside the open junction (kerb/centre lines stop at the intersection)
  if (sc.core) {
    ctx.fillStyle = ASPHALT;
    ctx.beginPath(); ctx.arc(view.sx(sc.core.pos[0]), view.sy(sc.core.pos[1]), view.s(sc.core.r), 0, 7); ctx.fill();
  }
  // tram tracks (drawn after the mask so rails continue through the junction)
  for (const rail of sc.rails) drawRail(ctx, view, rail);
  // pedestrian crossings
  for (const z of sc.zebras) drawZebra(ctx, view, z);
  // stop / give-way lines
  for (const s of sc.stopLines) {
    if (s.kind === "give") line(ctx, view, s.a, s.b, 0.4, MARK, [0.7, 0.7]);
    else line(ctx, view, s.a, s.b, 0.55, MARK);
  }
  // lane arrows + street labels
  for (const a of sc.arrows) drawArrow(ctx, view, a);
  for (const l of sc.labels) drawLabel(ctx, view, l);
  // upright signs (drawn last, on top)
  for (const sg of sc.signs) drawSign(ctx, view, sg.code, sg.pos);
}

function drawRail(ctx, view, c) {
  const OFF = 0.7;
  polyline(ctx, view, c.map((p, i) => railOffset(c, i, OFF)), 0.18, RAIL);
  polyline(ctx, view, c.map((p, i) => railOffset(c, i, -OFF)), 0.18, RAIL);
  for (let i = 1; i < c.length; i++) {                 // sleepers
    const seg = Math.max(2, Math.round(V.dist(c[i - 1], c[i]) / 2));
    for (let k = 0; k <= seg; k++) {
      const p = V.lerp(c[i - 1], c[i], k / seg);
      const perp = V.right(V.norm(V.sub(c[i], c[i - 1])));
      line(ctx, view, V.add(p, V.mul(perp, 0.95)), V.add(p, V.mul(perp, -0.95)), 0.1, RAIL);
    }
  }
}
function railOffset(c, i, d) {
  const dir = i < c.length - 1 ? V.norm(V.sub(c[i + 1], c[i])) : V.norm(V.sub(c[i], c[i - 1]));
  return V.add(c[i], V.mul(V.right(dir), d));
}

function drawArrow(ctx, view, a) {
  const ang = Math.atan2(a.dir[1], a.dir[0]);
  ctx.save();
  ctx.translate(view.sx(a.pos[0]), view.sy(a.pos[1]));
  ctx.rotate(ang);
  ctx.strokeStyle = MARK; ctx.fillStyle = MARK;
  ctx.lineWidth = Math.max(2, view.s(0.32)); ctx.lineCap = "round"; ctx.lineJoin = "round";
  const L = view.s(2.6), head = view.s(0.85), bend = view.s(1.2);
  ctx.beginPath();
  if (a.kind === "left" || a.kind === "right") {
    const s = a.kind === "left" ? -1 : 1;             // y-down: right turn bends +y
    ctx.moveTo(-L / 2, 0); ctx.lineTo(L * 0.18, 0); ctx.lineTo(L * 0.18, s * bend);
    ctx.stroke();
    arrowHead(ctx, [L * 0.18, s * bend], s > 0 ? Math.PI / 2 : -Math.PI / 2, head);
  } else {
    ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.stroke();
    arrowHead(ctx, [L / 2, 0], 0, head);
  }
  ctx.restore();
}
function arrowHead(ctx, tip, ang, h) {
  ctx.save(); ctx.translate(tip[0], tip[1]); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-h, -h * 0.7); ctx.lineTo(-h, h * 0.7); ctx.closePath();
  ctx.fill(); ctx.restore();
}

function drawLabel(ctx, view, l) {
  ctx.save();
  ctx.translate(view.sx(l.pos[0]), view.sy(l.pos[1]));
  if (l.rot) ctx.rotate(l.rot);
  ctx.fillStyle = "rgba(154,163,178,.85)";
  ctx.font = `600 ${Math.max(9, Math.round(view.s(2.0)))}px ui-sans-serif, system-ui`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(l.text, 0, 0);
  ctx.restore();
}

function polyline(ctx, view, pts, w, color, dash) {
  ctx.beginPath();
  ctx.lineWidth = Math.max(1, view.s(w));
  ctx.strokeStyle = color;
  ctx.setLineDash(dash ? dash.map((d) => view.s(d)) : []);
  ctx.moveTo(view.sx(pts[0][0]), view.sy(pts[0][1]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(view.sx(pts[i][0]), view.sy(pts[i][1]));
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawZebra(ctx, view, z) {
  const along = z.dir, perp = z.perp;
  ctx.fillStyle = MARK;
  for (let i = -3; i <= 3; i++) {
    const c = V.add(z.center, V.mul(perp, i * 0.9));
    const a = V.add(c, V.mul(along, 1.2)), b = V.sub(c, V.mul(along, 1.2));
    line(ctx, view, a, b, 0.55, MARK);
  }
}

// --- vector sign icons (schematic) ---
function poly(ctx, pts, fill, stroke, lw) {
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
}

export function drawSign(ctx, view, code, pos) {
  const x = view.sx(pos[0]), y = view.sy(pos[1]);
  const r = Math.max(10, view.s(1.7));
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = "round";
  const reg = (a) => [Math.cos(a) * r, Math.sin(a) * r];
  switch (code) {
    case "P2": case "P1": { // priority road — yellow diamond
      poly(ctx, [[0, -r], [r, 0], [0, r], [-r, 0]], "#f5c518", "#fff", Math.max(2, r * 0.16));
      ctx.fillStyle = "#1b1b1b"; poly(ctx, [[0, -r * 0.45], [r * 0.45, 0], [0, r * 0.45], [-r * 0.45, 0]], "#fff");
      break;
    }
    case "P4": { // give way — inverted triangle
      poly(ctx, [[0, r], [r, -r * 0.85], [-r, -r * 0.85]], "#fff", "#e11", Math.max(2.5, r * 0.22));
      break;
    }
    case "P6": { // STOP — red octagon
      const o = []; for (let i = 0; i < 8; i++) o.push(reg(Math.PI / 8 + i * Math.PI / 4));
      poly(ctx, o, "#d11", "#fff", Math.max(2, r * 0.14));
      ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(r * 0.66)}px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("STOP", 0, 1);
      break;
    }
    case "A11": case "A25": case "A12b": { // warning — red triangle
      poly(ctx, [[0, -r], [r, r * 0.8], [-r, r * 0.8]], "#fff", "#e11", Math.max(2.5, r * 0.2));
      ctx.fillStyle = "#111";
      if (code === "A11") { ctx.font = `${Math.round(r)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🚶", 0, r * 0.1); }
      if (code === "A25") { ctx.fillRect(-r * 0.3, -r * 0.25, r * 0.6, r * 0.6); }
      break;
    }
    case "B2": { // no entry — red circle white bar
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = "#d11"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, r * 0.12); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillRect(-r * 0.6, -r * 0.18, r * 1.2, r * 0.36);
      break;
    }
    case "C1": { // roundabout — blue circle, arrows
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = "#1565c0"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, r * 0.2);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0.6, 5.4); ctx.stroke();
      break;
    }
    default: { // speed limit B20a "30/50/90" style or generic
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.strokeStyle = "#d11"; ctx.lineWidth = Math.max(2, r * 0.18); ctx.stroke();
      const num = code && code.startsWith("B20") ? (code.split(":")[1] || "50") : "";
      if (num) { ctx.fillStyle = "#111"; ctx.font = `bold ${Math.round(r * 0.8)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(num, 0, 1); }
    }
  }
  ctx.restore();
}

const CAR_L = 4.4, CAR_W = 1.9, TRAM_L = 14, TRAM_W = 2.4;

export function drawAgent(ctx, view, ag) {
  const x = view.sx(ag.pos[0]), y = view.sy(ag.pos[1]);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ag.angle + Math.PI / 2); // sprites drawn pointing "up"
  if (ag.kind === "ped") {
    ctx.fillStyle = ag.color || "#fbbf24";
    ctx.beginPath(); ctx.arc(0, 0, Math.max(3, view.s(0.5)), 0, 7); ctx.fill();
  } else {
    const L = ag.kind === "tram" ? TRAM_L : CAR_L;
    const W = ag.kind === "tram" ? TRAM_W : CAR_W;
    roundRect(ctx, -view.s(W) / 2, -view.s(L) / 2, view.s(W), view.s(L), view.s(0.5));
    ctx.fillStyle = ag.color; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1; ctx.stroke();
    // windshield hint (front)
    ctx.fillStyle = "rgba(255,255,255,.25)";
    ctx.fillRect(-view.s(W) / 2 + 2, -view.s(L) / 2 + 2, view.s(W) - 4, view.s(L) * 0.22);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { CAR_L, CAR_W };
