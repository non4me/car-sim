#!/usr/bin/env python3
"""Add an `admin` array (official numbered city districts) to a district's search.json.

Vlad (msg 2964): the City-mode minimap should show ONLY globally-significant labels. For Prague that means
the numbered city districts "Praha 1"…"Praha 16" (admin_level-9 boundaries), NOT the 300+ quarter/suburb
place names. Those districts are boundary *relations*, not place nodes, so they never land in the baked
search.json. This harvests their area-weighted centroids (projected with the district's own meta.json
projection) and writes search.json["admin"] = [{name, x, y, n}] (n = trailing number, or null). No re-bake
— same post-bake-patch pattern as add_landmarks_to_search.py.

Usage:
  python tools/add_admin_districts.py data/osm/praha.osm.pbf data/cities/cz/praha/prague --match '^Praha \\d+$'
"""
import argparse
import json
import re
from pathlib import Path

import osmium


def ring_centroid(ring):
    """Area-weighted (shoelace) centroid of a lon/lat ring; falls back to vertex mean for degenerate rings."""
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-12:
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    a *= 0.5
    return cx / (6 * a), cy / (6 * a)


def harvest(pbf: str, level: int, rx: re.Pattern) -> dict:
    """name -> (lon, lat) for boundary=administrative areas at `level` whose name matches `rx`.
    For multi-part districts the largest outer ring wins (one label per district)."""
    found = {}      # name -> (lon, lat, area_of_chosen_ring)
    fp = osmium.FileProcessor(pbf).with_areas(osmium.filter.KeyFilter("boundary"))
    for o in fp:
        if not o.is_area():
            continue
        t = o.tags
        if t.get("boundary") != "administrative":
            continue
        if level and t.get("admin_level") != str(level):
            continue
        name = t.get("name", "")
        if not rx.match(name):
            continue
        for ring in o.outer_rings():
            pts = [(nd.lon, nd.lat) for nd in ring]
            if len(pts) < 4:
                continue
            # crude ring area to pick the dominant polygon when a district is split into parts
            area = abs(sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1)))
            if name in found and area <= found[name][2]:
                continue
            lon, lat = ring_centroid(pts)
            found[name] = (lon, lat, area)
    return {k: (v[0], v[1]) for k, v in found.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pbf")
    ap.add_argument("dist_dir")
    ap.add_argument("--level", type=int, default=9, help="admin_level of the city districts (Prague obvody = 9)")
    ap.add_argument("--match", default=r"^.+ \d+$", help="regex the district name must match")
    args = ap.parse_args()

    d = Path(args.dist_dir)
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    proj = meta["proj"]
    lat0, lon0, kx, ky = proj["lat0"], proj["lon0"], proj["kx"], proj["ky"]

    rx = re.compile(args.match)
    found = harvest(args.pbf, args.level, rx)

    admin = []
    for name, (lon, lat) in found.items():
        m = re.search(r"(\d+)\s*$", name)
        admin.append({
            "name": name,
            "x": round((lon - lon0) * kx, 1),
            "y": round((lat - lat0) * ky, 1),
            "n": int(m.group(1)) if m else None,
        })
    admin.sort(key=lambda a: (a["n"] is None, a["n"] or 0, a["name"]))

    sj_path = d / "search.json"
    sj = json.loads(sj_path.read_text(encoding="utf-8"))
    sj["admin"] = admin
    sj_path.write_text(json.dumps(sj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(admin)} admin districts → {sj_path}: {[a['name'] for a in admin]}")


if __name__ == "__main__":
    main()
