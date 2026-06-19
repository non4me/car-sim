#!/usr/bin/env python3
"""Bake ANY city from a Geofabrik .pbf into the tiled map artifact — the generic sibling of
bake_prague.py. Same pipeline (pbf → build_artifact → tiles), but city/name/bbox are CLI args, so a
2nd/3rd city is a one-liner instead of a new script (Vlad msg 2931, multi-city).

Pipeline:
  1) osmium extract -b W,S,E,N -s complete_ways <country>.osm.pbf -o <city>.osm.pbf  (shell, offline)
  2) this script: read the city .pbf with pyosmium → build_artifact over the bbox
  3) → data/cities/<country>/<city>/<name>/{meta.json, tiles/*.json}

Usage:
  python tools/bake_city_pbf.py <city.osm.pbf> --city brno --name brno \\
      --bbox 49.108,16.428,49.295,16.728 [--country cz] [--snapshot YYYY-MM-DD]

`--name` is the baked district folder = the whole-city slug (one bake per city). The country rules
profile is countries/<country>.yaml (CZ rules apply nationwide, so every CZ city reuses cz.yaml).
"""
import argparse
import sys
from pathlib import Path

# reuse the proven pbf reader + water assembler + snapshot reader + the shared artifact builder
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_prague import read_pbf, read_water_areas, _snapshot_from_header, dedup_points  # noqa: E402
from bake_city import ROOT, build_artifact  # noqa: E402


def parse_bbox(s: str):
    """'S,W,N,E' → (s, w, n, e) floats, with a sanity check (S<N, W<E)."""
    parts = [float(x) for x in s.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox must be S,W,N,E (4 comma-separated numbers)")
    so, we, no, ea = parts
    if not (so < no and we < ea):
        raise argparse.ArgumentTypeError(f"bbox looks wrong (need S<N and W<E): {parts}")
    return (so, we, no, ea)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pbf", help="city-extracted .osm.pbf (osmium extract of the country pbf to the bbox)")
    ap.add_argument("--city", required=True, help="city slug (folder): e.g. brno, ostrava, plzen")
    ap.add_argument("--name", default=None, help="baked-district folder (default = --city, the whole city)")
    ap.add_argument("--bbox", required=True, type=parse_bbox, help="S,W,N,E (same convention as bake_prague)")
    ap.add_argument("--country", default="cz")
    ap.add_argument("--snapshot", default=None, help="OSM snapshot date YYYY-MM-DD (else read from pbf header)")
    args = ap.parse_args()

    name = args.name or args.city
    bbox = args.bbox
    snapshot = args.snapshot or _snapshot_from_header(args.pbf)
    print(f"[{args.city}/{name}] reading {args.pbf} (bbox {bbox}, snapshot {snapshot})…")

    nodes, all_ways, places, labels, pois, addrs, sign_nodes = read_pbf(args.pbf, bbox)
    labels = dedup_points(labels, lambda l: (l["kind"], l["name"], round(l["lat"], 3), round(l["lon"], 3)))
    pois = dedup_points(pois, lambda p: (p["kind"], p.get("name", ""), round(p["lat"], 4), round(p["lon"], 4)))
    print(f"[{args.city}/{name}] parsed {len(all_ways)} ways, {len(nodes)} nodes, {len(places)} places, "
          f"{len(labels)} labels, {len(pois)} pois, {len(addrs)} house-numbers, {len(sign_nodes)} signs → processing…")

    water = read_water_areas(args.pbf, bbox)
    print(f"[{args.city}/{name}] assembled {len(water)} water areas (incl. multipolygon rivers)")

    out = ROOT / "data" / "cities" / args.country / args.city / name
    out.mkdir(parents=True, exist_ok=True)
    build_artifact(nodes, all_ways, bbox, args.country, name, out,
                   snapshot=snapshot, debug_png=False, place_nodes=places, water_areas=water,
                   label_nodes=labels, poi_nodes=pois, addr_nodes=addrs, sign_nodes=sign_nodes, city=args.city)
    print(f"[{args.city}/{name}] done → {out}")


if __name__ == "__main__":
    main()
