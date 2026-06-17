// Hover tooltips (msg 3074): set the canvas `title` to a short description of whatever map object is under the
// cursor — a named POI/landmark/admin object, a street (name · number · speed · one-way · bridge/tunnel), a
// traffic sign, a pedestrian crossing, a house number, or a park/water area. Pure read of the streamed map;
// nothing is drawn. The native `title` shows after the usual hover delay, exactly what Vlad asked for.

const SIGN_LABEL = {
  signal: "Semafor", signals: "Semafor",
  stop: "Stůj, dej přednost v jízdě",
  give_way: "Dej přednost v jízdě",
  priority_road: "Hlavní pozemní komunikace",
  priority: "Hlavní pozemní komunikace",
};
const POI_KIND = {
  food: "občerstvení", restaurant: "restaurace", cafe: "kavárna", fuel: "čerpací stanice",
  atm: "bankomat", bank: "banka", pharmacy: "lékárna", post: "pošta", shop: "obchod",
  supermarket: "supermarket", police: "policie", fire: "hasiči", hospital: "nemocnice",
  school: "škola", hotel: "hotel", church: "kostel", station: "stanice", parking: "parkoviště",
};
const AREA_KIND = { green: "Zeleň", water: "Voda", park: "Park", forest: "Les", square: "Náměstí" };
const CLS_LABEL = {
  motorway: "dálnice", trunk: "silnice I. třídy", primary: "silnice I. třídy",
  secondary: "silnice II. třídy", tertiary: "silnice III. třídy", residential: "místní ulice",
  living_street: "obytná zóna", service: "účelová komunikace", unclassified: "místní silnice",
  pedestrian: "pěší zóna", track: "polní cesta", footway: "chodník", cycleway: "cyklostezka",
};

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// nearest point-like {x,y} in `arr` within `maxD` world metres of (x,y), or null
function nearestPoint(arr, x, y, maxD) {
  if (!arr || !arr.length) return null;
  let best = null, bd = maxD * maxD;
  for (const p of arr) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function streetInfo(edge) {
  const parts = [edge.name || CLS_LABEL[edge.cls] || "silnice"];
  const nums = [];
  if (edge.ref) nums.push(edge.ref);
  if (edge.iref) nums.push(edge.iref.replace(/\s+/g, ""));
  if (nums.length) parts.push("č. " + nums.join(", "));
  if (edge.maxspeed) parts.push(edge.maxspeed + " km/h");
  if (edge.oneway) parts.push("jednosměrka");
  if (edge.lv > 0) parts.push("most");
  else if (edge.lv < 0) parts.push("tunel");
  return parts.join(" · ");
}

// Attach the hover handler. `getExtra` (optional) returns city-wide named points {landmarks} loaded async.
export function makeHoverInfo(canvas, view, map, getExtra) {
  let lastText = null;
  const setTitle = (t) => { if (t !== lastText) { lastText = t; canvas.title = t || ""; } };

  function resolve(wx, wy) {
    const z = view.zoom, rPx = (px) => px / z;                 // screen px → world metres at this zoom
    // 1) named points first — they're the most specific "objects with information"
    const obj = nearestPoint(map.objects, wx, wy, rPx(16));     // admin-placed custom objects (name + description)
    if (obj) return obj.name + (obj.description || obj.desc ? " — " + (obj.description || obj.desc) : "");
    const poi = nearestPoint(map.pois, wx, wy, rPx(14));
    if (poi) return poi.name + (POI_KIND[poi.kind] ? " · " + POI_KIND[poi.kind] : "");
    const lm = nearestPoint(getExtra ? getExtra().landmarks : null, wx, wy, rPx(16));
    if (lm) return lm.name;
    // 2) traffic signs / crossings
    const sign = nearestPoint(map.signs, wx, wy, rPx(11));
    if (sign) return SIGN_LABEL[sign.kind] || ("Dopravní značka: " + sign.kind);
    const cr = nearestPoint(map.crossings, wx, wy, rPx(9));
    if (cr) return "Přechod pro chodce";
    // 3) the street under the cursor
    const ne = map.nearestEdge(wx, wy);
    if (ne.edge && ne.dist <= ne.edge.width / 2 + rPx(6)) return streetInfo(ne.edge);
    // 4) house number
    const ad = nearestPoint(map.addrs, wx, wy, rPx(8));
    if (ad) return "č. p. " + ad.n;
    // 5) a named or natural area (park / water) — never a plain building
    for (const a of map.areas || []) {
      if (a.kind === "building") continue;
      const bb = a.bb;
      if (bb && (wx < bb[0] || wx > bb[2] || wy < bb[1] || wy > bb[3])) continue;
      if (pointInPoly(wx, wy, a.poly)) return a.name || AREA_KIND[a.kind] || a.kind;
    }
    return "";
  }

  // coalesce to one resolve per animation frame — mousemove can fire far faster than we need to
  let pending = null, scheduled = false;
  const run = () => {
    scheduled = false;
    if (!pending) return;
    const r = canvas.getBoundingClientRect();
    const [wx, wy] = view.unproject(pending.x - r.left, pending.y - r.top);
    setTitle(resolve(wx, wy));
  };
  canvas.addEventListener("mousemove", (e) => {
    pending = { x: e.clientX, y: e.clientY };
    if (!scheduled) { scheduled = true; requestAnimationFrame(run); }
  });
  canvas.addEventListener("mouseleave", () => { pending = null; setTitle(""); });
}
