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
  };
  setLevel(0);
  plusBtn.addEventListener("click", (e) => { e.preventDefault(); setLevel(level + 1); });
  minusBtn.addEventListener("click", (e) => { e.preventDefault(); setLevel(level - 1); });

  function draw(map, car, currentStreet) {
    const R = RADII[level];
    const s = (size / 2) / R;                 // px per metre
    const cx = car.x, cy = car.y;
    const toM = (wx, wy) => [size / 2 + (wx - cx) * s, size / 2 - (wy - cy) * s]; // north-up

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#0a0d13";
    ctx.fillRect(0, 0, size, size);

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

  return { draw };
}
