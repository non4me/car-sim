// Hover tooltips (msg 3074): set the canvas `title` to a short description of whatever map object is under the
// cursor — a named POI/landmark/admin object, a street (name · number · speed · one-way · bridge/tunnel), a
// traffic sign, a pedestrian crossing, a house number, or a park/water area. Pure read of the streamed map;
// nothing is drawn. The native `title` shows after the usual hover delay, exactly what Vlad asked for.

import { T } from "../i18n.js";

// Localised to the header language (msg 3080/3083); the second arg is the Czech fallback if a key is missing.
const SIGN_LABEL = {
  signal: T("sign_signal", "Semafor"), signals: T("sign_signal", "Semafor"),
  stop: T("sign_stop", "Stůj, dej přednost v jízdě"),
  give_way: T("sign_giveway", "Dej přednost v jízdě"),
  priority_road: T("sign_priority", "Hlavní pozemní komunikace"),
  priority: T("sign_priority", "Hlavní pozemní komunikace"),
};
const POI_KIND = {
  food: T("poi_food", "občerstvení"), restaurant: T("poi_food", "občerstvení"), cafe: T("poi_cafe", "kavárna"),
  fuel: T("poi_fuel", "čerpací stanice"), atm: T("poi_atm", "bankomat"), bank: T("poi_bank", "banka"),
  pharmacy: T("poi_pharmacy", "lékárna"), post: T("poi_post", "pošta"), shop: T("poi_shop", "obchod"),
  supermarket: T("poi_shop", "obchod"), police: T("poi_police", "policie"), fire: T("poi_fire", "hasiči"),
  hospital: T("poi_hospital", "nemocnice"), school: T("poi_school", "škola"),
  station: T("poi_station", "stanice"), parking: T("poi_parking", "parkoviště"),
};
const AREA_KIND = { green: T("area_green", "Zeleň"), water: T("area_water", "Voda") };
const CLS_LABEL = {
  motorway: T("cls_motorway", "dálnice"), trunk: T("cls_trunk", "silnice I. třídy"),
  primary: T("cls_primary", "silnice I. třídy"), secondary: T("cls_secondary", "silnice II. třídy"),
  tertiary: T("cls_tertiary", "silnice III. třídy"), residential: T("cls_residential", "místní ulice"),
  service: T("cls_service", "účelová komunikace"),
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
  const parts = [edge.name || CLS_LABEL[edge.cls] || T("cls_other", "silnice")];
  const nums = [];
  if (edge.ref) nums.push(edge.ref);
  if (edge.iref) nums.push(edge.iref.replace(/\s+/g, ""));
  if (nums.length) parts.push(T("hov_num", "č.") + " " + nums.join(", "));
  if (edge.maxspeed) parts.push(edge.maxspeed + " km/h");
  if (edge.oneway) parts.push(T("hov_oneway", "jednosměrka"));
  if (edge.lv > 0) parts.push(T("hov_bridge", "most"));
  else if (edge.lv < 0) parts.push(T("hov_tunnel", "tunel"));
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
    if (sign) return SIGN_LABEL[sign.kind] || sign.kind;
    const cr = nearestPoint(map.crossings, wx, wy, rPx(9));
    if (cr) return T("hov_crossing", "Přechod pro chodce");
    // 3) the street under the cursor
    const ne = map.nearestEdge(wx, wy);
    if (ne.edge && ne.dist <= ne.edge.width / 2 + rPx(6)) return streetInfo(ne.edge);
    // 4) house number
    const ad = nearestPoint(map.addrs, wx, wy, rPx(8));
    if (ad) return T("hov_house", "č. p.") + " " + ad.n;
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
