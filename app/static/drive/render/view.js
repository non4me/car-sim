// World↔screen camera. World is in metres, y north-positive; screen y is down.
export function makeView(canvas) {
  const v = { cx: 0, cy: 0, zoom: 6.5, w: 0, h: 0, dpr: 1, canvas };
  v.resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    v.dpr = dpr;
    v.w = canvas.clientWidth; v.h = canvas.clientHeight;
    canvas.width = Math.round(v.w * dpr);
    canvas.height = Math.round(v.h * dpr);
  };
  v.sx = (wx) => (wx - v.cx) * v.zoom + v.w / 2;
  v.sy = (wy) => v.h / 2 - (wy - v.cy) * v.zoom;
  v.follow = (x, y) => { v.cx = x; v.cy = y; };
  v.onScreen = (wx, wy, margin = 60) =>
    wx > v.cx - (v.w / 2 + margin) / v.zoom && wx < v.cx + (v.w / 2 + margin) / v.zoom &&
    wy > v.cy - (v.h / 2 + margin) / v.zoom && wy < v.cy + (v.h / 2 + margin) / v.zoom;
  return v;
}
