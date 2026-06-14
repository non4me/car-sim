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
from bake_city import ROOT, build_artifact  # shared processing pipeline

# Prague bbox (S, W, N, E) — same convention as DISTRICTS in bake_city.py
PRAGUE_BBOX = (49.941, 14.224, 50.177, 14.707)

DRIVABLE = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
            "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
            "residential", "living_street", "service"}
CONTROL = ("traffic_signals", "stop", "give_way")


def _want_way(tags) -> bool:
    if tags.get("highway") in DRIVABLE:
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


def read_pbf(path: str):
    """pbf → (nodes, all_ways) matching the Overpass element shapes build_artifact expects."""
    nodes: dict = {}      # id -> {"lat","lon","tags"}
    all_ways: list = []   # {"id","nodes":[ids],"tags":{}}
    # with_locations() caches every node's coord in C++; EmptyTagFilter means Python only sees
    # TAGGED objects (all our ways + the control nodes) — untagged nodes are still cached for geometry.
    fp = osmium.FileProcessor(path).with_locations().with_filter(osmium.filter.EmptyTagFilter())
    n_ways = 0
    for o in fp:
        if o.is_node():
            hw = o.tags.get("highway")
            if hw in CONTROL and o.location.valid():
                nodes[o.id] = {"lat": o.location.lat, "lon": o.location.lon, "tags": {"highway": hw}}
        elif o.is_way():
            tags = {t.k: t.v for t in o.tags}
            if not _want_way(tags):
                continue
            nids = []
            for nr in o.nodes:
                if not nr.location.valid():
                    continue
                nid = nr.ref
                nids.append(nid)
                if nid not in nodes:
                    nodes[nid] = {"lat": nr.location.lat, "lon": nr.location.lon, "tags": {}}
            if len(nids) >= 2:
                all_ways.append({"id": o.id, "nodes": nids, "tags": tags})
                n_ways += 1
                if n_ways % 50000 == 0:
                    print(f"  …{n_ways} ways, {len(nodes)} nodes")
    return nodes, all_ways


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
    nodes, all_ways = read_pbf(args.pbf)
    print(f"[{args.name}] parsed {len(all_ways)} ways, {len(nodes)} nodes → processing…")
    out = ROOT / "data" / "cities" / args.country / "praha" / args.name
    build_artifact(nodes, all_ways, PRAGUE_BBOX, args.country, args.name, out,
                   snapshot=snapshot, debug_png=False)


if __name__ == "__main__":
    main()
