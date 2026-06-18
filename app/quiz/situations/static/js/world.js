// World↔screen coordinate transform. World units are METRES; the camera fits the
// whole scenario world into the canvas with a margin. Single source of scale → no
// ad-hoc transforms elsewhere (the #1 top-down rendering bug source).

export function makeView(canvasW, canvasH, worldW, worldH, margin = 0.06) {
  const availW = canvasW * (1 - 2 * margin);
  const availH = canvasH * (1 - 2 * margin);
  const scale = Math.min(availW / worldW, availH / worldH); // px per metre
  const ox = (canvasW - worldW * scale) / 2;
  const oy = (canvasH - worldH * scale) / 2;
  return {
    scale, ox, oy, worldW, worldH,
    sx: (x) => ox + x * scale,
    sy: (y) => oy + y * scale,
    s: (m) => m * scale,           // a length in metres → px
  };
}

// Fit an arbitrary metric bounding box [minx,miny,maxx,maxy] into the canvas. Real
// junctions are authored in a centre-origin frame (negative coords), so unlike makeView
// (which assumes a 0..W box) we offset by the bbox min. Single source of scale.
export function makeViewBounds(canvasW, canvasH, bbox, margin = 0.08) {
  const [minx, miny, maxx, maxy] = bbox;
  const wW = Math.max(1, maxx - minx), wH = Math.max(1, maxy - miny);
  const availW = canvasW * (1 - 2 * margin), availH = canvasH * (1 - 2 * margin);
  const scale = Math.min(availW / wW, availH / wH);          // px per metre
  const ox = (canvasW - wW * scale) / 2 - minx * scale;
  const oy = (canvasH - wH * scale) / 2 - miny * scale;
  return {
    scale, ox, oy,
    sx: (x) => ox + x * scale,
    sy: (y) => oy + y * scale,
    s: (m) => m * scale,
  };
}

// --- small 2D vector helpers (plain [x,y] arrays, metres) ---
export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  len: (a) => Math.hypot(a[0], a[1]),
  norm: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  // rotate +90° clockwise in a y-DOWN frame → "right of heading"
  right: (h) => [-h[1], h[0]],
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
};

// arc-length resample of a polyline into a dense list of points, so agents can
// move at a constant metres/second regardless of segment lengths.
export function densify(points, step = 0.5) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const d = V.dist(a, b);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) out.push(V.lerp(a, b, k / n));
  }
  return out;
}

// total length of a polyline
export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += V.dist(pts[i - 1], pts[i]);
  return L;
}
