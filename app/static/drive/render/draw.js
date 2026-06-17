// Top-down renderer with a heading-up (rotating) camera. Roads, lane markings,
// junction control, subtle street-name labels on the roads, and the nose-up car.
import { PARAMS as P } from "../vehicle/params.js";

const BG = "#0e1118";
const ASPHALT = "#2c333f";   // single road-surface colour (uniform → no seams where roads cross)
// schematic backdrop fills (drawn behind the roads). Buildings get a brighter edge so
// the block structure reads like a city map; roads stay the lightest (drivable) layer.
const AREA_FILL = { building: "#232a3a", green: "#1f3327", water: "#1b517f" };   // water = clear river blue
const AREA_STROKE = { building: "#46526b", green: "#335039", water: "#3f82bd" };

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

const OVERVIEW_LABEL_Z = 5;   // below this px/m (bird's-eye): show district + major-street names (msg 2763)

export function draw(ctx, view, map, car, rules, route, districts) {
  const { w, h, dpr, zoom } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const R = view.visR();
  // narrowest first so wider roads paint last (on top) → clean crossings, hierarchy by width
  const vis = map.edges.filter((e) => view.boxVisible(e.bb)).sort((a, b) => a.width - b.width);

  // junction interior hulls (msg 3022): used to (a) FILL the carriageway so intersections have no false
  // gaps and (b) DROP signs that fall inside the box. Built once per frame, close zoom only.
  const hulls = zoom >= 8 ? junctionHulls(view, vis, map.junctions) : null;

  // 0) schematic backdrop — buildings, greens, water (behind the roads)
  drawAreas(ctx, view, map);

  // 0b) railway tracks — under the roads (roads cross over), track symbol (msg 2771)
  drawRails(ctx, view, map, zoom);

  // 1) asphalt in three carriageway-level layers (msg 2983) so multi-level interchanges read correctly:
  //    tunnels UNDER (dimmed + dashed = covered/below), ground at grade, bridges ON TOP (lighter deck +
  //    a wider dark drop-shadow casing so they lift above the road below). Within each layer narrowest
  //    first → clean crossings; one surface colour per layer → no seams.
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const ground = [], bridges = [], tunnels = [];
  for (const e of vis) { const lv = e.lv || 0; (lv > 0 ? bridges : lv < 0 ? tunnels : ground).push(e); }
  bridges.sort((a, b) => (a.lv || 0) - (b.lv || 0));   // lower decks first → a higher deck paints on top (msg 3009)
  tunnels.sort((a, b) => (b.lv || 0) - (a.lv || 0));   // deepest tunnel first
  const casings = (eds, col, pad) => {
    ctx.strokeStyle = col;
    for (const e of eds) { path(ctx, view, e.geom); ctx.lineWidth = e.width * zoom + pad; ctx.stroke(); }
  };
  const surfaces = (eds, col, dash) => {
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = col;
    for (const e of eds) { path(ctx, view, e.geom); ctx.lineWidth = Math.max(2, e.width * zoom); ctx.stroke(); }
    ctx.setLineDash([]);
  };
  // tunnels BELOW: dimmer than asphalt + dashed → reads as covered/under (ground roads paint over them)
  casings(tunnels, "#0a0c11", 4); surfaces(tunnels, "#1d222c", [zoom * 1.3, zoom * 0.9]);
  // ground AT GRADE
  casings(ground, "#0a0c11", 4); surfaces(ground, ASPHALT);
  // junction interior fill (msg 3022): roads are strokes, so the splay where roads diverge leaves false
  // dark gaps at intersections. Fill each at-grade junction's convex hull with asphalt → one continuous
  // carriageway (like Google), no holes where there really aren't any.
  if (hulls) {
    ctx.setLineDash([]); ctx.fillStyle = ASPHALT;
    for (const H of hulls) { if (H.lv) continue; path(ctx, view, H.hull); ctx.closePath(); ctx.fill(); }
  }
  // tram tracks run IN the street → draw them ON the asphalt (incl. straight across the junction) with
  // Google-style transverse ties, so they read as tracks and don't vanish or become a "fake road" (msg 3023/3024).
  if (zoom >= 5) drawTrams(ctx, view, map, zoom);
  // bridges ABOVE: a WIDE dark drop-shadow + a clearly lighter deck → lifts above the road below (msg 3009)
  casings(bridges, "#05070a", 11); surfaces(bridges, "#475164");
  // parapet edge lines (the bridge railings) — the strongest "this carriageway is elevated" cue
  if (bridges.length && zoom >= 3) {
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(158,174,202,.92)";
    ctx.lineWidth = Math.max(1, zoom * 0.13);
    for (const e of bridges) {
      const half = (e.width || 6) / 2;
      path(ctx, view, offsetGeom(e.geom, half)); ctx.stroke();
      path(ctx, view, offsetGeom(e.geom, -half)); ctx.stroke();
    }
  }

  // 1b) computed route — a glowing blue ribbon laid over the asphalt (under markings/signs/car),
  //     so the suggested path reads clearly while the lane markings still show through at the edges.
  if (route && route.length > 1) drawRoute(ctx, view, route, zoom);

  // 2) carriageway markings (msg 2997): edge lines + dashed lane dividers + centre line, in white
  //    (CZ markings are white). Drawn on the geometry trimmed back from each end so the marks stop
  //    before the junction box — realistic, and it keeps the intersection interior clean for the
  //    approach markings (stop bar / give-way teeth) below. Close zoom only.
  if (zoom >= 10) drawLaneMarkings(ctx, view, vis, zoom);

  // 2b) one-way arrows along the flow direction (geometry order = direction of travel)
  if (zoom >= 7) {
    ctx.strokeStyle = "rgba(150,188,250,.55)";
    ctx.lineWidth = Math.max(1.5, zoom * 0.12);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const e of vis) {
      if (e.oneway) drawOnewayArrows(ctx, view, e.geom, zoom);
    }
  }

  // 2c) stop lines — a white transverse bar across each approach to a controlled junction
  //     (a road marking, so it's drawn on the asphalt and rotates with the road).
  if (zoom >= 9) drawApproachMarkings(ctx, view, vis, map.junctions, zoom);

  // 2c2) per-lane turn arrows where OSM has turn:lanes (msg 2997 ph2) — close zoom only
  if (zoom >= 12) drawTurnArrows(ctx, view, vis, map.junctions, zoom);

  // 2d) pedestrian crossings — a zebra ladder laid square across the road (road marking).
  if (zoom >= 8) drawCrossings(ctx, view, map, zoom);

  // 3) signs — billboarded glyphs (STOP / give-way / signal / priority-road), placed per
  //    approach (explicit OSM tags + derived from road-class priority). Zoomed out, the few
  //    explicitly-controlled junctions still get a faint dot so they read on the overview.
  if (zoom >= 6) {
    const ss = Math.max(9, Math.min(26, zoom * 1.15));
    // de-overlap + interior cull (msg 3022): drop signs that fall INSIDE a junction box (they belong on
    // the approach, not the middle), then place the rest through a guard so no two signs ever collide —
    // critical control (signal/stop) and the nearest signs win, so it stays clear which road each governs.
    const RANK = { signals: 0, signal: 0, stop: 0, give_way: 1, priority_road: 2 };
    const sg = makeLabelGuard();
    const cands = [];
    for (const s of map.signs) {
      if (!view.near(s.x, s.y, R)) continue;
      if (hulls && hulls.some((H) => pointInPoly(s.x, s.y, H.core))) continue;
      cands.push({ s, rank: RANK[s.kind] ?? 3, dd: (s.x - view.cx) ** 2 + (s.y - view.cy) ** 2 });
    }
    cands.sort((a, b) => a.rank - b.rank || a.dd - b.dd);
    const bs = ss * 1.05;
    for (const { s } of cands) {
      const [X, Y] = view.project(s.x, s.y);
      if (!sg.tryPlace(X - bs, Y - bs, X + bs, Y + bs)) continue;
      drawSign(ctx, X, Y, s.kind, ss);
    }
  } else {
    for (const j of map.junctions) {
      if (j.ctrl === "priority" || !view.near(j.x, j.y, R)) continue;
      const [X, Y] = view.project(j.x, j.y);
      ctx.beginPath(); ctx.arc(X, Y, Math.max(2, zoom * 0.5), 0, 7);
      ctx.fillStyle = j.ctrl === "signals" ? "#f6c453" : j.ctrl === "stop" ? "#e5484d" : "#5b9cff";
      ctx.fill();
    }
  }

  // ONE shared label guard so map text never overprints (msg 2786): each layer reserves the screen
  // box of every label it draws; later/lower-priority labels that would collide are skipped. Filled in
  // call order = priority: street names → landmark names → POI names → house numbers (least important).
  const guard = makeLabelGuard();

  // 4a) road-number shields on motorways/main roads (msg 3015) — CZ-coloured (red D, blue I, yellow II/III,
  //     green E). Drawn FIRST so the sparse, important road numbers reliably win the shared guard; anchored
  //     to the nearest on-road point → stable across zoom/pan (msg 3030). Current road's number → HUD.
  // 4) street-name labels at EVERY zoom (msg 3054) — one per name, off the junction, with the road NUMBER
  //    right beside the name (msg 3045); no separate swarm of shields. The current road is in the HUD.
  //    `nameRefs` resolves the number + total length per name across the road's variably-tagged edges.
  const nameRefs = nameMeta(map);
  drawStreetLabels(ctx, view, map.edges, rules && rules.street, guard, nameRefs);

  // 4b) overview (bird's-eye): translucent district names + names of the major nearby streets,
  //     so you can orient while zoomed right out (msg 2763).
  if (zoom < OVERVIEW_LABEL_Z) drawOverviewLabels(ctx, view, districts, guard);

  // 4c) stations + major-landmark labels (marker + name), for orientation at most zooms (msg 2771)
  drawLabels(ctx, view, map, zoom, guard);

  // 4c2) named bridges & tunnels — a label on the structure (msg 2983), distinct tint per level
  drawStructureLabels(ctx, view, vis, zoom, guard);

  // 4c3) admin-placed objects (msg 2983 ph3): custom uploaded icon or standard library icon + name,
  //      at the geolocation the admin entered (projected to world coords server-side).
  drawObjects(ctx, view, map, zoom, guard);

  // 4d) close-up street detail (msg 2771 phase 2): POIs (pharmacy/ATM/food/shop…) when zoomed in,
  //     and house numbers when very close — so the street you're on shows its full info.
  if (zoom >= 13) drawPois(ctx, view, map, zoom, guard);
  if (zoom >= 15) drawHouseNumbers(ctx, view, map, guard);
  view._labelStats = guard.stats();          // {kept, dropped} — headless de-overlap diagnostic (msg 2786)

  // 5) the car — sprite (heading-up) or a heading-pointing arrow (north-up overview)
  drawCar(ctx, view, car);
}

// Label each visible street at the point ON the road nearest the car, so the name
// actually sits in view as you drive (segment-midpoint placement fell off-screen on
// long blocks). One label per name, closest instance wins.
function drawAreas(ctx, view, map) {
  const areas = map.areas;
  if (!areas || !areas.length) return;
  // group by kind so we batch fills (water/green under buildings)
  for (const kind of ["water", "green", "building"]) {
    ctx.fillStyle = AREA_FILL[kind];
    ctx.strokeStyle = AREA_STROKE[kind];
    ctx.lineWidth = 1;
    const stroke = (kind === "building" && view.zoom > 6) || kind === "water";   // water always gets a shore line
    for (const a of areas) {
      if (a.kind !== kind || !view.boxVisible(a.bb)) continue;
      ctx.beginPath();
      ringPath(ctx, view, a.poly);
      if (a.holes) for (const h of a.holes) ringPath(ctx, view, h);   // islands (e.g. Vltava) cut out via even-odd
      a.holes ? ctx.fill("evenodd") : ctx.fill();
      if (stroke) ctx.stroke();   // building outlines (zoomed in) + water shoreline
    }
  }
}

function ringPath(ctx, view, poly) {
  for (let i = 0; i < poly.length; i++) {
    const [X, Y] = view.project(poly[i][0], poly[i][1]);
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  }
  ctx.closePath();
}

// Railway tracks: heavy/light rail = gray base + a light dashed overlay (the classic track
// symbol); tram = a thin faint line (it runs in the street). Drawn under the roads (msg 2771).
function drawRails(ctx, view, map, zoom) {
  const rails = map.rails;
  if (!rails || !rails.length) return;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const r of rails) {
    if (r.bb && !view.boxVisible(r.bb)) continue;
    if (r.kind === "tram") {
      continue;                                          // trams run in-street → drawn ON TOP of the asphalt (drawTrams, msg 3024)
    } else {
      // rails are SECONDARY info (msg 2776) → dark gray, only a touch above the background, with a
      // muted (not white) tie overlay so they read as track without competing with the roads.
      ctx.setLineDash([]);
      ctx.strokeStyle = "#363d4a";
      ctx.lineWidth = Math.max(1.5, zoom * 0.16);
      path(ctx, view, r.geom); ctx.stroke();
      if (zoom >= 4) {
        ctx.setLineDash([Math.max(2, zoom * 0.6), Math.max(2, zoom * 0.6)]);
        ctx.strokeStyle = "#4b5365";
        ctx.lineWidth = Math.max(1, zoom * 0.09);
        path(ctx, view, r.geom); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  ctx.restore();
}

// Tram tracks (msg 3024): trams run in the street, so — unlike heavy rail — they're drawn ON TOP of the
// asphalt (and straight across the junction, so they no longer disappear or read as a "fake road", msg 3023).
// Google-style: a faint twin-rail pair + periodic transverse ties ("поперечные риски") so it reads as track.
function drawTrams(ctx, view, map, zoom) {
  const rails = map.rails;
  if (!rails || !rails.length) return;
  ctx.save();
  ctx.lineCap = "butt"; ctx.lineJoin = "round";
  const RAIL = "rgba(150,160,182,.55)";
  const gauge = 0.7;                                   // half rail-to-rail spacing, metres
  const ties = zoom >= 7;
  const tieEvery = 6, tieHalf = 1.1;                   // metres between ties / tie half-length
  for (const r of rails) {
    if (r.kind !== "tram") continue;
    if (r.bb && !view.boxVisible(r.bb)) continue;
    ctx.strokeStyle = RAIL;
    ctx.lineWidth = Math.max(0.8, zoom * 0.06);
    if (zoom >= 8) {                                   // twin rails once close enough to tell them apart
      path(ctx, view, offsetGeom(r.geom, gauge)); ctx.stroke();
      path(ctx, view, offsetGeom(r.geom, -gauge)); ctx.stroke();
    } else {
      path(ctx, view, r.geom); ctx.stroke();           // single faint line when zoomed out
    }
    if (!ties) continue;
    ctx.lineWidth = Math.max(0.8, zoom * 0.06);
    const g = r.geom; let acc = 0, nextAt = tieEvery * 0.5;
    for (let i = 1; i < g.length; i++) {
      const ax = g[i - 1][0], ay = g[i - 1][1], bx = g[i][0], by = g[i][1];
      const seg = Math.hypot(bx - ax, by - ay); if (seg < 1e-6) continue;
      const dx = (bx - ax) / seg, dy = (by - ay) / seg, px = -dy, py = dx;
      while (nextAt <= acc + seg) {
        const t = (nextAt - acc) / seg, mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
        const [X0, Y0] = view.project(mx + px * tieHalf, my + py * tieHalf);
        const [X1, Y1] = view.project(mx - px * tieHalf, my - py * tieHalf);
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
        nextAt += tieEvery;
      }
      acc += seg;
    }
  }
  ctx.restore();
}

// Station + major-landmark labels (msg 2771): a category-coloured marker (square for rail
// stations, dot for landmarks) + the name. Shown at most zooms (≥3) so they aid orientation
// in the overview too; only those within view are drawn.
const LABEL_COLOR = {
  station: "#f6c453", museum: "#4cc2c4", attraction: "#4cc2c4", castle: "#d08bdc",
  monument: "#c0a16b", theatre: "#e0788f", university: "#7aa7ff", hospital: "#ef6a6a",
  townhall: "#9aa6bd", stadium: "#5fbf7f", airport: "#7aa7ff", church: "#c7b27a",
};
// standard object icons (msg 2983): an emoji pictogram per kind, drawn on a dark badge so it reads on any
// surface — recognisable "значки" at the object's location (custom landmark icons come via the admin in ph3).
const ICON_GLYPH = {
  station: "🚉", bus_station: "🚌", airport: "✈️", museum: "🏛️", castle: "🏰", theatre: "🎭",
  university: "🎓", hospital: "🏥", stadium: "🏟️", townhall: "🏛️", monument: "🗿", attraction: "⭐",
  church: "⛪", square: "⛲",
  pharmacy: "💊", atm: "🏧", bank: "🏦", food: "🍽️", fuel: "⛽", police: "🚓", fire: "🚒", post: "✉️", shop: "🛒",
};
function drawIcon(ctx, X, Y, glyph, size) {
  ctx.beginPath(); ctx.arc(X, Y, size * 0.72, 0, 7);
  ctx.fillStyle = "rgba(12,15,22,.82)"; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.stroke();
  ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(glyph, X, Y + 0.5);
}
// zoomed right out, show only the biggest landmarks (the rest would crowd the overview)
const OVERVIEW_MAJOR = new Set(["station", "castle", "museum", "university", "hospital", "stadium", "airport"]);
function drawLabels(ctx, view, map, zoom, guard) {
  const labels = map.labels;
  if (!labels || !labels.length || zoom < 3) return;
  const R = view.visR();
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = "600 12px ui-sans-serif,system-ui,sans-serif";
  for (const L of labels) {
    if (zoom < 4 && !OVERVIEW_MAJOR.has(L.kind)) continue;   // declutter the overview
    if (!view.near(L.x, L.y, R)) continue;
    const [X, Y] = view.project(L.x, L.y);
    const col = LABEL_COLOR[L.kind] || "#cfd6e2";
    const glyph = ICON_GLYPH[L.kind];
    let tx;
    if (glyph) {                                        // standard icon at the object's location (msg 2983)
      const isz = zoom < 5 ? 12 : 15;
      drawIcon(ctx, X, Y, glyph, isz);
      tx = X + isz * 0.72 + 3;
    } else {                                            // no standard icon → category dot
      ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(8,10,15,.85)";
      ctx.beginPath(); ctx.arc(X, Y, 4, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.stroke();
      tx = X + 7;
    }
    ctx.font = "600 12px ui-sans-serif,system-ui,sans-serif";   // restore name font + align (drawIcon changed them)
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    // name yields to higher-priority labels (msg 2786)
    if (guard && !guard.tryPlace(tx, Y - 7, tx + ctx.measureText(L.name).width, Y + 7)) continue;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,10,15,.85)"; ctx.strokeText(L.name, tx, Y);
    ctx.fillStyle = "rgba(233,239,249,.96)"; ctx.fillText(L.name, tx, Y);
  }
  ctx.textAlign = "center";   // restore default for subsequent text
}

// Everyday POIs along the street (msg 2771 phase 2): a category-coloured dot with a small glyph,
// plus the name once very zoomed in. Only those in view at close zoom are drawn.
const POI_COLOR = {
  pharmacy: "#36c46e", atm: "#f2b035", bank: "#f2b035", food: "#ec7a43",
  fuel: "#5b9cff", police: "#5b9cff", fire: "#ef4444", post: "#f2b035", shop: "#c084fc",
};
const POI_GLYPH = {
  pharmacy: "+", atm: "$", bank: "$", food: "F", fuel: "G", police: "P", fire: "!", post: "@", shop: "S",
};
function drawPois(ctx, view, map, zoom, guard) {
  const pois = map.pois;
  if (!pois || !pois.length) return;
  const R = view.visR();
  const showName = zoom >= 15;
  for (const po of pois) {
    if (!view.near(po.x, po.y, R)) continue;
    const [X, Y] = view.project(po.x, po.y);
    const glyph = ICON_GLYPH[po.kind];
    if (glyph) {                                        // standard POI icon (msg 2983)
      drawIcon(ctx, X, Y, glyph, 12);
    } else {                                            // unknown kind → category dot + letter (legacy)
      ctx.beginPath(); ctx.arc(X, Y, 5, 0, 7);
      ctx.fillStyle = POI_COLOR[po.kind] || "#cfd6e2"; ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = "rgba(8,10,15,.85)"; ctx.stroke();
      ctx.fillStyle = "#0b0e14"; ctx.font = "800 8px ui-sans-serif,system-ui,sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(POI_GLYPH[po.kind] || "", X, Y + 0.5);
    }
    if (showName && po.name) {                          // name yields to street/landmark labels (msg 2786)
      const nx = X + (glyph ? 11 : 8);
      ctx.font = "600 11px ui-sans-serif,system-ui,sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      if (guard && !guard.tryPlace(nx, Y - 6, nx + ctx.measureText(po.name).width, Y + 6)) continue;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,10,15,.85)"; ctx.strokeText(po.name, nx, Y);
      ctx.fillStyle = "rgba(228,235,246,.96)"; ctx.fillText(po.name, nx, Y);
    }
  }
  ctx.textAlign = "center";   // restore default
}

// Admin-placed objects (msg 2983 ph3): a custom uploaded image (on a dark badge) or, failing that, a
// standard emoji icon — plus the object's name — at its geolocation. Custom images load lazily and are
// cached; the continuous rAF render loop repaints them in as soon as each finishes loading.
const _objImg = new Map();
function objImage(url) {
  let im = _objImg.get(url);
  if (!im) {
    im = new Image();
    im.onload = () => { im._ok = true; };
    im.onerror = () => { im._ok = false; };
    im.src = url;
    _objImg.set(url, im);
  }
  return im;
}
function drawObjects(ctx, view, map, zoom, guard) {
  const objs = map.objects;
  if (!objs || !objs.length || zoom < 3) return;
  const R = view.visR();
  for (const o of objs) {
    if (!view.near(o.x, o.y, R)) continue;
    const [X, Y] = view.project(o.x, o.y);
    const isz = zoom < 5 ? 13 : 17;
    let tx;
    if (o.icon) {                                       // custom uploaded image, clipped onto a dark badge
      const im = objImage(o.icon);
      ctx.beginPath(); ctx.arc(X, Y, isz * 0.78, 0, 7);
      ctx.fillStyle = "rgba(12,15,22,.82)"; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.32)"; ctx.stroke();
      if (im._ok) { const s = isz * 1.12; ctx.drawImage(im, X - s / 2, Y - s / 2, s, s); }
      tx = X + isz * 0.78 + 3;
    } else {                                            // standard library icon (emoji), generic pin fallback
      drawIcon(ctx, X, Y, ICON_GLYPH[o.kind] || "📍", isz);
      tx = X + isz * 0.72 + 3;
    }
    if (!o.name) continue;
    ctx.font = "700 12px ui-sans-serif,system-ui,sans-serif";    // restore after drawIcon changed font/align
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    if (guard && !guard.tryPlace(tx, Y - 7, tx + ctx.measureText(o.name).width, Y + 7)) continue;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,10,15,.85)"; ctx.strokeText(o.name, tx, Y);
    ctx.fillStyle = "rgba(233,239,249,.98)"; ctx.fillText(o.name, tx, Y);
  }
  ctx.textAlign = "center";   // restore default for subsequent text
}

// Per-lane turn arrows (msg 2997 ph2): where OSM has turn:lanes, draw the arrow(s) in each approach
// lane a few metres before the junction. `tl` = forward (geom-order) turn:lanes, `tlb` = backward;
// "|"-separated lanes ordered left→right, each lane a ";"-separated set of turns (left/through/right…).
function drawTurnArrows(ctx, view, vis, junctions, zoom) {
  const R = view.visR();
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const seen = new Set();
  for (const j of junctions) {
    if (!view.near(j.x, j.y, R)) continue;
    for (const e of vis) {
      if (!e.tl && !e.tlb) continue;
      const g = e.geom, last = g.length - 1;
      const atStart = Math.hypot(g[0][0] - j.x, g[0][1] - j.y) < 3.5;
      const atEnd = !atStart && Math.hypot(g[last][0] - j.x, g[last][1] - j.y) < 3.5;
      if (!atStart && !atEnd) continue;
      const spec = atEnd ? e.tl : e.tlb;          // the direction APPROACHING this junction
      if (!spec) continue;
      const key = `${e.a}_${e.b}_${atEnd ? 1 : 0}`;
      if (seen.has(key)) continue;                // one edge can touch two junctions; mark each end once
      seen.add(key);
      const lanesArr = spec.split("|");
      const n = lanesArr.length;
      if (!n) continue;
      let L = 0;
      for (let i = 1; i < g.length; i++) L += Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]);
      const wp = walkAlong(g, atStart, Math.min(8, L * 0.5));
      const tx = -wp.dirx, ty = -wp.diry;          // travel direction (toward the junction)
      const Lx = wp.diry, Ly = -wp.dirx;           // left-of-travel normal in world
      const W = e.width || n * 3;
      const Wdir = e.oneway ? W : W / 2;           // two-way: this direction gets the right half (RHT)
      const laneW = Wdir / n;
      const asz = Math.min(laneW * 0.4, 2.0);      // arrow half-size, metres (kept inside the lane)
      for (let i = 0; i < n; i++) {
        // lane centre offset along the LEFT normal: leftmost lane (i=0) first. One-way spans the full
        // width; two-way occupies the right half (negative = right of travel).
        const off = e.oneway ? (W / 2 - (i + 0.5) * laneW) : -((i + 0.5) * laneW);
        drawLaneArrow(ctx, view, wp.x + Lx * off, wp.y + Ly * off, tx, ty, lanesArr[i], asz * zoom);
      }
    }
  }
  ctx.restore();
}

// One lane arrow at world (wx,wy), travelling along world dir (tx,ty), for a ";"-set of turns. Drawn in
// screen space (billboarded with the heading-up camera) — a shaft that bends toward each turn + a head.
function drawLaneArrow(ctx, view, wx, wy, tx, ty, turns, S) {
  if (S < 5) return;                               // too small to read
  const [X, Y] = view.project(wx, wy);
  const c = Math.cos(view.rot), s = Math.sin(view.rot);
  const ux = tx * c - ty * s, uy = -(tx * s + ty * c);   // travel dir in screen space (unit)
  const rx = -uy, ry = ux;                          // right-of-travel in screen space
  ctx.strokeStyle = "rgba(232,237,247,.82)";
  ctx.fillStyle = "rgba(232,237,247,.82)";
  ctx.lineWidth = Math.max(1.5, S * 0.13);
  const base = [X - ux * S, Y - uy * S];            // tail, behind the centre
  for (const tok of (turns || "through").split(";")) {
    let lat = 0;                                    // lateral turn amount: -1 left … +1 right
    if (tok.includes("sharp_left")) lat = -1; else if (tok.includes("slight_left")) lat = -0.45; else if (tok.includes("left")) lat = -0.8;
    else if (tok.includes("sharp_right")) lat = 1; else if (tok.includes("slight_right")) lat = 0.45; else if (tok.includes("right")) lat = 0.8;
    // bend point + tip: shaft runs forward, then heads off toward the turn
    const dirx = ux + rx * lat, diry = uy + ry * lat, dl = Math.hypot(dirx, diry) || 1;
    const hx = dirx / dl, hy = diry / dl;           // head direction (unit)
    const bend = [X + ux * S * 0.15, Y + uy * S * 0.15];
    const tip = [bend[0] + hx * S * 0.95, bend[1] + hy * S * 0.95];
    ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(bend[0], bend[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    const hpx = -hy, hpy = hx, hs = S * 0.42;       // arrowhead
    ctx.beginPath();
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(tip[0] - hx * hs + hpx * hs * 0.6, tip[1] - hy * hs + hpy * hs * 0.6);
    ctx.lineTo(tip[0] - hx * hs - hpx * hs * 0.6, tip[1] - hy * hs - hpy * hs * 0.6);
    ctx.closePath(); ctx.fill();
  }
}

// Road-number shields (msg 3015): a coloured badge with the road number along motorways/main roads,
// CZ-style — red dálnice (D), blue I-class, yellow II/III, green E-routes. Billboarded + de-overlapped.
function refStyle(ref, cls) {
  if (/^E\s?\d/i.test(ref)) return { bg: "#2f8f43", fg: "#fff", bd: "rgba(255,255,255,.92)" };                 // euro green
  if (/^D\d/.test(ref) || cls === "motorway" || cls === "motorway_link") return { bg: "#c1272d", fg: "#fff", bd: "rgba(255,255,255,.92)" };  // dálnice red
  if (cls === "trunk" || cls === "primary" || cls === "trunk_link" || cls === "primary_link") return { bg: "#1f6fd6", fg: "#fff", bd: "rgba(255,255,255,.92)" };  // I. třída blue
  return { bg: "#f2b21a", fg: "#241803", bd: "rgba(90,66,6,.95)" };                                             // II/III yellow
}
function drawRefBadge(ctx, X, Y, text, st, h) {
  ctx.font = `800 ${Math.round(h * 0.6)}px ui-sans-serif,system-ui,sans-serif`;
  const w = Math.max(h * 1.05, ctx.measureText(text).width + h * 0.5);
  roundRect(ctx, X - w / 2, Y - h / 2, w, h, h * 0.26);
  ctx.fillStyle = st.bg; ctx.fill();
  ctx.lineWidth = Math.max(1, h * 0.1); ctx.strokeStyle = st.bd; ctx.stroke();
  ctx.fillStyle = st.fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, X, Y + h * 0.04);
}
// The road number(s) for a street NAME, preferring the national ref. OSM tags vary edge to edge (one
// Studentská segment is tagged ref=20, the next only int_ref=E49), so we aggregate across every edge of the
// name → the badge always shows the national number (+ E-route) regardless of which segment anchors the
// label. Map name -> {ref, iref, cls}. Cheap (named-with-number edges only), rebuilt per frame.
// Per-name aggregate over EVERY named edge: the road number(s) + its colour class, plus the street's TOTAL
// length (OSM splits a street into many edges at junctions, so length must be summed by name). The total
// length is what tells a long "main" street apart from a short side street when zoomed out (msg 3068).
// Cached on the map and rebuilt only when the tile loader swaps in a new edge array (tiles.js reassigns
// map.edges), so this whole-network pass doesn't run every frame.
function nameMeta(map) {
  if (map._nameMeta && map._nameMetaFor === map.edges) return map._nameMeta;
  const m = new Map();
  for (const e of map.edges) {
    if (!e.name) continue;
    let cur = m.get(e.name);
    if (!cur) { cur = { ref: "", iref: "", cls: e.cls, len: 0 }; m.set(e.name, cur); }
    cur.len += edgeLen(e);
    if (e.ref && !cur.ref) { cur.ref = e.ref; cur.cls = e.cls; }     // national ref wins the colour
    if (e.iref && !cur.iref) cur.iref = e.iref;
  }
  map._nameMeta = m; map._nameMetaFor = map.edges;
  return m;
}

// Road-number badge(s) drawn RIGHT NEXT TO a street-name label (msg 3045): billboarded, just past the END of
// the name text so it never covers the name, reserved in the shared guard so it can't pile onto another
// label. `ri` = {ref, iref, cls} from refsByName; (sx,sy) = the name anchor, `ang` = its angle, `hw` = half
// the name width in px. Tying the number to the name gives one-per-street frequency, no swarm of shields.
function drawNameRef(ctx, ri, sx, sy, ang, hw, guard) {
  if (!ri) return;
  const items = [];
  if (ri.ref) items.push({ t: ri.ref, st: refStyle(ri.ref, ri.cls) });
  const ie = ri.iref ? ri.iref.replace(/\s+/g, "") : "";
  if (ie && ie !== (ri.ref || "")) items.push({ t: ie, st: refStyle(ie, ri.cls) });   // pass the real "E49" → green
  if (!items.length) return;
  const h = 15;                                      // badge height px (matches the ~11-13 px name)
  const c = Math.cos(ang), s = Math.sin(ang);
  let edge = hw + 7;                                 // start just past the end of the name text
  for (const it of items) {
    ctx.font = `800 ${Math.round(h * 0.6)}px ui-sans-serif,system-ui,sans-serif`;
    const w = Math.max(h * 1.05, ctx.measureText(it.t).width + h * 0.5);
    const bx = sx + c * (edge + w / 2), by = sy + s * (edge + w / 2);
    edge += w + 4;
    // The badge sits PAST the end of the name (along the text angle), so it never covers the name — draw it
    // unconditionally (the name's conservative axis-aligned box would otherwise falsely drop it for diagonal
    // text). Still reserve it best-effort so later labels avoid it.
    if (guard) guard.tryPlace(bx - w / 2, by - h / 2, bx + w / 2, by + h / 2);
    drawRefBadge(ctx, bx, by, it.t, it.st, h);
  }
}

// House numbers (msg 2771 phase 2): faint number at the building centroid, only when very close
// (so the street you're driving shows its addresses without flooding the whole map).
function drawHouseNumbers(ctx, view, map, guard) {
  const addrs = map.addrs;
  if (!addrs || !addrs.length) return;
  const R = view.visR();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "600 10px ui-sans-serif,system-ui,sans-serif";
  ctx.fillStyle = "rgba(158,168,188,.9)";
  for (const a of addrs) {
    if (!view.near(a.x, a.y, R)) continue;
    const [X, Y] = view.project(a.x, a.y);
    // house numbers are the lowest priority — they yield to every other label (msg 2786)
    const hw = ctx.measureText(a.n).width / 2;
    if (guard && !guard.tryPlace(X - hw, Y - 6, X + hw, Y + 6)) continue;
    ctx.fillText(a.n, X, Y);
  }
}

// Route ribbon: two passes — a soft wide glow then a solid core — so the path reads on any
// background. Width is in metres (scales with zoom) but floored so it stays visible when far out.
function drawRoute(ctx, view, route, zoom) {
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  path(ctx, view, route);
  ctx.strokeStyle = "rgba(90,156,255,.28)";
  ctx.lineWidth = Math.max(7, zoom * 3.2);          // wide translucent glow
  ctx.stroke();
  path(ctx, view, route);
  ctx.strokeStyle = "rgba(96,165,255,.95)";
  ctx.lineWidth = Math.max(3, zoom * 1.1);          // bright solid core
  ctx.stroke();
  ctx.restore();
}

// One-way arrows: chevrons every ~STEP metres along the flow (geometry order = travel direction).
function drawOnewayArrows(ctx, view, geom, zoom) {
  const STEP = 14;                                       // metres between chevrons
  const half = Math.min(11, Math.max(3.5, zoom * 0.5));  // chevron arm length in px
  let nextAt = STEP * 0.5, dist = 0;
  for (let i = 1; i < geom.length; i++) {
    const ax = geom[i - 1][0], ay = geom[i - 1][1];
    const bx = geom[i][0], by = geom[i][1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg < 1e-6) continue;
    const dx = (bx - ax) / seg, dy = (by - ay) / seg;
    while (nextAt <= dist + seg) {
      const t = (nextAt - dist) / seg;
      drawChevron(ctx, view, ax + (bx - ax) * t, ay + (by - ay) * t, dx, dy, half);
      nextAt += STEP;
    }
    dist += seg;
  }
}

function drawChevron(ctx, view, wx, wy, dirx, diry, half) {
  const [sx, sy] = view.project(wx, wy);
  const c = Math.cos(view.rot), s = Math.sin(view.rot);
  const ux = dirx * c - diry * s, uy = -(dirx * s + diry * c);  // world dir → screen dir (unit)
  const px = -uy, py = ux;                                       // perpendicular
  const vx = sx + ux * half * 0.6, vy = sy + uy * half * 0.6;    // chevron vertex (points forward)
  ctx.beginPath();
  ctx.moveTo(vx - ux * half + px * half * 0.8, vy - uy * half + py * half * 0.8);
  ctx.lineTo(vx, vy);
  ctx.lineTo(vx - ux * half - px * half * 0.8, vy - uy * half - py * half * 0.8);
  ctx.stroke();
}

// --- carriageway markings (msg 2997) ----------------------------------------------------------
const MARK = "rgba(226,231,241,.55)";       // lane markings are WHITE in CZ; kept faint so the map stays calm

// Offset a polyline by `off` metres along the per-vertex normal (average of adjacent segment
// normals). +off / -off give the two sides. Good enough for the gentle curves of road centerlines.
function offsetGeom(geom, off) {
  const n = geom.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let nx = 0, ny = 0;
    if (i > 0) { const dx = geom[i][0] - geom[i - 1][0], dy = geom[i][1] - geom[i - 1][1], L = Math.hypot(dx, dy) || 1; nx += -dy / L; ny += dx / L; }
    if (i < n - 1) { const dx = geom[i + 1][0] - geom[i][0], dy = geom[i + 1][1] - geom[i][1], L = Math.hypot(dx, dy) || 1; nx += -dy / L; ny += dx / L; }
    const L = Math.hypot(nx, ny) || 1;
    out[i] = [geom[i][0] + (nx / L) * off, geom[i][1] + (ny / L) * off];
  }
  return out;
}

// Trim `margin` metres off both ends of a polyline (so markings stop before the junction box).
// Returns null when the segment is too short to bother marking.
function trimGeom(geom, margin) {
  const segs = []; let L = 0;
  for (let i = 1; i < geom.length; i++) { const d = Math.hypot(geom[i][0] - geom[i - 1][0], geom[i][1] - geom[i - 1][1]); segs.push(d); L += d; }
  if (L <= 2 * margin + 1) return null;
  const at = (s) => {
    let acc = 0;
    for (let i = 1; i < geom.length; i++) { const d = segs[i - 1]; if (acc + d >= s) { const t = (s - acc) / (d || 1); return [geom[i - 1][0] + (geom[i][0] - geom[i - 1][0]) * t, geom[i - 1][1] + (geom[i][1] - geom[i - 1][1]) * t, i]; } acc += d; }
    return [geom[geom.length - 1][0], geom[geom.length - 1][1], geom.length - 1];
  };
  const p0 = at(margin), p1 = at(L - margin);
  const out = [[p0[0], p0[1]]];
  for (let i = p0[2]; i <= p1[2] - 1; i++) out.push(geom[i]);
  out.push([p1[0], p1[1]]);
  return out;
}

// Lane markings per drivable edge: solid faint edge lines at ±W/2, dashed lane dividers, and (two-way)
// a centre line. World-space offsets → they rotate with the heading-up camera; geometry trimmed so the
// marks stop short of the junctions.
function drawLaneMarkings(ctx, view, vis, zoom) {
  ctx.save();
  ctx.lineCap = "butt";
  ctx.strokeStyle = MARK;
  const lw = Math.max(1, zoom * 0.09);
  for (const e of vis) {
    if (e.cls === "service" || e.cls === "living_street") continue;   // unmarked in reality
    const W = e.width || 0;
    if (W < 3) continue;
    if (e.bb && !view.boxVisible(e.bb)) continue;
    const g = trimGeom(e.geom, 5);
    if (!g) continue;
    const lanes = Math.max(1, e.lanes || 1);
    ctx.lineWidth = lw;
    // edge lines (solid), just inside the kerb
    ctx.setLineDash([]);
    path(ctx, view, offsetGeom(g, W / 2 - 0.2)); ctx.stroke();
    path(ctx, view, offsetGeom(g, -(W / 2 - 0.2))); ctx.stroke();
    if (e.oneway) {
      ctx.setLineDash([zoom * 1.6, zoom * 1.4]);                       // dashed dividers between same-dir lanes
      const laneW = W / lanes;
      for (let k = 1; k < lanes; k++) { path(ctx, view, offsetGeom(g, -W / 2 + k * laneW)); ctx.stroke(); }
    } else {
      const perDir = Math.max(1, Math.floor(lanes / 2));
      const laneW = (W / 2) / perDir;
      ctx.setLineDash([zoom * 2.4, zoom * 1.2]);                       // centre line (longer dashes)
      path(ctx, view, offsetGeom(g, 0)); ctx.stroke();
      ctx.setLineDash([zoom * 1.6, zoom * 1.4]);                       // lane dividers within each direction
      for (let k = 1; k < perDir; k++) { path(ctx, view, offsetGeom(g, k * laneW)); ctx.stroke(); path(ctx, view, offsetGeom(g, -k * laneW)); ctx.stroke(); }
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// Approach markings: a solid STOP BAR on each approach to a stop/signal junction. (Give-way "shark
// teeth" were removed per msg 3008 — they cluttered complex junctions; the ▽ give-way sign still marks it.)
function drawApproachMarkings(ctx, view, vis, junctions, zoom) {
  const R = view.visR();
  ctx.save();
  ctx.lineCap = "butt";
  for (const j of junctions) {
    if (j.ctrl !== "stop" && j.ctrl !== "signals") continue;
    if (!view.near(j.x, j.y, R)) continue;
    for (const e of vis) {
      const g = e.geom, last = g.length - 1;
      const atStart = Math.hypot(g[0][0] - j.x, g[0][1] - j.y) < 3.5;
      const atEnd = !atStart && Math.hypot(g[last][0] - j.x, g[last][1] - j.y) < 3.5;
      if (!atStart && !atEnd) continue;
      let L = 0;
      for (let i = 1; i < g.length; i++) L += Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]);
      const wp = walkAlong(g, atStart, Math.min(4, L * 0.4));   // a few m in from the junction
      drawStopBar(ctx, view, wp, Math.max(1.5, e.width / 2), zoom);
    }
  }
  ctx.restore();
}

function drawStopBar(ctx, view, wp, half, zoom) {
  const px = -wp.diry, py = wp.dirx;                 // world-space across-road perpendicular (unit)
  ctx.strokeStyle = "rgba(236,239,246,.72)";
  ctx.lineWidth = Math.max(2, zoom * 0.55);          // ~0.55 m thick
  const [ax, ay] = view.project(wp.x + px * half, wp.y + py * half);
  const [bx, by] = view.project(wp.x - px * half, wp.y - py * half);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
}

// Pedestrian crossings: a zebra ladder. Each crossing carries its centre, the road tangent
// (tx,ty) and the carriageway width; we lay white bars transverse to the road, repeated along
// the travel direction over a fixed depth. All corners are projected from world space, so the
// zebra sits on the asphalt and turns with the heading-up camera.
function drawCrossings(ctx, view, map, zoom) {
  const cr = map.crossings;
  if (!cr || !cr.length) return;
  const R = view.visR();
  const DEPTH = 4.0, BAR = 0.5, GAP = 0.5;          // metres: band depth along road, bar + gap
  ctx.save();
  ctx.fillStyle = "rgba(236,239,246,.80)";
  for (const c of cr) {
    if (!view.near(c.x, c.y, R)) continue;
    const tx = c.tx, ty = c.ty;                     // road tangent (unit) — bars run across this
    const px = -ty, py = tx;                        // across-road perpendicular
    const half = (c.w || 6) / 2 + 0.3;              // span kerb-to-kerb (+ small overhang)
    for (let s0 = -DEPTH / 2; s0 < DEPTH / 2 - 1e-6; s0 += BAR + GAP) {
      const sc = s0 + BAR / 2;                       // bar centre along the road
      const mx = c.x + tx * sc, my = c.y + ty * sc;
      const ax = tx * (BAR / 2), ay = ty * (BAR / 2);   // half-thickness along road
      const bx = px * half, by = py * half;             // half-width across road
      const pts = [[mx + ax + bx, my + ay + by], [mx + ax - bx, my + ay - by],
                   [mx - ax - bx, my - ay - by], [mx - ax + bx, my - ay + by]];
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const [X, Y] = view.project(pts[i][0], pts[i][1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// Junction control signs, drawn BILLBOARDED (axis-aligned in screen space, so they stay upright
// and readable no matter how the heading-up camera is rotated). `s` is the glyph half-size in px.
function drawSign(ctx, X, Y, kind, s) {
  ctx.save();
  ctx.lineJoin = "round";
  if (kind === "stop") drawStopSign(ctx, X, Y, s);
  else if (kind === "give_way") drawYieldSign(ctx, X, Y, s);
  else if (kind === "signal" || kind === "signals") drawSignal(ctx, X, Y, s);
  else if (kind === "priority_road") drawPriorityRoad(ctx, X, Y, s);
  ctx.restore();
}

// "Hlavní pozemní komunikace" (priority road) — yellow diamond with a white border.
function drawPriorityRoad(ctx, X, Y, s) {
  const r = s * 1.02;
  ctx.beginPath();
  ctx.moveTo(X, Y - r); ctx.lineTo(X + r, Y); ctx.lineTo(X, Y + r); ctx.lineTo(X - r, Y);
  ctx.closePath();
  ctx.fillStyle = "#f4c20d"; ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.16); ctx.strokeStyle = "#fff"; ctx.stroke();
}

function drawStopSign(ctx, X, Y, s) {
  ctx.beginPath();                                   // red octagon (flat top + bottom)
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    const px = X + s * Math.cos(a), py = Y + s * Math.sin(a);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#d2231f"; ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.12); ctx.strokeStyle = "#fff"; ctx.stroke();
  if (s >= 18) {                                     // only legible once zoomed in close
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.round(s * 0.5)}px ui-sans-serif,system-ui,sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("STOP", X, Y + s * 0.05);
  }
}

function drawYieldSign(ctx, X, Y, s) {
  const r = s * 1.15;                                // downward equilateral triangle, white + red rim
  ctx.beginPath();
  ctx.moveTo(X, Y + r);                              // bottom point
  ctx.lineTo(X - r * 0.866, Y - r * 0.5);            // top-left
  ctx.lineTo(X + r * 0.866, Y - r * 0.5);            // top-right
  ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.lineWidth = Math.max(1.2, s * 0.22); ctx.strokeStyle = "#d2231f"; ctx.stroke();
}

function drawSignal(ctx, X, Y, s) {
  const w = s * 0.95, h = s * 2.1;                   // dark housing + three lights (red/amber/green)
  roundRect(ctx, X - w / 2, Y - h / 2, w, h, w * 0.32);
  ctx.fillStyle = "#15181f"; ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.1); ctx.strokeStyle = "#39404e"; ctx.stroke();
  const rr = w * 0.3, cols = ["#e5484d", "#f6c453", "#34d399"];
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(X, Y - h * 0.30 + i * h * 0.30, rr, 0, 7);
    ctx.fillStyle = cols[i]; ctx.fill();
  }
}

// Labels for the ADJOINING streets — placed AT THE START of each cross street (a short way
// into the street itself, running along it), not across the current road. The current street's
// name lives in the HUD info block. One label per name, nearest junction wins.
// Shared label-collision guard (msg 2786): reserves axis-aligned screen boxes; tryPlace() returns
// false when a candidate overlaps an already-placed label, so callers can skip it. PAD keeps a small
// gap between labels. Rebuilt every frame (label positions move with the camera).
// Named bridges & tunnels (msg 2983): edges carry the way name + level (lv). Label each named structure
// once, in a tint that matches its surface (bridge bluish-light, tunnel grey), placed at the structure's
// midpoint and de-overlapped via the shared guard. Only structures that actually carry a name.
function drawStructureLabels(ctx, view, vis, zoom, guard) {
  if (zoom < 7) return;
  const seen = new Set();
  const fs = Math.max(10, Math.min(14, zoom * 0.7));
  ctx.font = `italic 600 ${fs}px ui-sans-serif,system-ui,sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const e of vis) {
    const lv = e.lv || 0;
    if (!lv || !e.name || seen.has(e.name)) continue;
    seen.add(e.name);
    const g = e.geom, m = g[Math.floor(g.length / 2)];
    const [X, Y] = view.project(m[0], m[1]);
    const w = ctx.measureText(e.name).width;
    if (!guard.tryPlace(X - w / 2 - 2, Y - fs / 2, X + w / 2 + 2, Y + fs / 2)) continue;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,11,16,.85)"; ctx.strokeText(e.name, X, Y);
    ctx.fillStyle = lv > 0 ? "#cfe0ff" : "#aeb8cb";    // bridge = light blue, tunnel = grey
    ctx.fillText(e.name, X, Y);
  }
}

function makeLabelGuard() {
  const placed = [];
  const PAD = 1.5;
  let kept = 0, dropped = 0;
  return {
    tryPlace(x0, y0, x1, y1) {
      const a = [x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD];
      for (const b of placed)
        if (!(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])) { dropped++; return false; }
      placed.push(a); kept++;
      return true;
    },
    stats: () => ({ kept, dropped }),       // de-overlap diagnostic (dropped>0 ⇒ overlaps were prevented)
  };
}

function edgeLen(e) {
  if (e._len != null) return e._len;          // geometry is immutable → cache the polyline length
  const g = e.geom; let L = 0;
  for (let i = 1; i < g.length; i++) L += Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]);
  return (e._len = L);
}

// Junction interior hulls (msg 3022): for each real intersection in view, the convex hull of a point a
// short way into every incident edge (+ the node). `core` is the tight hull (sign-inside test); `hull` is
// expanded a touch so the asphalt fill overlaps the road strokes with no seam; `lv` = carriageway level
// (we only fill at-grade junctions, so a bridge/tunnel interchange keeps its multi-level look — msg 3009).
function junctionHulls(view, vis, junctions) {
  const R = view.visR();
  const out = [];
  for (const j of junctions) {
    if ((j.deg != null && j.deg < 3) || !view.near(j.x, j.y, R)) continue;
    const inc = []; let maxHalf = 0, lvSum = 0, lvN = 0;
    for (const e of vis) {
      const g = e.geom, last = g.length - 1;
      const atStart = Math.hypot(g[0][0] - j.x, g[0][1] - j.y) < 4;
      const atEnd = !atStart && Math.hypot(g[last][0] - j.x, g[last][1] - j.y) < 4;
      if (!atStart && !atEnd) continue;
      maxHalf = Math.max(maxHalf, (e.width || 4) / 2);
      lvSum += e.lv || 0; lvN++;
      inc.push({ e, atStart });
    }
    if (inc.length < 3) continue;                       // only real intersections splay into gaps
    const rad = Math.min(20, maxHalf + 4);
    const pts = [[j.x, j.y]];
    for (const d of inc) {
      const wp = walkAlong(d.e.geom, d.atStart, Math.min(rad, edgeLen(d.e) * 0.5));
      pts.push([wp.x, wp.y]);
    }
    const core = convexHull(pts);
    if (core.length < 3) continue;
    out.push({ core, hull: expandPoly(core, 1.5), lv: lvN ? Math.round(lvSum / lvN) : 0 });
  }
  return out;
}

// Andrew's monotone-chain convex hull. Returns the hull vertices CCW; <3 input points pass through.
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const pt of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pt) <= 0) lo.pop(); lo.push(pt); }
  const hi = [];
  for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], pt) <= 0) hi.pop(); hi.push(pt); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

// Push every vertex `d` metres outward from the polygon centroid (so a fill overlaps adjoining strokes).
function expandPoly(poly, d) {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= poly.length; cy /= poly.length;
  return poly.map((p) => { const dx = p[0] - cx, dy = p[1] - cy, L = Math.hypot(dx, dy) || 1; return [p[0] + (dx / L) * d, p[1] + (dy / L) * d]; });
}

// Even-odd point-in-polygon (ray cast). poly = [[x,y]…] in world coords.
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[k][0], yj = poly[k][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Street names + their road number, at EVERY zoom (msg 3054). ONE label per NAME, anchored a short way INTO
// the street from the edge-end (= a junction) nearest the camera → off the intersection and world-static (it
// never slides as you drive, it just scrolls), de-overlapped via the shared guard (no dupes / pile-ups), with
// the road-number badge right beside the name (msg 3045). Thresholds scale with zoom: close up labels every
// street; zoomed out only the wider roads so it stays legible. The CURRENT road is in the HUD → skipped.
// The arterial network — classes that carry a road number / form the through-route skeleton. At minimum zoom we
// label these by CLASS, not by width: an OSM "primary" can bake to width 8–10 and a pure width gate (msg 3059)
// silently dropped Studentská/Sokolovská/Turistická, leaving only the very widest road named on the whole screen.
const MAJOR_CLS = new Set(["motorway", "trunk", "primary", "secondary",
                           "motorway_link", "trunk_link", "primary_link", "secondary_link"]);

function drawStreetLabels(ctx, view, edges, currentStreet, guard, nameRefs) {
  const z = view.zoom, R = view.visR();
  const fs = z >= 8 ? 11 : 13;                          // a touch larger when zoomed out
  // A "main" street: a classified arterial, anything carrying a road number, OR any LONG street — a street
  // whose edges sum to a large total length is a through-route even if OSM tags it tertiary/unclassified, and
  // Vlad wants every long main street named when zoomed out, not just the marked highways (msg 3068). Short
  // side streets fall below the length cutoff and stay unlabelled at overview zoom.
  const LONGMAIN = 600;  // metres of total name length → treat as a main street
  const mainStreet = (e) => MAJOR_CLS.has(e.cls) || !!e.ref || !!e.iref ||
                            ((nameRefs && nameRefs.get(e.name)?.len) || 0) >= LONGMAIN;
  // Which streets are worth a label at this zoom. Close in: anything with real width. Zoomed right out: the
  // main network — arterials, numbered roads and long through-streets — so it always reads even though those
  // edges aren't the widest on screen (msg 3059 / 3068). Mid band bridges the two.
  const worthy = (e) => z >= 8 ? (e.width || 0) >= 3
                      : z >= 4 ? ((e.width || 0) >= 7 || e.cls === "tertiary" || mainStreet(e))
                               : mainStreet(e);
  const pxPerM = (view.h * 0.5) / Math.max(R, 1);      // screen pixels per world metre at this zoom
  // Up close, one label per junction APPROACH so every road at a complex interchange is named (msg 3055). Zoomed
  // out, ONE label per road NAME — a fixed 170 m grid is only ~76 px wide at min zoom, so it stamped a road every
  // few pixels and piled the numbers onto the junction (msg 3059, "одной достаточно"). The de-overlap guard then
  // can't help, because 76-px-apart copies don't actually overlap.
  const perApproach = z >= 6;
  const minLen = perApproach ? (z >= 8 ? 20 : 38) : Math.max(38, 90 / pxPerM);  // zoomed out: only long arterials, never junction stubs
  const GAP = perApproach ? (z >= 8 ? 10 : 16) : Math.max(20, 26 / pxPerM);     // keep the label a constant screen margin off the node
  const NEAR2 = (R * 1.15) ** 2;                        // anchor within the view → covers the screen at any zoom
  const CELL = 170;                                    // per-approach cell: one label per name per ~170 m region
  const HH = fs * 0.6;                                  // approach gets labelled, but a road isn't swarmed (msg 3055)
  ctx.font = `600 ${fs}px ui-sans-serif,system-ui,sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  // The current street is NOT skipped — Vlad wants the name+number on its approaches too (msg 3055); the HUD
  // badge is just an always-on convenience on top of that.
  const best = new Map();
  for (const e of edges) {
    if (!e.name) continue;
    if (!worthy(e)) continue;
    const g = e.geom;
    if (g.length < 2) continue;
    const len = edgeLen(e);
    if (len < minLen) continue;
    const J0 = g[0], J1 = g[g.length - 1];
    const d0 = (J0[0] - view.cx) ** 2 + (J0[1] - view.cy) ** 2, d1 = (J1[0] - view.cx) ** 2 + (J1[1] - view.cy) ** 2;
    const near0 = d0 < NEAR2, near1 = d1 < NEAR2;
    if (!near0 && !near1) continue;
    const halfW = ctx.measureText(e.name).width / 2 / z;      // half label width in WORLD metres
    const off = Math.min(GAP + halfW, len * 0.5);             // this far INTO the street from the nearer node
    const fromStart = near0 && (!near1 || d0 <= d1);
    const p = walkAlong(g, fromStart, off);
    const d = fromStart ? d0 : d1;
    // up close: one label per (name, ~170 m cell) → each junction approach gets its own, but short connector edges
    // inside an interchange collapse to one (msg 3007 / 3055). zoomed out: one label per NAME, placed on the
    // approach nearest the camera → a road is named once, off-junction, never repeated (msg 3059).
    const key = perApproach ? e.name + "|" + Math.floor(p.x / CELL) + "," + Math.floor(p.y / CELL) : e.name;
    const prev = best.get(key);
    if (!prev || d < prev.d) best.set(key, { name: e.name, x: p.x, y: p.y, dirx: p.dirx, diry: p.diry, d });
  }
  // closest-junction labels first → the most relevant ones win the shared de-overlap guard (msg 2786)
  const cands = [...best.values()].sort((a, b) => a.d - b.d);
  const a = view.rot, c = Math.cos(a), s = Math.sin(a);
  for (const L of cands) {
    ctx.font = `600 ${fs}px ui-sans-serif,system-ui,sans-serif`;   // reset (drawNameRef changes the font)
    const [sx, sy] = view.project(L.x, L.y);
    let ang = Math.atan2(-(L.dirx * s + L.diry * c), L.dirx * c - L.diry * s);  // run text along the street
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;   // keep upright
    const hw = ctx.measureText(L.name).width / 2;
    const ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
    const ex = hw * ca + HH * sa, ey = hw * sa + HH * ca;
    if (guard && !guard.tryPlace(sx - ex, sy - ey, sx + ex, sy + ey)) continue;
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(ang);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,12,17,.78)"; ctx.strokeText(L.name, 0, 0);
    ctx.fillStyle = "rgba(220,228,242,.9)"; ctx.fillText(L.name, 0, 0);
    ctx.restore();
    drawNameRef(ctx, nameRefs && nameRefs.get(L.name), sx, sy, ang, hw, guard);   // road number beside the name (msg 3045)
  }
}

// Overview (bird's-eye): translucent DISTRICT/quarter names for orientation. Street names + their numbers are
// drawn at every zoom by drawStreetLabels now (msg 3054), so this only handles districts.
function drawOverviewLabels(ctx, view, districts, guard) {
  if (!districts || !districts.length) return;
  const R = view.visR();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "700 16px ui-sans-serif,system-ui,sans-serif";
  for (const d of districts) {
    if (!view.near(d.x, d.y, R * 1.25)) continue;
    const [X, Y] = view.project(d.x, d.y);
    const dw = ctx.measureText(d.name).width / 2;
    if (guard && !guard.tryPlace(X - dw, Y - 10, X + dw, Y + 10)) continue;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,10,15,.45)"; ctx.strokeText(d.name, X, Y);
    ctx.fillStyle = "rgba(206,216,232,.34)"; ctx.fillText(d.name, X, Y);   // полупрозрачно (msg 2763)
  }
}

// Walk `dist` metres along a polyline from one end; returns the point + local direction
// (pointing INTO the street, away from the starting end).
function walkAlong(geom, fromStart, dist) {
  const idx = fromStart ? geom.map((_, i) => i) : geom.map((_, i) => geom.length - 1 - i);
  let remain = dist;
  for (let k = 1; k < idx.length; k++) {
    const a = geom[idx[k - 1]], b = geom[idx[k]];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const L = Math.hypot(ex, ey);
    if (L < 1e-6) continue;
    if (remain <= L) {
      const t = remain / L;
      return { x: a[0] + ex * t, y: a[1] + ey * t, dirx: ex / L, diry: ey / L };
    }
    remain -= L;
  }
  // edge shorter than dist → far end + last segment direction
  const a = geom[idx[idx.length - 2]], b = geom[idx[idx.length - 1]];
  const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
  return { x: b[0], y: b[1], dirx: ex / L, diry: ey / L };
}

// Stylized top-down car (nose-up: forward = −y). Below ~5 px/m it becomes a fixed-size
// arrow for the bird's-eye overview mode (otherwise the real-scale car is a sub-pixel dot).
function drawCar(ctx, view, car) {
  // project the car's WORLD position (equals the screen anchor when the camera is car-centred, but
  // correct in route-overview where the camera is centred on the route, not the car — msg 2768)
  const [X, Y] = view.project(car.x, car.y);
  if (view.zoom < 5) {
    // arrow pointing along the heading in the current camera frame (north-up in overview)
    const c = Math.cos(view.rot), s = Math.sin(view.rot);
    const ux = Math.cos(car.h) * c - Math.sin(car.h) * s;
    const uy = -(Math.cos(car.h) * s + Math.sin(car.h) * c);
    drawCarArrow(ctx, X, Y, ux, uy);
    return;
  }
  const L = P.length * view.zoom, W = P.width * view.zoom;
  const r = (x, y, w, h, rad) => roundRect(ctx, x, y, w, h, rad);
  ctx.save();
  ctx.translate(X, Y);

  // wheels (drawn under the body, poking out at the sides)
  const wl = L * 0.20, ww = W * 0.16, wx = W * 0.5 - ww * 0.35;
  ctx.fillStyle = "#15181f";
  for (const sy of [-L * 0.30, L * 0.30]) {      // front & rear axles
    for (const sx of [-wx, wx - ww]) {           // left & right
      r(sx, sy - wl / 2, ww, wl, ww * 0.35);
      ctx.fill();
    }
  }

  // body
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
  const grad = ctx.createLinearGradient(0, -L / 2, 0, L / 2);
  grad.addColorStop(0, "#6fa8ff"); grad.addColorStop(1, "#4a86e6");
  r(-W / 2, -L / 2, W, L, Math.min(L, W) * 0.30);
  ctx.fillStyle = grad; ctx.fill();
  ctx.shadowBlur = 0;
  // subtle body outline
  ctx.lineWidth = Math.max(1, W * 0.04); ctx.strokeStyle = "rgba(10,14,22,.5)"; ctx.stroke();

  // cabin (roof) — darker, toward the middle
  r(-W * 0.34, -L * 0.10, W * 0.68, L * 0.42, W * 0.16);
  ctx.fillStyle = "#39557f"; ctx.fill();
  // windshield (front of cabin) + rear window — glass
  ctx.fillStyle = "rgba(12,16,24,.88)";
  r(-W * 0.30, -L * 0.10 - L * 0.085, W * 0.60, L * 0.10, 2); ctx.fill();  // windshield
  r(-W * 0.27, L * 0.30, W * 0.54, L * 0.075, 2); ctx.fill();              // rear window

  // headlights (front) & taillights (rear)
  ctx.fillStyle = "#fff3c4";
  r(-W * 0.42, -L / 2 + L * 0.015, W * 0.20, L * 0.05, 1.5); ctx.fill();
  r(W * 0.22, -L / 2 + L * 0.015, W * 0.20, L * 0.05, 1.5); ctx.fill();
  ctx.fillStyle = "#e5484d";
  r(-W * 0.40, L / 2 - L * 0.05, W * 0.18, L * 0.035, 1.5); ctx.fill();
  r(W * 0.22, L / 2 - L * 0.05, W * 0.18, L * 0.035, 1.5); ctx.fill();

  ctx.restore();
}

// fixed-size arrow for overview mode, pointing along the screen unit vector (ux,uy)
function drawCarArrow(ctx, X, Y, ux, uy) {
  const r = 13;
  const px = -uy, py = ux;                 // perpendicular
  ctx.save();
  ctx.translate(X, Y);
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(ux * r, uy * r);                                  // tip (forward)
  ctx.lineTo(-ux * r * 0.8 + px * r * 0.72, -uy * r * 0.8 + py * r * 0.72);
  ctx.lineTo(-ux * r * 0.4, -uy * r * 0.4);                    // tail notch
  ctx.lineTo(-ux * r * 0.8 - px * r * 0.72, -uy * r * 0.8 - py * r * 0.72);
  ctx.closePath();
  ctx.fillStyle = "#5b9cff"; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(10,14,22,.6)"; ctx.stroke();
  ctx.restore();
}
