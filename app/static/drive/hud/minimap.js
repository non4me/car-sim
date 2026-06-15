// North-up minimap: nearby streets around the car, 3 zoom levels (+/- buttons).
// Level +1 ≈ the immediately adjacent streets, +3 ≈ a few blocks each way.
const RADII = [110, 240, 430];   // world metres shown each way, for levels +1, +2, +3

export function makeMinimap(canvas, plusBtn, minusBtn, levelEl) {
  const ctx = canvas.getContext("2d");
  let level = 0;                  // 0..2  → +1.. +3
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
  plusBtn.addEventListener("click", (e) => { e.preventDefault(); setLevel(level + 1); });
  minusBtn.addEventListener("click", (e) => { e.preventDefault(); setLevel(level - 1); });

  function draw(map, car, currentStreet, whole) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#0a0d13";
    ctx.fillRect(0, 0, size, size);
    // whole-route mode (msg 2777): fit the full route into the minimap with basic context instead of
    // the car-centred view — so you can see which locations the route passes through.
    if (whole && whole.line && whole.box) { drawWhole(map, car, whole); return; }

    const R = RADII[level];
    const s = (size / 2) / R;                 // px per metre
    const cx = car.x, cy = car.y;
    const toM = (wx, wy) => [size / 2 + (wx - cx) * s, size / 2 - (wy - cy) * s]; // north-up

    // streets within the radius (current street highlighted)
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const e of map.edges) {
      const bb = e.bb;
      if (bb[0] > cx + R || bb[2] < cx - R || bb[1] > cy + R || bb[3] < cy - R) continue;
      ctx.beginPath();
      for (let i = 0; i < e.geom.length; i++) {
        const [X, Y] = toM(e.geom[i][0], e.geom[i][1]);
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
      const cur = e.name && e.name === currentStreet;
      ctx.strokeStyle = cur ? "#5b9cff" : "rgba(150,165,190,.55)";
      ctx.lineWidth = cur ? 3 : Math.max(1.2, e.width * s * 0.6);
      ctx.stroke();
    }

    // car marker — a triangle pointing along the heading (north-up frame)
    const ax = size / 2, ay = size / 2;
    const ux = Math.cos(car.h), uy = -Math.sin(car.h);   // world heading → north-up screen dir
    const px = -uy, py = ux;
    ctx.beginPath();
    ctx.moveTo(ax + ux * 8, ay + uy * 8);
    ctx.lineTo(ax - ux * 5 + px * 5, ay - uy * 5 + py * 5);
    ctx.lineTo(ax - ux * 5 - px * 5, ay - uy * 5 - py * 5);
    ctx.closePath();
    ctx.fillStyle = "#ffd24a";
    ctx.fill();

    // north tick (top edge)
    ctx.fillStyle = "rgba(170,180,200,.7)";
    ctx.font = "700 9px ui-sans-serif,system-ui,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("N", size / 2, 3);
  }

  // whole-route overview inside the minimap (msg 2777): north-up, fit the route bbox, draw only basic
  // context — faint nearby streets (only those streamed in near the car), the FULL route ribbon (the
  // server polyline is complete regardless of streamed tiles), start/end markers, the district names the
  // route crosses (fully loaded from search.json), and the car's current spot along the way.
  function drawWhole(map, car, { line, box, districts }) {
    const pad = 12;
    const span = Math.max(box.w, box.h, 1);
    const s = (size - pad * 2) / span;                 // fit the larger dimension, keep aspect
    const cx = box.cx, cy = box.cy;
    const toM = (wx, wy) => [size / 2 + (wx - cx) * s, size / 2 - (wy - cy) * s]; // north-up, centred on the route

    // 1) faint street context where tiles happen to be resident (near the car only — partial by design)
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(120,135,160,.18)"; ctx.lineWidth = 1;
    for (const e of map.edges) {
      ctx.beginPath();
      for (let i = 0; i < e.geom.length; i++) {
        const [X, Y] = toM(e.geom[i][0], e.geom[i][1]);
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
      ctx.stroke();
    }

    // 2) the full route ribbon (always complete — independent of which tiles streamed in)
    ctx.beginPath();
    for (let i = 0; i < line.length; i++) {
      const [X, Y] = toM(line[i][0], line[i][1]);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.strokeStyle = "rgba(96,165,255,.95)"; ctx.lineWidth = 2.4; ctx.stroke();

    // 3) start (green) + end (red) markers
    const [sx, sy] = toM(line[0][0], line[0][1]);
    const [ex, ey] = toM(line[line.length - 1][0], line[line.length - 1][1]);
    ctx.fillStyle = "#37d67a"; ctx.beginPath(); ctx.arc(sx, sy, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = "#ff5a6a"; ctx.beginPath(); ctx.arc(ex, ey, 3.4, 0, 7); ctx.fill();

    // 4) district names within the framed area — "which locations the route passes through"
    ctx.font = "700 8px ui-sans-serif,system-ui,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const d of districts || []) {
      const X = size / 2 + (d.x - cx) * s, Y = size / 2 - (d.y - cy) * s;
      if (X < 4 || X > size - 4 || Y < 6 || Y > size - 4) continue;
      ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(8,10,15,.7)"; ctx.strokeText(d.name, X, Y);
      ctx.fillStyle = "rgba(214,223,238,.82)"; ctx.fillText(d.name, X, Y);
    }

    // 5) the car's current position along the route (yellow dot)
    const [px, py] = toM(car.x, car.y);
    ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "#0a0d13"; ctx.stroke();

    // header tag so it's clear the minimap is in route-overview, not the local view
    ctx.fillStyle = "rgba(170,180,200,.8)";
    ctx.font = "700 8px ui-sans-serif,system-ui,sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("TRASA", 4, 3);
  }

  return { draw };
}
