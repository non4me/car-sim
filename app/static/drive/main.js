// car-sim /drive — heading-up free-roam: load district, spawn on a road, drive.
import { makeView } from "./render/view.js";
import { loadMap } from "./map/tiles.js";
import { Car } from "./vehicle/car.js";
import { makeInput } from "./vehicle/input.js";
import { draw } from "./render/draw.js";
import { evalRules } from "./rules/limits.js";
import { makeHud } from "./hud/hud.js";
import { makeHoverInfo } from "./hud/hover.js";
import { makeMinimap } from "./hud/minimap.js";
import { loadSearchIndex, makeSearchBox } from "./hud/search.js";
import { runLoop } from "./engine/loop.js";
import { T } from "./i18n.js";

const ZMIN = 1, ZMAX = 25;      // absolute zoom bounds in px/metre (msg 2768 halved min 2→1 for a wider overview)
const ZMIN_FIT = 0.25;          // route-overview may zoom out further so the whole route fits (msg 2768)
const ZOOM_DEFAULT = 16;        // starting zoom (px/m), wheel-adjustable, persisted
const OVERVIEW_Z = 5;           // below this px/m → bird's-eye overview (car drawn as an arrow)
const OFFROAD_WALL = 4.3;       // metres the car may sink off-road before a wall blocks going deeper
const FOLLOW_TURN = 1.85;       // rad/s — max auto-steer rate in route-follow (matches the car's turnRate)
const FOLLOW_LOOKAHEAD = 14;    // metres ahead on the route the auto-pilot aims for (pure-pursuit)

function pickSpawn(map) {
  const b = map.meta.bounds;
  const cx = (b.minx + b.maxx) / 2, cy = (b.miny + b.maxy) / 2;
  let best = null, bd = Infinity;
  for (const e of map.edges) {
    if (e.geom.length < 2) continue;
    const mid = e.geom[Math.floor(e.geom.length / 2)];
    const d = Math.hypot(mid[0] - cx, mid[1] - cy) - (e.width > 6 ? 50 : 0);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return { x: cx, y: cy, h: 0 };   // no resident road yet (streaming) — spawn at centre
  const g = best.geom, i = Math.max(1, Math.floor(g.length / 2));
  const a = g[i - 1], c = g[i];
  return { x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2, h: Math.atan2(c[1] - a[1], c[0] - a[0]) };
}

// Zoom is now an absolute px/metre the user controls with the wheel (Vlad directs by the
// on-screen number). At speed it eases out a touch for look-ahead, never below ZMIN.
const speedEase = (speed) => 1 - 0.2 * Math.min(1, speed / 16);   // 1.0 at rest → 0.8 at ~58 km/h

function readSavedPos(key) {
  try {
    const s = JSON.parse(localStorage.getItem(key) || "null");
    if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.h)) return s;
  } catch { /* ignore corrupt value */ }
  return null;
}

function bboxOf(poly) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of poly) {
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  return { cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, w: maxx - minx, h: maxy - miny };
}

async function boot() {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const view = makeView(canvas);
  view.resize();
  window.addEventListener("resize", view.resize);

  const map = await loadMap(window.CARSIM.dataBase);
  // restore the last car position (msg 2775) — per-district key in localStorage; falls back to a
  // road near the city centre on first visit. (Server-side persistence will hook in here once the
  // accounts system lands.)
  const POS_KEY = `carsim_pos_${window.CARSIM.district}`;
  const sp = readSavedPos(POS_KEY) || pickSpawn(map);
  const car = new Car(sp.x, sp.y, sp.h);
  car.layer = 0;                       // carriageway level (msg 2980): updated each frame from the snapped edge
  // metres the car's centre is past the road edge (0 = on the drivable surface) — measured against roads on
  // the car's OWN level, so a car under a bridge isn't "on" the overpass passing above it (msg 2980)
  const offroadPen = (x, y) => {
    const ne = map.nearestEdge(x, y, car.layer);
    return ne.edge ? Math.max(0, ne.dist - (ne.edge.width / 2 + 1.0)) : 0;
  };
  const input = makeInput();
  const hud = makeHud();
  // hover → native title tooltip describing the map object under the cursor (msg 3074). landmarks load
  // async, so pass a getter that reads the live closure value rather than a snapshot of the empty array.
  makeHoverInfo(canvas, view, map, () => ({ landmarks }));
  const minimap = makeMinimap(
    document.getElementById("mini"),
    document.getElementById("miniPlus"),
    document.getElementById("miniMinus"),
    document.getElementById("miniLevel"),
    document.getElementById("miniCity"),
    document.getElementById("miniRoute"),
  );
  let rules = evalRules(map, car);
  let dbg = null;
  let paused = false;
  let miniCollapsed = false;
  let routeLine = null;   // server-computed route polyline (world coords), drawn over the asphalt when set
  let routeFollowOn = false;   // auto-drive along routeLine (steering auto, throttle/brake = user)
  let routeI = 0;              // progress index along routeLine (segment the car is on)
  let routeBox = null;         // routeLine bbox {cx,cy,w,h} → fits the whole route into the minimap (msg 2777/2784)
  let saveTick = 0;            // throttles persisting the car position to localStorage (msg 2775)
  const savePos = () => { try { localStorage.setItem(POS_KEY, JSON.stringify({ x: +car.x.toFixed(1), y: +car.y.toFixed(1), h: +car.h.toFixed(3) })); } catch { /* quota */ } };
  window.addEventListener("beforeunload", savePos);   // also save on close/reload
  let dbgFollow = null;        // last auto-pilot target+index (headless debug hook)
  let districts = [];          // {name,x,y,kind} district/quarter labels (overview mode 2763 + City/Trasa minimap 2784)
  let landmarks = [];          // {name,x,y,kind} major city-wide objects for the City/Trasa minimap (msg 2784)
  let overview = null;         // {water,roads,green} city-wide landscape for the City minimap (msg 2959)
  let admin = [];              // {name,x,y,n,poly} official city districts (dashed outlines + numbers) — City minimap (msg 2964/2970)
  let roadRefs = [];           // {ref,x,y,m} numbered-highway badge points (D0/D1/…) for the City minimap (msg 2971)

  // minimap opacity (10–100%) + collapse-to-icon, both persisted (msg 2691)
  const miniEl = document.getElementById("minimap");
  const miniRestore = document.getElementById("miniRestore");
  const miniOpacity = document.getElementById("miniOpacity");
  const applyOpacity = (v) => { miniEl.style.opacity = (v / 100).toFixed(2); };
  const savedOp = parseInt(localStorage.getItem("carsim_mini_opacity"), 10);
  miniOpacity.value = Number.isFinite(savedOp) ? savedOp : 100;
  applyOpacity(miniOpacity.value);
  miniOpacity.addEventListener("input", () => {
    applyOpacity(miniOpacity.value);
    localStorage.setItem("carsim_mini_opacity", miniOpacity.value);
  });
  const setCollapsed = (c) => {
    miniCollapsed = c;
    miniEl.classList.toggle("hidden", c);
    miniRestore.classList.toggle("hidden", !c);
    localStorage.setItem("carsim_mini_collapsed", c ? "1" : "0");
  };
  document.getElementById("miniCollapse").addEventListener("click", (e) => { e.preventDefault(); setCollapsed(true); });
  miniRestore.addEventListener("click", (e) => { e.preventDefault(); setCollapsed(false); });
  setCollapsed(localStorage.getItem("carsim_mini_collapsed") === "1");

  // persisted absolute zoom (px/m), restored across sessions
  const clampZoom = (z) => Math.max(ZMIN, Math.min(ZMAX, z));
  let zTarget = clampZoom(parseFloat(localStorage.getItem("carsim_zoom")) || ZOOM_DEFAULT);
  view.zoom = zTarget;

  // mouse-wheel zoom (absolute px/m within bounds; persisted)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zTarget = clampZoom(zTarget * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    localStorage.setItem("carsim_zoom", zTarget.toFixed(2));
  }, { passive: false });

  // ---- Free-look camera (Vlad msg 2943): left-drag pans the map, right-drag orbits it, double-click
  // snaps the car onto the nearest street. While free, the camera detaches from the car; the next
  // drive key (or a double-click that repositions the car) re-attaches it heading-up.
  let freeCam = false;
  const cam = { cx: 0, cy: 0, rot: 0 };               // free camera pose (world centre + rotation)
  const enterFree = () => { if (!freeCam) { freeCam = true; cam.cx = view.cx; cam.cy = view.cy; cam.rot = view.rot; } };
  const exitFree = () => { freeCam = false; };
  const ORBIT_SENS = 0.006;                            // radians of rotation per px of horizontal drag
  const DRAG_THRESH = 3;                               // px before a press becomes a drag (so a plain click/dblclick is untouched)
  let press = null;                                    // {button, sx, sy}: a held button, also the running "last" point while dragging
  let drag = null;                                     // null | 'pan' | 'orbit'
  const evXY = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 && e.button !== 2) return;      // left or right only
    const [sx, sy] = evXY(e);
    press = { button: e.button, sx, sy }; drag = null;
  });
  window.addEventListener("mousemove", (e) => {
    if (!press) return;
    const [sx, sy] = evXY(e);
    if (!drag) {                                       // promote to a drag once past the threshold
      if (Math.hypot(sx - press.sx, sy - press.sy) < DRAG_THRESH) return;
      drag = press.button === 2 ? "orbit" : "pan";     // right-button orbits, left-button pans
      enterFree();
    } else if (drag === "pan") {                       // grab: keep the world point under the cursor
      const c = Math.cos(cam.rot), s = Math.sin(cam.rot), z = view.zoom;
      const rx = (sx - press.sx) / z, ry = -(sy - press.sy) / z;
      cam.cx -= c * rx + s * ry;
      cam.cy -= -s * rx + c * ry;
    } else {                                           // orbit around the screen centre
      cam.rot += (sx - press.sx) * ORBIT_SENS;
    }
    press.sx = sx; press.sy = sy;
  });
  const endDrag = () => { press = null; drag = null; };
  window.addEventListener("mouseup", endDrag);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());   // right-drag orbits — suppress the menu
  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    const [sx, sy] = evXY(e);
    const [wx, wy] = view.unproject(sx, sy);
    goTo(wx, wy);                                      // teleport + snap onto the nearest road there
    exitFree();                                        // camera re-follows the car at its new spot
  });

  // controls overlay (first visit only, then "?"), pause (Esc), any-key dismiss
  const ov = document.getElementById("helpOverlay");
  const pauseEl = document.getElementById("pauseOverlay");
  const overlayOpen = () => !ov.classList.contains("hidden");
  const closeHelp = () => { ov.classList.add("hidden"); localStorage.setItem("carsim_help_seen", "1"); };
  const openHelp = () => ov.classList.remove("hidden");
  const setPaused = (p) => { paused = p; pauseEl.classList.toggle("hidden", !paused); };
  document.getElementById("helpBtn").addEventListener("click", (e) => { e.preventDefault(); openHelp(); });
  document.getElementById("helpClose").addEventListener("click", (e) => { e.preventDefault(); closeHelp(); });
  ov.addEventListener("click", (e) => { if (e.target === ov) closeHelp(); });
  const typingInBox = () => {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  };
  window.addEventListener("keydown", (e) => {
    if (typingInBox()) return;                        // let the search box keep its own keys (Esc/Enter/arrows)
    if (overlayOpen()) { closeHelp(); return; }      // any key dismisses the controls overlay
    if (e.key === "Escape") { e.preventDefault(); setPaused(!paused); }   // Esc = pause/resume while driving
  });
  // auto-pause when the window/tab loses focus, so keys that never reach the page can't be
  // mistaken for "the car won't move/turn" (msg 2699). Returning focus resumes.
  window.addEventListener("blur", () => { if (!overlayOpen()) setPaused(true); });
  window.addEventListener("focus", () => setPaused(false));
  pauseEl.addEventListener("click", () => setPaused(false));   // click the pause overlay to resume

  // street / district search → teleport: jump to the target, stream its tiles, snap onto the road
  async function goTo(x, y) {
    setPaused(false);
    car.x = x; car.y = y; car.v = 0;                  // jump there; render() now streams around it
    for (let i = 0; i < 30; i++) {
      const ne = map.nearestEdge(x, y);
      if (ne.edge && ne.dist < 60) { car.x = ne.px; car.y = ne.py; car.h = Math.atan2(ne.ty, ne.tx); car.v = 0; car.layer = ne.edge.lv || 0; return; }
      await new Promise((r) => setTimeout(r, 80));    // wait for the destination tiles to stream in
    }
  }
  loadSearchIndex(window.CARSIM.dataBase).then(({ items, places, landmarks: lms, admin: adm, roadRefs: rr }) => {
    makeSearchBox(document.getElementById("searchInput"), document.getElementById("searchResults"), items, goTo);
    setupRoute(items);
    districts = places.length ? places : items.filter((i) => i.kind === "district");  // keep place-kind for City/Trasa (msg 2784)
    landmarks = lms;                                          // major city-wide objects for the City/Trasa minimap
    admin = adm || [];                                        // official districts — the City minimap's only labels (msg 2964)
    roadRefs = rr || [];                                      // numbered-highway badges (msg 2971)
  });
  // city-wide landscape (river/main roads/parks) for the minimap "City" mode (msg 2959) — loaded once
  fetch(`${window.CARSIM.dataBase}/overview.json`).then((r) => (r.ok ? r.json() : null))
    .then((o) => { overview = o; }).catch(() => {});
  // admin-placed objects (msg 2983 ph3) — standard/custom icons at a geolocation; drawn on the main map.
  // Stored on `map` so the render loop picks them up; rebuild() (tile streaming) leaves this field intact.
  fetch(`/api/objects?city=${encodeURIComponent(window.CARSIM.city)}`).then((r) => (r.ok ? r.json() : []))
    .then((o) => { map.objects = Array.isArray(o) ? o : []; }).catch(() => {});

  // Route panel: pick two streets, ask the server for the shortest drivable path (one-ways honoured),
  // draw it as a ribbon and teleport the car to its start so you can drive the route yourself.
  function setupRoute(items) {
    const panel = document.getElementById("routePanel");
    const btn = document.getElementById("routeBtn");
    const fromEl = document.getElementById("routeFrom");
    const toEl = document.getElementById("routeTo");
    const goBtn = document.getElementById("routeGo");
    const info = document.getElementById("routeInfo");
    const followEl = document.getElementById("routeFollow");
    let from = null, to = null, fromIsCurrent = false;   // fromIsCurrent → "From" = the car's live position
    // auto-pilot toggle: only meaningful with a route; throttle/brake stay manual (msg 2759 #3)
    followEl.addEventListener("change", () => { routeFollowOn = followEl.checked && !!routeLine; routeI = 0; });
    // (the whole-route view moved to the minimap "Trasa" button — msg 2784)
    const syncGo = () => { goBtn.disabled = !(from && to); };
    // capture {x,y} of the picked street instead of teleporting (3rd arg = onPick coords). Picking a
    // street explicitly clears the "current position" default.
    makeSearchBox(fromEl, document.getElementById("routeFromRes"), items,
      (x, y) => { from = { x, y }; fromIsCurrent = false; info.textContent = to ? T("d_ready", "připraveno") : T("d_pickdest", "vyber cíl"); info.className = ""; syncGo(); });
    makeSearchBox(toEl, document.getElementById("routeToRes"), items,
      (x, y) => { to = { x, y }; info.textContent = from ? T("d_ready", "připraveno") : T("d_pickstart", "vyber start"); info.className = ""; syncGo(); });
    // default "Odkud" to the street the car is on now, so the common case is "route from here"
    const prefillFrom = () => {
      if (fromEl.value || !(rules && rules.street)) return;
      fromEl.value = rules.street;
      from = { x: car.x, y: car.y }; fromIsCurrent = true;
      info.textContent = to ? T("d_ready", "připraveno") : T("d_pickdest", "vyber cíl"); info.className = ""; syncGo();
    };
    btn.addEventListener("click", () => {
      const opening = panel.classList.contains("hidden");
      panel.classList.toggle("hidden");
      btn.classList.toggle("on", !panel.classList.contains("hidden"));
      if (opening) { prefillFrom(); (from ? toEl : fromEl).focus(); }   // From filled → cursor goes to "Kam"
    });
    goBtn.addEventListener("click", async () => {
      if (fromIsCurrent) from = { x: car.x, y: car.y };   // refresh to the car's live position at search time
      if (!from || !to) return;
      info.textContent = T("d_searching", "hledám trasu…"); info.className = "";
      try {
        const u = `/route?city=${encodeURIComponent(window.CARSIM.city)}`
          + `&district=${encodeURIComponent(window.CARSIM.district)}`
          + `&fx=${from.x}&fy=${from.y}&tx=${to.x}&ty=${to.y}`;
        const res = await fetch(u).then((r) => r.json());
        if (res.polyline && res.polyline.length > 1) {
          routeLine = res.polyline; routeI = 0; routeBox = bboxOf(routeLine);
          followEl.disabled = false;                    // auto-pilot now available
          routeFollowOn = followEl.checked;             // honour a pre-ticked toggle (minimap "Trasa" auto-enables)
          info.textContent = `${T("d_route", "trasa")} ${(res.length_m / 1000).toFixed(2)} km`; info.className = "ok";
          goTo(routeLine[0][0], routeLine[0][1]);       // drop the car at the route's start, on the road
        } else {
          routeLine = null; routeFollowOn = false; info.textContent = T("d_notfound", "trasa nenalezena"); info.className = "err";
        }
      } catch (err) {
        routeLine = null; info.textContent = T("d_connerr", "chyba spojení"); info.className = "err";
      }
    });
    document.getElementById("routeClear").addEventListener("click", () => {
      routeLine = null; routeBox = null; from = null; to = null; fromIsCurrent = false;
      routeFollowOn = false; followEl.checked = false; followEl.disabled = true;
      fromEl.value = ""; toEl.value = "";
      info.textContent = T("d_pick2", "vyber dvě ulice"); info.className = ""; syncGo();
    });
  }

  // ROUTE AUTO-PILOT (msg 2759 #3): pure-pursuit a point FOLLOW_LOOKAHEAD m ahead on the route.
  // Returns the world target, or {done:true} at the destination. Tracks routeI so it never walks
  // backward (and only scans a forward window, so 600-point routes stay cheap per frame).
  function routeTarget() {
    const R = routeLine;
    let bi = routeI, bd = Infinity, bt = 0;
    for (let i = routeI; i < R.length - 1 && i < routeI + 40; i++) {
      const ax = R[i][0], ay = R[i][1], dx = R[i + 1][0] - ax, dy = R[i + 1][1] - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((car.x - ax) * dx + (car.y - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy, d = (car.x - cx) ** 2 + (car.y - cy) ** 2;
      if (d < bd) { bd = d; bi = i; bt = t; }
    }
    routeI = bi;
    let look = FOLLOW_LOOKAHEAD, i = bi;
    let px = R[i][0] + (R[i + 1][0] - R[i][0]) * bt, py = R[i][1] + (R[i + 1][1] - R[i][1]) * bt;
    while (i < R.length - 1) {
      const bx = R[i + 1][0], by = R[i + 1][1], seg = Math.hypot(bx - px, by - py);
      if (seg >= look) { const t = look / seg; return { x: px + (bx - px) * t, y: py + (by - py) * t, done: false }; }
      look -= seg; i++; px = R[i][0]; py = R[i][1];
    }
    const end = R[R.length - 1];
    return { x: end[0], y: end[1], done: Math.hypot(car.x - end[0], car.y - end[1]) < 8 };
  }

  // Lane-keep (msg 2759 #2): when cruising straight (not steering), ease the heading onto the road
  // tangent (in the travel direction) and the position toward the lane centre — the right half of a
  // two-way carriageway (RHT), the centreline of a one-way. Gentle + only when already roughly
  // aligned, so deliberate crossings/turns aren't fought.
  function laneAlign(dt) {
    const ne = map.nearestEdge(car.x, car.y, car.layer);
    if (!ne.edge) return;
    let tx = ne.tx, ty = ne.ty;
    if (Math.cos(car.h) * tx + Math.sin(car.h) * ty < 0) { tx = -tx; ty = -ty; }   // align to travel dir
    let dh = Math.atan2(ty, tx) - car.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    if (Math.abs(dh) > 1.0) return;                              // >~57° off → a turn/crossing, don't fight
    car.h += dh * Math.min(1, 3.0 * dt);                        // ease heading onto the road
    const offset = ne.edge.oneway ? 0 : ne.edge.width / 4;      // lane centre: right of travel (RHT)
    const cx = ne.px + ty * offset, cy = ne.py - tx * offset;
    const kp = Math.min(1, 1.6 * dt);
    car.x += (cx - car.x) * kp; car.y += (cy - car.y) * kp;
  }

  function update(dt) {
    if (paused) return;                               // Esc / lost focus freezes the sim
    const controls = dbg || input.controls();
    // any drive key re-attaches the camera to the car (exits free-look, msg 2943)
    if (freeCam && (controls.throttle || controls.brake || controls.hard || controls.turn)) exitFree();
    // ONE driving model everywhere (heading-up, rotate-in-place). Off-road: NEVER brake (msg 2759 #1) —
    // overview (arrow) roams free; at normal zoom a soft wall only blocks going DEEPER past OFFROAD_WALL,
    // keeping the car's speed so you can steer back out. Only the map boundary is a hard wall.
    const wall = view.zoom < OVERVIEW_Z ? Infinity : OFFROAD_WALL;
    const px = car.x, py = car.y;
    car.blocked = false;

    const following = routeFollowOn && routeLine && routeLine.length > 1;
    let handled = false;
    if (following) {
      const tgt = routeTarget();
      dbgFollow = { tx: tgt.x, ty: tgt.y, i: routeI, done: tgt.done };   // debug hook
      if (tgt.done) { car.v = 0; finishRoute(); handled = true; }   // arrived → stop, hand back to manual
      else {
        const desired = Math.atan2(tgt.y - car.y, tgt.x - car.x);   // pure-pursuit: aim at the look-ahead
        let dh = Math.atan2(Math.sin(desired - car.h), Math.cos(desired - car.h));
        const mt = FOLLOW_TURN * dt;
        car.h += Math.max(-mt, Math.min(mt, dh));                   // auto-steer (rate-limited)
        car.update(dt, { throttle: controls.throttle, brake: controls.brake, hard: controls.hard, turn: 0 });
        handled = true;
      }
    }
    if (!handled) car.update(dt, controls);

    rules = evalRules(map, car);
    if (rules.onSurface) car.layer = rules.lv;   // adopt the level of the road we're on; keep it while off-road (msg 2980)
    if (rules.boundary) { car.x = px; car.y = py; car.v = 0; car.blocked = true; }   // map edge = real wall
    else if (!following) {
      // off-road soft wall — but NOT while auto-following: the server route is on-road by construction,
      // so the wall (which depends on whatever tiles have streamed in) must never fight it (would trap
      // the car when a narrow street hasn't streamed into the grid yet).
      const pen = offroadPen(car.x, car.y);
      if (pen > wall && pen > offroadPen(px, py)) { car.x = px; car.y = py; car.blocked = true; }  // block deeper, DON'T brake
    }
    // auto-align onto the lane after a turn — not while steering / auto-following / off-road / crawling
    if (!following && controls.turn === 0 && car.v > 1 && rules.onSurface) laneAlign(dt);
  }

  // route-follow finished/aborted: drop auto-pilot and reflect it in the panel toggle + info
  function finishRoute() {
    routeFollowOn = false;
    const f = document.getElementById("routeFollow"); if (f) f.checked = false;
    const info = document.getElementById("routeInfo");
    if (info) { info.textContent = T("d_arrived", "cíl ✓"); info.className = "ok"; }
  }

  const zoomEl = document.getElementById("zoomind");
  function render() {
    // main window always follows the car heading-up — route auto-follow must NOT zoom it out (msg 2777
    // reverted the route-overview camera; the whole route is shown in the MINIMAP instead, on demand).
    const target = clampZoom(freeCam ? zTarget : zTarget * speedEase(Math.abs(car.v)));
    view.zoom += (target - view.zoom) * 0.12;   // smooth zoom transitions
    if (freeCam) {                               // detached free-look — user pans/orbits (msg 2943)
      view.cx = cam.cx; view.cy = cam.cy; view.rot = cam.rot;
    } else {
      view.setCamera(car.x, car.y, car.h);       // heading-up at every zoom — car always points up
    }
    // stream tiles around whatever the camera looks at — the car when following, the free centre when panning
    const vx = freeCam ? cam.cx : car.x, vy = freeCam ? cam.cy : car.y;
    map.update(vx, vy, Math.max(view.visR(), 480), freeCam ? 0 : car.v * Math.cos(car.h), freeCam ? 0 : car.v * Math.sin(car.h));
    draw(ctx, view, map, car, rules, routeLine, districts);
    // hide violation warnings in bird's-eye — only when the car shows (msg 2768)
    hud.update(rules, view.zoom < OVERVIEW_Z);
    // minimap modes (City / Trasa buttons on the minimap, msg 2784) — pass the city-wide overview data;
    // the minimap itself decides local vs city vs route based on its buttons.
    if (!miniCollapsed) minimap.draw(map, car, rules.street, {
      districts, landmarks, overview, admin, roadRefs, cityName: window.CARSIM.cityName,
      route: routeLine && routeBox ? { line: routeLine, box: routeBox } : null,
    });
    // live zoom readout so Vlad can orient/direct by the number (current px/m · range)
    if (zoomEl) zoomEl.textContent = `zoom ${view.zoom < 1 ? view.zoom.toFixed(1) : Math.round(view.zoom)} px/m · ${ZMIN}–${ZMAX}`;
    // persist the car position ~every 1.5 s so a reload resumes where you were (msg 2775)
    if (++saveTick % 90 === 0) savePos();
  }

  window.__drive = {
    car, map, view, rules: () => rules,
    routeLine: () => routeLine, following: () => routeFollowOn, followDbg: () => dbgFollow,   // headless route-test hooks
    set: (o) => { dbg = o; }, clear: () => { dbg = null; },
    // manual deterministic advance (for headless verification when RAF is throttled)
    tick: (n = 1) => { for (let i = 0; i < n; i++) update(1 / 60); render(); return { x: car.x, y: car.y, h: car.h, kmh: car.speedKmh, street: rules.street, zoom: +view.zoom.toFixed(1) }; },
  };
  runLoop(update, render);
}

boot();
