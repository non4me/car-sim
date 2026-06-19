#!/usr/bin/env python3
"""Bake a city district from OpenStreetMap into a runtime-ready, tiled map artifact
for the real-map driving simulator.

Pipeline: Overpass fetch → keep drivable highways → split ways at shared junction
nodes into edges → resolve {lanes, width, oneway, maxspeed, name, class} via the
country rules profile → derive junction control → project to local metres → tile by
a grid → write tiles/*.json + meta.json, and a debug PNG to eyeball vs the real map.

Usage:
  python tools/bake_city.py <district> [--country cz] [--debug-only]

Districts are named bboxes below (S,W,N,E). Data © OpenStreetMap contributors (ODbL).
"""
import argparse
import json
import math
import re
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import yaml
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OVERPASS = "https://overpass-api.de/api/interpreter"
TILE_M = 400  # tile grid size in metres

# named district bboxes (south, west, north, east)
DISTRICTS = {
    "vinohrady":   (50.0720, 14.4350, 50.0830, 14.4520),
    "stare_mesto": (50.0820, 14.4130, 50.0920, 14.4300),
    "zizkov":      (50.0780, 14.4450, 50.0880, 14.4650),
    "smichov":     (50.0640, 14.3950, 50.0760, 14.4150),
}

CLASS_COLOR = {  # debug PNG only
    "motorway": (230, 90, 70), "trunk": (235, 130, 70), "primary": (240, 170, 70),
    "secondary": (240, 210, 90), "tertiary": (200, 210, 120), "residential": (150, 160, 175),
    "unclassified": (150, 160, 175), "living_street": (130, 150, 160), "service": (95, 105, 120),
}


def get(url: str, data: bytes | None = None) -> dict:
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": "car-sim-bake/1.0 (vladimir.troyanenko@gmail.com)",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def fetch_osm(bbox) -> dict:
    s, w, n, e = bbox
    bb = f"({s},{w},{n},{e})"
    # drivable highways + schematic backdrop (building footprints, greens, water) as ways.
    # Ways only (skip multipolygon relations) — keeps geometry assembly simple for the MVP.
    q = (f"[out:json][timeout:180];("
         f'way["highway"]{bb};'
         f'way["building"]{bb};'
         f'way["leisure"~"^(park|garden|playground|pitch|recreation_ground|dog_park)$"]{bb};'
         f'way["landuse"~"^(grass|forest|meadow|village_green|cemetery|recreation_ground)$"]{bb};'
         f'way["natural"="water"]{bb};'
         # `out body` on the recursed nodes (not `skel`) so node TAGS come through —
         # we need highway=traffic_signals/stop/give_way to derive junction control.
         f");out body; >; out body qt;")
    return get(OVERPASS, data=q.encode("utf-8"))


RAILWAY_KINDS = {"rail", "light_rail", "narrow_gauge", "tram"}


def road_level(tags: dict) -> int:
    """Carriageway level for multi-level interchanges (msg 2980): the OSM `layer` int if tagged, else
    +1 for a bridge / -1 for a tunnel, else 0. Lets the runtime keep roads on different levels apart so
    the car can't hop from a street onto an overpass passing above it."""
    lz = tags.get("layer")
    if lz not in (None, ""):
        try:
            return int(float(lz))
        except (ValueError, TypeError):
            pass
    if tags.get("bridge") in ("yes", "viaduct"):
        return 1
    if tags.get("tunnel") in ("yes", "building_passage"):
        return -1
    return 0


def railway_kind(tags: dict) -> str | None:
    """Surface railway line → 'rail' (heavy/light) or 'tram'. Underground (subway/tunnel) skipped."""
    rw = tags.get("railway")
    if rw not in RAILWAY_KINDS:
        return None
    if tags.get("tunnel") in ("yes", "building_passage") or tags.get("location") == "underground":
        return None
    return "tram" if rw == "tram" else "rail"


def landmark_kind(tags: dict) -> str | None:
    """Curated 'major city object' classifier (msg 2771): a NAMED feature with a significant tag.
    The NOISY classes (monument/memorial, generic attraction, place_of_worship) are gated on
    wikidata/wikipedia notability — that's the "понять сам как определять" filter that keeps the
    map to genuinely major objects rather than every statue/plaque/chapel."""
    if not tags.get("name"):
        return None
    notable = bool(tags.get("wikidata") or tags.get("wikipedia"))
    tour, hist = tags.get("tourism"), tags.get("historic")
    am, leis = tags.get("amenity"), tags.get("leisure")
    if tour in ("museum", "gallery"):
        return "museum"
    if tour in ("zoo", "theme_park", "aquarium"):
        return "attraction"
    if tour in ("attraction", "viewpoint") and notable:
        return "attraction"
    if hist in ("castle", "palace", "fort"):
        return "castle"
    if hist in ("monument", "memorial") and notable:
        return "monument"
    if am == "theatre":
        return "theatre"
    if am in ("university", "college"):
        return "university"
    if am == "hospital":
        return "hospital"
    if am == "townhall":
        return "townhall"
    if leis == "stadium":
        return "stadium"
    if tags.get("aeroway") == "aerodrome":
        return "airport"
    if am == "place_of_worship" and notable:
        return "church"
    return None


def poi_kind(tags: dict) -> str | None:
    """Everyday POIs to show along the street you're driving (msg 2771): pharmacies, ATMs, banks,
    eateries, fuel, shops, emergency/post. Distinct from the big landmarks in landmark_kind()."""
    am, shop = tags.get("amenity"), tags.get("shop")
    if am == "pharmacy":
        return "pharmacy"
    if am == "atm":
        return "atm"
    if am in ("bank", "bureau_de_change"):
        return "bank"
    if am in ("restaurant", "cafe", "fast_food", "bar", "pub", "biergarten", "food_court"):
        return "food"
    if am == "fuel":
        return "fuel"
    if am == "police":
        return "police"
    if am == "fire_station":
        return "fire"
    if am == "post_office":
        return "post"
    if shop in ("supermarket", "convenience", "bakery", "mall", "greengrocer", "butcher", "kiosk"):
        return "shop"
    return None


def classify_area(tags: dict) -> str | None:
    """Map an OSM closed way to a schematic backdrop kind, or None if not backdrop."""
    if tags.get("building"):
        return "building"
    if tags.get("natural") == "water":
        return "water"
    if tags.get("leisure") in ("park", "garden", "playground", "pitch", "recreation_ground", "dog_park"):
        return "green"
    if tags.get("landuse") in ("grass", "forest", "meadow", "village_green", "cemetery", "recreation_ground"):
        return "green"
    return None


def build_areas(osm_ways, nodes, to_xy, include_water=True) -> list[dict]:
    """Closed backdrop ways → projected polygons {kind, poly}, lightly simplified. When water is
    supplied pre-assembled (multipolygon-aware, see water_areas), skip natural=water ways here so
    they aren't drawn twice."""
    areas = []
    for wy in osm_ways:
        kind = classify_area(wy.get("tags", {}))
        if not kind or (kind == "water" and not include_water):
            continue
        nl = wy["nodes"]
        if len(nl) < 4 or nl[0] != nl[-1]:   # need a closed ring
            continue
        pts = [to_xy(nodes[x]["lat"], nodes[x]["lon"]) for x in nl if x in nodes]
        if len(pts) < 4:
            continue
        # drop vertices closer than ~1.2 m to the previous one (schematic; shrinks payload)
        poly = [pts[0]]
        for p in pts[1:]:
            if math.hypot(p[0] - poly[-1][0], p[1] - poly[-1][1]) >= 1.2:
                poly.append(p)
        if len(poly) < 3:
            continue
        areas.append({"kind": kind, "poly": [[round(x, 1), round(y, 1)] for x, y in poly]})
    return areas


# --- projection: local equirectangular metres about bbox centre ---
def make_proj(bbox):
    s, w, n, e = bbox
    lat0 = (s + n) / 2
    lon0 = (w + e) / 2
    kx = 111320 * math.cos(math.radians(lat0))
    ky = 110540
    def to_xy(lat, lon):
        return ((lon - lon0) * kx, (lat - lat0) * ky)  # y north-positive
    return to_xy, {"lat0": lat0, "lon0": lon0, "kx": kx, "ky": ky}


def parse_maxspeed(val, context, profile):
    d = profile["default_limits"]
    if val:
        v = str(val).strip().lower()
        m = {"cz:urban": d["urban"], "cz:rural": d["rural"], "cz:motorway": d["motorway"],
             "cz:living_street": d["living_street"], "cz:pedestrian_zone": d["pedestrian_zone"],
             "walk": 5, "none": d["motorway"]}
        if v in m:
            return m[v]
        try:
            return int(v.split()[0])
        except ValueError:
            pass
    return d.get(context, d["urban"])


def bake(district: str, country: str, debug_only: bool):
    bbox = DISTRICTS[district]
    print(f"[{district}] fetching OSM…")
    osm = fetch_osm(bbox)
    nodes = {el["id"]: el for el in osm["elements"] if el["type"] == "node"}
    all_ways = [el for el in osm["elements"] if el["type"] == "way"]
    out = ROOT / "data" / "cities" / country / "praha" / district
    build_artifact(nodes, all_ways, bbox, country, district, out, debug_only)


def _project_water(water_areas, to_xy, tol=4.0) -> list[dict]:
    """Pre-assembled water rings (lat/lon, multipolygon-aware) → {kind:water, poly, holes?} in metres.
    Coarser simplify than ways (water bodies are large + schematic); islands kept as `holes`."""
    def ring(latlon):
        pts = [to_xy(lat, lon) for lat, lon in latlon]
        if len(pts) < 4:
            return None
        out = [pts[0]]
        for p in pts[1:]:
            if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) >= tol:
                out.append(p)
        return [[round(x, 1), round(y, 1)] for x, y in out] if len(out) >= 3 else None
    areas = []
    for wa in water_areas:
        outer = ring(wa["outer"])
        if not outer:
            continue
        holes = [h for h in (ring(hr) for hr in wa.get("holes", [])) if h]
        a = {"kind": "water", "poly": outer}
        if holes:
            a["holes"] = holes
        areas.append(a)
    return areas


def classify_traffic_sign(raw, maxspeed=None):
    """Map an OSM `traffic_sign` value (Czech vyhláška 294/2015 codes / free text) to a render
    (kind, value) for the map, or None to drop (empties + codes already covered by junction-control
    derivation). Families: A=warning, B=prohibitory, C=mandatory, IP/IS/IZ=informational/zone (msg 3149).
    `maxspeed` = the node's own maxspeed tag (some signs are `traffic_sign=maxspeed` with the value over there)."""
    if not raw:
        return None
    first = str(raw).split(";")[0].strip()                 # a node may list several; the first governs
    low = first.lower()
    m = re.search(r"\[(\d{1,3})\]", first)                 # posted value embedded, e.g. B20a[30]
    speed = m.group(1) if m else None
    if not speed and maxspeed:                             # … else the separate maxspeed= tag (traffic_sign=maxspeed)
        mm = re.search(r"\d{1,3}", str(maxspeed))
        speed = mm.group(0) if mm else None
    code = first.split("[")[0].strip()
    cu = re.sub(r"^(cz|cs)[:\-_]?", "", code, flags=re.I)  # drop country prefix CZ:/CZ-/CS:/cz:
    cu = re.sub(r"[^A-Za-z0-9]", "", cu).upper()           # → letters+digits only: "IZ1a"→"IZ1A", "B20a"→"B20A"
    if low in ("yes", "yic", "none", "no", "unknown", ""):
        return None
    # speed limit (B20a / maxspeed)
    if "maxspeed" in low or cu.startswith(("B20", "B21")):
        return ("speed_limit", speed) if speed else None
    # already shown by junction-control derivation → don't double up
    if cu.startswith(("P1", "P2", "P3", "P4", "P6", "P7", "P8")) or low in ("give_way", "yield", "stop", "priority"):
        return None
    # town boundary / zone (city_limit = obec/konec obce IZ4) — informational; checked before B/C so
    # "CITYLIMIT".startswith("C") doesn't misfire into mandatory
    if "city_limit" in low or "town" in low or cu.startswith(("IZ", "IP", "IS", "IJ")):
        return ("info", None)
    # no-entry / prohibitory (B family)
    if cu in ("B1", "B2") or "no_entry" in low or low in ("no entry", "no-entry"):
        return ("no_entry", None)
    if cu.startswith("B") or low.startswith(("no ", "no_")) or "=no" in low:
        return ("prohibitory", speed)                      # other prohibitions (weight/overtaking/…) → generic red ring
    # mandatory (C family / only_* direction)
    if cu.startswith("C") or "only" in low:
        return ("mandatory", None)
    # warning (A family)
    if cu.startswith("A"):
        return ("warning", None)
    # anything else available → keep as informational (Vlad: "all signs incl. informational")
    return ("info", None)


def build_artifact(nodes, all_ways, bbox, country, name, out,
                   debug_only=False, snapshot=None, debug_png=True, place_nodes=None, water_areas=None,
                   label_nodes=None, poi_nodes=None, addr_nodes=None, sign_nodes=None, city="praha"):
    """Shared processing: raw OSM {nodes, all_ways} + bbox → tiled artifact (edges, areas,
    junctions, signs, tiles, meta). Front-ends: Overpass (district `bake`) and pbf (`bake_prague`).
    `water_areas` (optional) = pre-assembled multipolygon-aware water rings — used for all-Prague so
    rivers (Vltava: one outer ring + island holes) render, which closed natural=water ways miss."""
    profile = yaml.safe_load((ROOT / "countries" / f"{country}.yaml").read_text(encoding="utf-8"))
    classes = profile["road_classes"]
    to_xy, proj = make_proj(bbox)
    ways = [w for w in all_ways if w.get("tags", {}).get("highway") in classes]
    areas = build_areas(all_ways, nodes, to_xy, include_water=(water_areas is None))
    if water_areas:
        areas += _project_water(water_areas, to_xy)
    akinds = Counter(a["kind"] for a in areas)
    print(f"  [{name}] drivable ways: {len(ways)}  nodes: {len(nodes)}  "
          f"backdrop: {akinds.get('building',0)} buildings, {akinds.get('green',0)} green, {akinds.get('water',0)} water")

    # junction detection: nodes shared by >=2 drivable ways, plus way endpoints, plus tagged control
    node_ways = Counter()
    for wy in ways:
        for nid in set(wy["nodes"]):
            node_ways[nid] += 1
    control_nodes = {nid for nid, nd in nodes.items()
                     if nd.get("tags", {}).get("highway") in ("traffic_signals", "stop", "give_way")}
    crossing_nodes = {nid for nid, nd in nodes.items()
                      if nd.get("tags", {}).get("highway") == "crossing"}
    inter = {nid for nid, c in node_ways.items() if c >= 2} | control_nodes

    # split ways into edges at intersection nodes
    edges = []
    for wy in ways:
        t = wy.get("tags", {})
        cls = t["highway"]
        cdef = classes[cls]
        lanes = int(t["lanes"]) if str(t.get("lanes", "")).isdigit() else cdef["lanes"]
        ow_raw = str(t.get("oneway", "")).lower()
        oneway = ow_raw in ("yes", "true", "1", "-1") or cdef.get("oneway_implied", False)
        maxspeed = parse_maxspeed(t.get("maxspeed"), cdef["context"], profile)
        lv = road_level(t)                        # carriageway level for multi-level interchanges (msg 2980)
        # per-lane turn designations (msg 2997 ph2) — captured when OSM has them (sparse but real); used to
        # draw turn arrows on approach lanes. Forward = geom order; backward = opposite. "|"-separated spec.
        tl = t.get("turn:lanes:forward") or (t.get("turn:lanes") if oneway else None)
        tlb = t.get("turn:lanes:backward")
        lf = int(t["lanes:forward"]) if str(t.get("lanes:forward", "")).isdigit() else None
        lb = int(t["lanes:backward"]) if str(t.get("lanes:backward", "")).isdigit() else None
        # road number(s) (msg 3015) — `ref` (D5 / 20 / 1808…) + `int_ref` (E 49) for the on-map shields.
        # First value only (refs can be "20;E49"); stored when present (most minor streets have none).
        ref = (t.get("ref") or "").split(";")[0].strip() or None
        iref = (t.get("int_ref") or "").split(";")[0].strip() or None
        nlist = wy["nodes"]
        if ow_raw == "-1":
            nlist = list(reversed(nlist))   # oneway=-1: reverse so geom order = traffic-flow direction
        seg = [nlist[0]]
        for nid in nlist[1:]:
            seg.append(nid)
            if nid in inter or nid == nlist[-1]:
                if len(seg) >= 2:
                    pts = [to_xy(nodes[x]["lat"], nodes[x]["lon"]) for x in seg if x in nodes]
                    if len(pts) >= 2:
                        ed = {
                            "cls": cls, "name": t.get("name", ""), "oneway": oneway,
                            "lanes": lanes, "width": round(lanes * profile["lane_width_m"], 1),
                            "maxspeed": maxspeed,
                            "geom": [[round(x, 1), round(y, 1)] for x, y in pts],
                            "a": seg[0], "b": seg[-1],
                        }
                        if lv:
                            ed["lv"] = lv         # omit when 0 → keeps tiles small, old tiles default 0
                        if tl:
                            ed["tl"] = tl         # turn:lanes (forward/flow) — omitted when absent (sparse)
                        if tlb:
                            ed["tlb"] = tlb       # turn:lanes:backward
                        if lf:
                            ed["lf"] = lf         # lanes:forward (per-direction lane count, if tagged)
                        if lb:
                            ed["lb"] = lb         # lanes:backward
                        if ref:
                            ed["ref"] = ref       # road number for the on-map shield (msg 3015)
                        if iref:
                            ed["iref"] = iref     # international (E-route) number
                        edges.append(ed)
                seg = [nid]
    print(f"  edges (junction-to-junction): {len(edges)}")

    # junctions with derived control
    hierarchy = {c: i for i, c in enumerate(profile["priority"]["hierarchy"])}
    edge_by_node = defaultdict(list)
    for ei, ed in enumerate(edges):
        edge_by_node[ed["a"]].append(ei)
        edge_by_node[ed["b"]].append(ei)
    def tangent_into(ed, node):
        """Unit tangent of edge `ed` pointing INTO the edge, away from junction `node`."""
        g = ed["geom"]
        (ax, ay), (bx, by) = (g[0], g[1]) if ed["a"] == node else (g[-1], g[-2])
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1.0
        return dx / L, dy / L

    junctions, signs = [], []
    for nid in inter:
        inc = edge_by_node.get(nid, [])
        deg = len(inc)
        if deg < 2 and nid not in control_nodes:
            continue
        nd = nodes.get(nid)
        if not nd:
            continue
        ntags = nd.get("tags", {})
        ctrl = ("signals" if ntags.get("highway") == "traffic_signals"
                else "stop" if ntags.get("highway") == "stop"
                else "give_way" if ntags.get("highway") == "give_way"
                else "priority")   # derived (class/right) — resolved below
        nx, ny = to_xy(nd["lat"], nd["lon"])
        junctions.append({"x": round(nx, 1), "y": round(ny, 1), "ctrl": ctrl, "deg": deg})

        # Signs (vyhláška 294/2015): explicit OSM control, else DERIVE from road-class priority.
        # At a neravnoznačná (mixed-class) junction the minor approaches yield ("dej přednost" 🔻)
        # and the main road is "hlavní" 🟡; equal-rank junctions are přednost zprava → unsigned.
        def place(ei, kind):
            ed = edges[ei]
            tx, ty = tangent_into(ed, nid)
            sb, off = ed["width"] / 2 + 4.0, ed["width"] / 2 + 1.5   # out along approach, to the right
            px, py = nx + tx * sb + (-ty) * off, ny + ty * sb + tx * off
            signs.append({"x": round(px, 1), "y": round(py, 1), "kind": kind})

        # grade-separated / interchange node (msg 2980): motorway/trunk/ramp incident, mixed carriageway
        # levels, or a high-degree merge → DON'T derive give-way/priority here (real interchanges use
        # direction boards, not yield signs; this is what swarmed the Plzeň screenshot). Explicit OSM
        # signals/stop/give_way still place.
        inc_cls = [edges[ei]["cls"] for ei in inc]
        grade_sep = (deg >= 6 or len({edges[ei].get("lv", 0) for ei in inc}) > 1
                     or any(c in ("motorway", "trunk") or c.endswith("_link") for c in inc_cls))

        # Only PUBLIC roads carry give-way/priority signs — a main road meeting a driveway/parking aisle
        # (service) or a living-street zone is NOT signed in reality. Filtering these out removes the bulk
        # of the derived-sign swarm (service ≈ half of all edges) (msg 2980).
        signworthy = [ei for ei in inc if edges[ei]["cls"] not in ("service", "living_street")]
        ranks = [(ei, hierarchy.get(edges[ei]["cls"], 99)) for ei in signworthy]
        min_rank = min((r for _, r in ranks), default=99)
        mains = [ei for ei, r in ranks if r == min_rank]
        minors = [ei for ei, r in ranks if r > min_rank]
        if ctrl == "signals":
            # PER-APPROACH signal heads (msg 3151 working lights): one head per incoming road, placed at its
            # stop line, carrying its phase group (E-W axis=0 / N-S=1, matches signals.js grpOf) + the junction
            # centre so the client computes the live aspect. Opposite approaches share a group → go green
            # together; the cross axis is half a cycle out of phase. (Low-zoom dot still comes from junctions.)
            for ei in inc:
                ed = edges[ei]
                tx, ty = tangent_into(ed, nid)
                sb, off = ed["width"] / 2 + 4.0, ed["width"] / 2 + 1.5
                px, py = nx + tx * sb + (-ty) * off, ny + ty * sb + tx * off
                grp = 0 if abs(tx) >= abs(ty) else 1
                signs.append({"x": round(px, 1), "y": round(py, 1), "kind": "signal",
                              "grp": grp, "jx": round(nx, 1), "jy": round(ny, 1)})
        elif ctrl in ("stop", "give_way"):
            for ei in (minors or inc):
                place(ei, ctrl)
        elif minors and mains and not grade_sep:     # derived: mixed classes at a normal at-grade junction
            for ei in minors:
                place(ei, "give_way")
            for ei in mains:
                place(ei, "priority_road")

    # Posted OSM traffic_sign nodes (msg 3149): real roadside signs — speed limits, no-entry, prohibitions,
    # mandatory, informational/zone — that the derivation above never produces. Keep one only if it sits near a
    # drivable road (a coarse vertex grid gives candidate edges; signs >SNAP m from any carriageway = footway/
    # noise, dropped) and place it at its true location. Codes already shown as junction control are skipped.
    if sign_nodes:
        CELL, SNAP = 60.0, 30.0
        egrid = defaultdict(list)
        for ei, ed in enumerate(edges):
            for (gx, gy) in ed["geom"]:
                egrid[(int(gx // CELL), int(gy // CELL))].append(ei)

        def near_road(px, py):
            best = SNAP * SNAP + 1.0
            cx, cy = int(px // CELL), int(py // CELL)
            seen_e = set()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for ei in egrid.get((cx + dx, cy + dy), ()):
                        if ei in seen_e:
                            continue
                        seen_e.add(ei)
                        g = edges[ei]["geom"]
                        for k in range(len(g) - 1):
                            ax, ay, bx, by = g[k][0], g[k][1], g[k + 1][0], g[k + 1][1]
                            vx, vy = bx - ax, by - ay
                            L2 = vx * vx + vy * vy or 1.0
                            t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
                            ddx, ddy = px - (ax + t * vx), py - (ay + t * vy)
                            best = min(best, ddx * ddx + ddy * ddy)
            return best <= SNAP * SNAP

        kept = 0
        for sn in sign_nodes:
            cl = classify_traffic_sign(sn.get("v"), sn.get("ms"))
            if not cl:
                continue
            kind, val = cl
            px, py = to_xy(sn["lat"], sn["lon"])
            if not near_road(px, py):
                continue
            sg = {"x": round(px, 1), "y": round(py, 1), "kind": kind}
            if val:
                sg["v"] = val
            signs.append(sg)
            kept += 1
        print(f"  posted OSM signs: {kept} kept of {len(sign_nodes)} (snapped to roads)")

    # collapse co-located signs of the same kind (interchange clusters / dense nodes) to one per ~12 m
    # cell so complex junctions don't swarm with duplicates (msg 2980). Value (speed) is part of the key so
    # two different posted limits near each other don't collapse into one.
    if signs:
        seen_sg, deduped = set(), []
        for sg in signs:
            key = (sg["kind"], sg.get("v"), sg.get("grp"), round(sg["x"] / 12.0), round(sg["y"] / 12.0))
            if key in seen_sg:
                continue
            seen_sg.add(key)
            deduped.append(sg)
        signs = deduped

    # pedestrian crossings (zebra): a crossing node lying on a drivable way → a zebra band laid
    # across that road. Tangent comes from the way neighbours so stripes sit square across the
    # carriageway; width from the road class so the band spans kerb-to-kerb. One band per node.
    crossings, seen_cross = [], set()
    for wy in ways:
        nl = wy["nodes"]
        if len(nl) < 2:
            continue
        cdef = classes[wy["tags"]["highway"]]
        lanes = int(wy["tags"]["lanes"]) if str(wy["tags"].get("lanes", "")).isdigit() else cdef["lanes"]
        width = round(lanes * profile["lane_width_m"], 1)
        for i, nid in enumerate(nl):
            if nid not in crossing_nodes or nid in seen_cross or nid not in nodes:
                continue
            a, b = nl[max(0, i - 1)], nl[min(len(nl) - 1, i + 1)]
            if a == b or a not in nodes or b not in nodes:
                continue
            ax, ay = to_xy(nodes[a]["lat"], nodes[a]["lon"])
            bx, by = to_xy(nodes[b]["lat"], nodes[b]["lon"])
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy) or 1.0
            cx, cy = to_xy(nodes[nid]["lat"], nodes[nid]["lon"])
            seen_cross.add(nid)
            crossings.append({"x": round(cx, 1), "y": round(cy, 1),
                              "tx": round(dx / L, 3), "ty": round(dy / L, 3), "w": width})
    print(f"  pedestrian crossings: {len(crossings)}")

    # railway tracks (msg 2771): surface rail/tram lines as simplified polylines (own corridor or
    # in-street); subway/tunnel skipped in railway_kind. Rendered with a track symbol.
    rails = []
    for wy in all_ways:
        rk = railway_kind(wy.get("tags", {}))
        if not rk:
            continue
        pts = [to_xy(nodes[x]["lat"], nodes[x]["lon"]) for x in wy["nodes"] if x in nodes]
        if len(pts) < 2:
            continue
        simp = [pts[0]]
        for p in pts[1:]:
            if math.hypot(p[0] - simp[-1][0], p[1] - simp[-1][1]) >= 3.0:
                simp.append(p)
        if len(simp) < 2:
            continue
        rails.append({"kind": rk, "geom": [[round(x, 1), round(y, 1)] for x, y in simp]})
    print(f"  railway lines: {len(rails)}")

    # named labels (stations + major landmarks, msg 2771) — pre-collected by the front-end as
    # {lat,lon,kind,name}; project to metres.
    labels = []
    for ln in (label_nodes or []):
        x, y = to_xy(ln["lat"], ln["lon"])
        labels.append({"x": round(x, 1), "y": round(y, 1), "kind": ln["kind"], "name": ln["name"]})
    lk = Counter(l["kind"] for l in labels)
    print(f"  labels (stations/landmarks): {len(labels)} {dict(lk)}")

    # everyday POIs + house numbers (msg 2771 phase 2) — pre-collected {lat,lon,...}; project to
    # metres. Rendered only when zoomed in close, so the street you're on shows its full detail.
    pois = []
    for pn in (poi_nodes or []):
        x, y = to_xy(pn["lat"], pn["lon"])
        p = {"x": round(x, 1), "y": round(y, 1), "kind": pn["kind"]}
        if pn.get("name"):
            p["name"] = pn["name"]
        pois.append(p)
    addrs = []
    for an in (addr_nodes or []):
        x, y = to_xy(an["lat"], an["lon"])
        addrs.append({"x": round(x, 1), "y": round(y, 1), "n": an["n"]})
    pk = Counter(p["kind"] for p in pois)
    print(f"  POIs: {len(pois)} {dict(pk)};  house numbers: {len(addrs)}")

    # bounds (metres)
    xs = [p[0] for ed in edges for p in ed["geom"]]
    ys = [p[1] for ed in edges for p in ed["geom"]]
    bounds = {"minx": min(xs), "maxx": max(xs), "miny": min(ys), "maxy": max(ys)} if xs else None

    # speed-limit coverage stat
    explicit = sum(1 for w in ways if w.get("tags", {}).get("maxspeed"))
    print(f"  maxspeed explicit on {explicit}/{len(ways)} ways (rest via cz defaults)")

    out.mkdir(parents=True, exist_ok=True)
    if debug_png:
        _debug_png(edges, areas, bounds, out / "debug.png")
    if debug_only:
        print(f"  [{name}] debug-only → {out/'debug.png'}")
        return

    # tile by grid
    tiles = defaultdict(lambda: {"edges": [], "junctions": [], "areas": [], "signs": [],
                                 "crossings": [], "rails": [], "labels": [], "pois": [], "addrs": []})
    for ed in edges:
        keys = {(int(p[0] // TILE_M), int(p[1] // TILE_M)) for p in ed["geom"]}
        for k in keys:
            tiles[f"{k[0]}_{k[1]}"]["edges"].append(ed)
    for rl in rails:
        keys = {(int(p[0] // TILE_M), int(p[1] // TILE_M)) for p in rl["geom"]}
        for k in keys:
            tiles[f"{k[0]}_{k[1]}"]["rails"].append(rl)
    for lb in labels:
        k = f"{int(lb['x']//TILE_M)}_{int(lb['y']//TILE_M)}"
        tiles[k]["labels"].append(lb)
    for po in pois:
        k = f"{int(po['x']//TILE_M)}_{int(po['y']//TILE_M)}"
        tiles[k]["pois"].append(po)
    for ad in addrs:
        k = f"{int(ad['x']//TILE_M)}_{int(ad['y']//TILE_M)}"
        tiles[k]["addrs"].append(ad)
    for jc in junctions:
        k = f"{int(jc['x']//TILE_M)}_{int(jc['y']//TILE_M)}"
        tiles[k]["junctions"].append(jc)
    for sg in signs:
        k = f"{int(sg['x']//TILE_M)}_{int(sg['y']//TILE_M)}"
        tiles[k]["signs"].append(sg)
    for cr in crossings:
        k = f"{int(cr['x']//TILE_M)}_{int(cr['y']//TILE_M)}"
        tiles[k]["crossings"].append(cr)
    for ar in areas:
        keys = {(int(p[0] // TILE_M), int(p[1] // TILE_M)) for p in ar["poly"]}
        for k in keys:
            tiles[f"{k[0]}_{k[1]}"]["areas"].append(ar)

    tdir = out / "tiles"
    tdir.mkdir(exist_ok=True)
    for k, payload in tiles.items():
        (tdir / f"{k}.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    meta = {
        "country": country, "city": city, "district": name,
        "bbox": bbox, "proj": proj, "tile_m": TILE_M, "bounds": bounds,
        "tiles": sorted(tiles.keys()), "n_edges": len(edges), "n_junctions": len(junctions),
        "n_areas": len(areas), "n_signs": len(signs), "n_crossings": len(crossings),
        "n_rails": len(rails), "n_labels": len(labels), "n_pois": len(pois), "n_addrs": len(addrs),
        "version": 2, "profile": country,
        "snapshot": snapshot,   # OSM data date (pbf timestamp) — shown in-app
        "attribution": "© OpenStreetMap contributors (ODbL)",
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    # search index (separate file — tiles stream, so street names aren't all in memory): one
    # representative point per unique street name (the longest edge wins) + district/quarter places.
    streets = {}
    for ed in edges:
        nm = ed.get("name")
        if not nm:
            continue
        g = ed["geom"]
        L = sum(math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]) for i in range(1, len(g)))
        if nm not in streets or L > streets[nm][0]:
            mid = g[len(g) // 2]
            streets[nm] = (L, mid[0], mid[1])
    street_list = [{"name": nm, "x": round(x, 1), "y": round(y, 1)} for nm, (_, x, y) in sorted(streets.items())]
    places = []
    for p in (place_nodes or []):
        x, y = to_xy(p["lat"], p["lon"])
        places.append({"name": p["name"], "x": round(x, 1), "y": round(y, 1), "kind": p["kind"]})
    places.sort(key=lambda p: p["name"])
    (out / "search.json").write_text(
        json.dumps({"streets": street_list, "places": places}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    print(f"  [{name}] search index: {len(street_list)} streets, {len(places)} places")

    # city-wide OVERVIEW for the minimap "City" mode (Vlad msg 2959): the whole-city landscape that
    # the streaming tiles can't show at once — the river/major water, the main road network, and big
    # parks. Heavily decimated (the minimap is ~276 px) so it stays small and loads once.
    def _decim(poly, min_d):
        """Keep endpoints + any vertex ≥ min_d m from the last kept one (cheap polyline simplify)."""
        if len(poly) <= 2:
            return [[round(p[0], 1), round(p[1], 1)] for p in poly]
        out = [poly[0]]
        lx, ly = poly[0]
        for p in poly[1:-1]:
            if (p[0] - lx) ** 2 + (p[1] - ly) ** 2 >= min_d * min_d:
                out.append(p); lx, ly = p[0], p[1]
        out.append(poly[-1])
        return [[round(x, 1), round(y, 1)] for x, y in out]

    def _span(poly):
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        return max(max(xs) - min(xs), max(ys) - min(ys))

    # main road network only — motorway/trunk/primary (the arterials you see on a zoomed-out city map);
    # secondary+ would just clutter a 276 px minimap.
    MAJOR = {"motorway": 0, "motorway_link": 0, "trunk": 1, "trunk_link": 1, "primary": 2, "primary_link": 2}
    ov_roads = [{"r": MAJOR[ed["cls"]], "g": _decim(ed["geom"], 45)}
                for ed in edges if ed["cls"] in MAJOR and len(ed["geom"]) >= 2]
    ov_water = []
    for ar in areas:
        if ar["kind"] != "water" or len(ar["poly"]) < 4 or _span(ar["poly"]) < 50:
            continue                                       # skip puddles; keep the river + real ponds
        w = {"poly": _decim(ar["poly"], 22)}
        if ar.get("holes"):
            hs = [_decim(h, 22) for h in ar["holes"] if len(h) >= 4]
            if hs:
                w["holes"] = hs
        ov_water.append(w)
    ov_green = [{"poly": _decim(ar["poly"], 45)} for ar in areas      # only sizeable parks/forests
                if ar["kind"] == "green" and len(ar["poly"]) >= 4 and _span(ar["poly"]) >= 280]
    (out / "overview.json").write_text(
        json.dumps({"water": ov_water, "roads": ov_roads, "green": ov_green}, separators=(",", ":")),
        encoding="utf-8")
    print(f"  [{name}] overview: {len(ov_water)} water, {len(ov_roads)} roads, {len(ov_green)} green")

    # routing graph (for server-side shortest-path): one row per edge [a, b, oneway, geom].
    # Directedness (one-ways) is applied at route time; geom lets the route follow real roads.
    graph = [[ed["a"], ed["b"], 1 if ed["oneway"] else 0, ed["geom"]] for ed in edges]
    (out / "graph.json").write_text(json.dumps(graph, separators=(",", ":")), encoding="utf-8")
    sk = Counter(s["kind"] for s in signs)
    print(f"[{name}] baked → {out}  ({len(tiles)} tiles, {len(edges)} edges, "
          f"{len(junctions)} junctions, {len(areas)} areas, {len(signs)} signs {dict(sk)}, "
          f"{len(crossings)} crossings)")


AREA_FILL = {"building": (40, 46, 58), "green": (32, 52, 40), "water": (30, 48, 70)}  # debug PNG


def _debug_png(edges, areas, bounds, path, scale=0.5):
    if not bounds:
        print("  no geometry to draw"); return
    W = int((bounds["maxx"] - bounds["minx"]) * scale) + 40
    H = int((bounds["maxy"] - bounds["miny"]) * scale) + 40
    img = Image.new("RGB", (W, H), (15, 18, 24))
    d = ImageDraw.Draw(img)
    def px(p):
        return (20 + (p[0] - bounds["minx"]) * scale, H - 20 - (p[1] - bounds["miny"]) * scale)  # flip y
    for ar in areas:  # backdrop behind roads
        d.polygon([px(p) for p in ar["poly"]], fill=AREA_FILL.get(ar["kind"], (40, 46, 58)))
    for ed in edges:
        col = CLASS_COLOR.get(ed["cls"], (120, 130, 145))
        wpx = max(1, int(ed["width"] * scale))
        pts = [px(p) for p in ed["geom"]]
        d.line(pts, fill=col, width=wpx, joint="curve")
    img.save(path)
    print(f"  debug PNG {W}x{H} → {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("district", choices=sorted(DISTRICTS))
    ap.add_argument("--country", default="cz")
    ap.add_argument("--debug-only", action="store_true")
    a = ap.parse_args()
    bake(a.district, a.country, a.debug_only)


if __name__ == "__main__":
    main()
