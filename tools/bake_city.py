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


def build_areas(osm_ways, nodes, to_xy) -> list[dict]:
    """Closed backdrop ways → projected polygons {kind, poly}, lightly simplified."""
    areas = []
    for wy in osm_ways:
        kind = classify_area(wy.get("tags", {}))
        if not kind:
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


def build_artifact(nodes, all_ways, bbox, country, name, out,
                   debug_only=False, snapshot=None, debug_png=True, place_nodes=None):
    """Shared processing: raw OSM {nodes, all_ways} + bbox → tiled artifact (edges, areas,
    junctions, signs, tiles, meta). Front-ends: Overpass (district `bake`) and pbf (`bake_prague`)."""
    profile = yaml.safe_load((ROOT / "countries" / f"{country}.yaml").read_text(encoding="utf-8"))
    classes = profile["road_classes"]
    to_xy, proj = make_proj(bbox)
    ways = [w for w in all_ways if w.get("tags", {}).get("highway") in classes]
    areas = build_areas(all_ways, nodes, to_xy)
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
                        edges.append({
                            "cls": cls, "name": t.get("name", ""), "oneway": oneway,
                            "lanes": lanes, "width": round(lanes * profile["lane_width_m"], 1),
                            "maxspeed": maxspeed,
                            "geom": [[round(x, 1), round(y, 1)] for x, y in pts],
                            "a": seg[0], "b": seg[-1],
                        })
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

        ranks = [(ei, hierarchy.get(edges[ei]["cls"], 99)) for ei in inc]
        min_rank = min((r for _, r in ranks), default=99)
        mains = [ei for ei, r in ranks if r == min_rank]
        minors = [ei for ei, r in ranks if r > min_rank]
        if ctrl == "signals":
            signs.append({"x": round(nx, 1), "y": round(ny, 1), "kind": "signal"})
        elif ctrl in ("stop", "give_way"):
            for ei in (minors or inc):
                place(ei, ctrl)
        elif minors and mains:                       # derived: mixed classes
            for ei in minors:
                place(ei, "give_way")
            for ei in mains:
                place(ei, "priority_road")

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
    tiles = defaultdict(lambda: {"edges": [], "junctions": [], "areas": [], "signs": [], "crossings": []})
    for ed in edges:
        keys = {(int(p[0] // TILE_M), int(p[1] // TILE_M)) for p in ed["geom"]}
        for k in keys:
            tiles[f"{k[0]}_{k[1]}"]["edges"].append(ed)
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
        "country": country, "city": "praha", "district": name,
        "bbox": bbox, "proj": proj, "tile_m": TILE_M, "bounds": bounds,
        "tiles": sorted(tiles.keys()), "n_edges": len(edges), "n_junctions": len(junctions),
        "n_areas": len(areas), "n_signs": len(signs), "n_crossings": len(crossings),
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
