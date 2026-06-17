// Heading-up camera: the car is always drawn nose-up; the MAP rotates around it.
// World is metres, y north-positive. project() maps world→screen with rotation+zoom.
export function makeView(canvas) {
  const v = {
    cx: 0, cy: 0, rot: 0, zoom: 40, w: 0, h: 0, dpr: 1,
    anchorY: 0.68,          // car sits lower so you see more road ahead
    userMul: 1,             // mouse-wheel zoom bias
    canvas,
  };
  v.resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    v.dpr = dpr;
    v.w = canvas.clientWidth; v.h = canvas.clientHeight;
    canvas.width = Math.round(v.w * dpr);
    canvas.height = Math.round(v.h * dpr);
  };
  // place camera on the car and rotate so the car's heading points up on screen
  v.setCamera = (cx, cy, heading) => { v.cx = cx; v.cy = cy; v.rot = Math.PI / 2 - heading; };
  v.project = (wx, wy) => {
    const dx = wx - v.cx, dy = wy - v.cy;
    const c = Math.cos(v.rot), s = Math.sin(v.rot);
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return [v.w / 2 + rx * v.zoom, v.h * v.anchorY - ry * v.zoom];
  };
  // screen px → world metres (inverse of project): used by the free-look pan/orbit + double-click snap.
  v.unproject = (sx, sy) => {
    const rx = (sx - v.w / 2) / v.zoom, ry = (v.h * v.anchorY - sy) / v.zoom;
    const c = Math.cos(v.rot), s = Math.sin(v.rot);
    return [v.cx + rx * c + ry * s, v.cy - rx * s + ry * c];
  };
  v.anchor = () => [v.w / 2, v.h * v.anchorY];
  // cull radius in metres (half screen diagonal back to world units + margin)
  v.visR = () => Math.hypot(v.w, v.h) / 2 / v.zoom + 40;
  v.near = (wx, wy, r) => ((wx - v.cx) ** 2 + (wy - v.cy) ** 2) < r * r;
  // does an edge bbox [minx,miny,maxx,maxy] intersect the camera's view box? (works for long edges)
  v.boxVisible = (bb) => {
    const R = v.visR();
    return bb[0] <= v.cx + R && bb[2] >= v.cx - R && bb[1] <= v.cy + R && bb[3] >= v.cy - R;
  };
  return v;
}
