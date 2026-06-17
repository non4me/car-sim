#!/usr/bin/env python3
"""Bake ALL of Prague from a Geofabrik .pbf into the tiled map artifact, reusing the shared
build_artifact() pipeline from bake_city.py. The pbf is the front-end (instead of Overpass), so
the same edge/area/junction/sign processing + tiling runs over the whole city.

Pipeline:
  1) osmium extract -s complete_ways the Prague bbox from the Czech .pbf  (done in the shell)
  2) read the Prague .pbf with pyosmium → {nodes, all_ways} in the Overpass shape
  3) build_artifact(...) → data/cities/cz/praha/prague/{meta.json, tiles/*.json}

Usage:
  python tools/bake_prague.py <prague.osm.pbf> [--name prague] [--snapshot YYYY-MM-DD]
"""
import argparse
import sys
from pathlib import Path

import osmium

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_city import ROOT, build_artifact, railway_kind, landmark_kind, poi_kind, RAILWAY_KINDS  # shared

# Prague bbox (S, W, N, E) — same convention as DISTRICTS in bake_city.py
PRAGUE_BBOX = (49.941, 14.224, 50.177, 14.707)

DRIVABLE = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
            "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
            "residential", "living_street", "service"}
CONTROL = ("traffic_signals", "stop", "give_way")
PLACE_KINDS = ("city", "borough", "suburb", "quarter", "neighbourhood", "town", "village")


def label_for(tags) -> tuple | None:
    """Named station OR major landmark → (kind, name), else None (msg 2771)."""
    if tags.get("railway") in ("station", "halt") and tags.get("name"):
        return ("station", tags["name"])
    lk = landmark_kind(tags)
    return (lk, tags["name"]) if lk else None


def _want_way(tags) -> bool:
    if tags.get("highway") in DRIVABLE:
        return True
    if tags.get("railway") in RAILWAY_KINDS:
        return True
    if "building" in tags:
        return True
    if tags.get("natural") == "water":
        return True
    if tags.get("leisure") in ("park", "garden", "playground", "pitch", "recreation_ground", "dog_park"):
        return True
    if tags.get("landuse") in ("grass", "forest", "meadow", "village_green", "cemetery", "recreation_ground"):
        return True
    return False


def read_pbf(path: str, bbox=PRAGUE_BBOX):
    """pbf → (nodes, all_ways, places, labels, pois, addrs) in the Overpass element shapes build_artifact expects."""
    nodes: dict = {}      # id -> {"lat","lon","tags"}
    all_ways: list = []   # {"id","nodes":[ids],"tags":{}}
    places: list = []     # {"name","lat","lon","kind"} — districts/quarters for search
    labels: list = []     # {"lat","lon","kind","name"} — stations + major landmarks (msg 2771)
    pois: list = []       # {"lat","lon","kind","name"?} — pharmacies/ATMs/food/shops… (phase 2)
    addrs: list = []      # {"lat","lon","n"} — house numbers (phase 2)
    s, w, n, e = bbox
    inbb = lambda la, lo: s <= la <= n and w <= lo <= e
    # with_locations() caches every node's coord in C++; EmptyTagFilter means Python only sees
    # TAGGED objects (all our ways + the control nodes) — untagged nodes are still cached for geometry.
    fp = osmium.FileProcessor(path).with_locations().with_filter(osmium.filter.EmptyTagFilter())
    n_ways = 0
    for o in fp:
        if o.is_node():
            if not o.location.valid():
                continue
            hw = o.tags.get("highway")
            if hw in CONTROL or hw == "crossing":
                # store control + crossing nodes BEFORE the way pass so their tag survives (the way
                # pass only adds untagged nodes it hasn't seen) — build_artifact reads highway= off it.
                nodes[o.id] = {"lat": o.location.lat, "lon": o.location.lon, "tags": {"highway": hw}}
            place, nm = o.tags.get("place"), o.tags.get("name")
            if place in PLACE_KINDS and nm and s <= o.location.lat <= n and w <= o.location.lon <= e:
                places.append({"name": nm, "lat": o.location.lat, "lon": o.location.lon, "kind": place})
            la, lo = o.location.lat, o.location.lon
            ntags = {t.k: t.v for t in o.tags}
            lab = label_for(ntags)                        # station / landmark POINT node
            if lab and inbb(la, lo):
                labels.append({"lat": la, "lon": lo, "kind": lab[0], "name": lab[1]})
            pk = poi_kind(ntags)                          # everyday POI node (phase 2)
            if pk and inbb(la, lo):
                d = {"lat": la, "lon": lo, "kind": pk}
                if ntags.get("name"):
                    d["name"] = ntags["name"]
                pois.append(d)
            hn = ntags.get("addr:housenumber")            # house number node (phase 2)
            if hn and inbb(la, lo):
                addrs.append({"lat": la, "lon": lo, "n": hn})
        elif o.is_way():
            tags = {t.k: t.v for t in o.tags}
            lab = label_for(tags)                         # station/landmark/POI as a building/way → centroid
            pk = poi_kind(tags)
            hn = tags.get("addr:housenumber")
            want = _want_way(tags)
            if not (want or lab or pk or hn):
                continue
            nids, clat, clon = [], 0.0, 0.0
            for nr in o.nodes:
                if not nr.location.valid():
                    continue
                nid = nr.ref
                nids.append(nid)
                clat += nr.location.lat; clon += nr.location.lon
                if nid not in nodes:
                    nodes[nid] = {"lat": nr.location.lat, "lon": nr.location.lon, "tags": {}}
            if not nids:
                continue
            cy, cx = clat / len(nids), clon / len(nids)   # way centroid for point features
            here = inbb(cy, cx)
            if lab and here:
                labels.append({"lat": cy, "lon": cx, "kind": lab[0], "name": lab[1]})
            if pk and here:
                d = {"lat": cy, "lon": cx, "kind": pk}
                if tags.get("name"):
                    d["name"] = tags["name"]
                pois.append(d)
            if hn and here:
                addrs.append({"lat": cy, "lon": cx, "n": hn})
            if len(nids) >= 2 and want:
                all_ways.append({"id": o.id, "nodes": nids, "tags": tags})
                n_ways += 1
                if n_ways % 50000 == 0:
                    print(f"  …{n_ways} ways, {len(nodes)} nodes")
    return nodes, all_ways, places, labels, pois, addrs


def read_water_areas(path: str, bbox=PRAGUE_BBOX) -> list:
    """Assemble water bodies as lat/lon rings, INCLUDING multipolygon relations (big rivers like the
    Vltava are a relation: one outer riverbank ring + many island holes). pyosmium's area builder
    stitches closed ways AND multipolygons; we keep the outer ring + inner rings (holes). Restricted
    to natural/water/waterway-keyed input so the 246k building areas aren't assembled."""
    s, w, n, e = bbox
    out = []
    fp = osmium.FileProcessor(path).with_areas(osmium.filter.KeyFilter("natural", "water", "waterway"))
    for o in fp:
        if not o.is_area():
            continue
        t = o.tags
        if not (t.get("natural") == "water" or "water" in t or t.get("waterway") == "riverbank"):
            continue
        for ring in o.outer_rings():
            outer = [(nd.lat, nd.lon) for nd in ring]
            if len(outer) < 4:
                continue
            cy = sum(p[0] for p in outer) / len(outer)
            cx = sum(p[1] for p in outer) / len(outer)
            if not (s - 0.02 <= cy <= n + 0.02 and w - 0.02 <= cx <= e + 0.02):
                continue                                   # ring centroid outside Prague bbox
            holes = [[(nd.lat, nd.lon) for nd in ir] for ir in o.inner_rings(ring)]
            out.append({"outer": outer, "holes": holes})
    return out


def dedup_points(items, keyfn):
    """Drop co-located duplicates (a feature mapped as both a node and a building) by a rounded key."""
    seen, uniq = set(), []
    for it in items:
        k = keyfn(it)
        if k in seen:
            continue
        seen.add(k); uniq.append(it)
    return uniq


def _snapshot_from_header(path: str):
    try:
        ts = osmium.FileProcessor(path).header.get("osmosis_replication_timestamp")
        return (ts or "")[:10] or None     # YYYY-MM-DD
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pbf", help="Prague-extracted .osm.pbf")
    ap.add_argument("--name", default="prague")
    ap.add_argument("--country", default="cz")
    ap.add_argument("--snapshot", default=None, help="OSM snapshot date YYYY-MM-DD (else read from pbf header)")
    args = ap.parse_args()

    snapshot = args.snapshot or _snapshot_from_header(args.pbf)
    print(f"[{args.name}] reading {args.pbf} (snapshot {snapshot})…")
    nodes, all_ways, places, labels, pois, addrs = read_pbf(args.pbf)
    # dedup labels/POIs co-located under the same name (mapped as both a node and a building)
    labels = dedup_points(labels, lambda l: (l["kind"], l["name"], round(l["lat"], 3), round(l["lon"], 3)))
    pois = dedup_points(pois, lambda p: (p["kind"], p.get("name", ""), round(p["lat"], 4), round(p["lon"], 4)))
    print(f"[{args.name}] parsed {len(all_ways)} ways, {len(nodes)} nodes, {len(places)} places, "
          f"{len(labels)} labels, {len(pois)} pois, {len(addrs)} house-numbers → processing…")
    water = read_water_areas(args.pbf)
    print(f"[{args.name}] assembled {len(water)} water areas (incl. multipolygon rivers)")
    out = ROOT / "data" / "cities" / args.country / "praha" / args.name
    build_artifact(nodes, all_ways, PRAGUE_BBOX, args.country, args.name, out,
                   snapshot=snapshot, debug_png=False, place_nodes=places, water_areas=water,
                   label_nodes=labels, poi_nodes=pois, addr_nodes=addrs)


if __name__ == "__main__":
    main()
