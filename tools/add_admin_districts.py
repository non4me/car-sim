#!/usr/bin/env python3
"""Add an `admin` array (official city districts) to a district's search.json.

Vlad (msg 2964/2970): the City-mode minimap shows ONLY globally-significant labels — for Prague the numbered
city districts "Praha 1"…"Praha 16" (admin_level-9 boundaries), drawn as DASHED OUTLINES with just the number
inside. Those districts are boundary *relations*, not place nodes, so they aren't in the baked search.json.
This harvests each district's outer boundary ring (projected with the district's own meta.json projection,
then decimated) plus its area-weighted centroid, and writes:

    search.json["admin"] = [{name, x, y, n, poly}]   # n = trailing number or null; poly = [[x,y],…] world coords

No re-bake — same post-bake-patch pattern as add_landmarks_to_search.py.

Usage:
  python tools/add_admin_districts.py data/osm/praha.osm.pbf data/cities/cz/praha/prague --match '^Praha \\d+$'
"""
import argparse
import json
import re
from pathlib import Path

import osmium


def decimate(poly, min_d):
    """Keep the first/last vertex and any vertex >= min_d metres from the last kept one."""
    if len(poly) <= 3:
        return poly
    out = [poly[0]]
    md2 = min_d * min_d
    for p in poly[1:-1]:
        if (p[0] - out[-1][0]) ** 2 + (p[1] - out[-1][1]) ** 2 >= md2:
            out.append(p)
    out.append(poly[-1])
    return out


def ring_centroid(ring):
    """Area-weighted (shoelace) centroid of a world-coord ring; vertex mean for degenerate rings."""
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-9:
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    a *= 0.5
    return cx / (6 * a), cy / (6 * a)


def harvest(pbf: str, level: int, rx: re.Pattern) -> dict:
    """name -> largest outer ring as [(lon,lat),…] for boundary=administrative areas at `level` matching `rx`."""
    found = {}      # name -> (lonlat_ring, area)
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
            area = abs(sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1)))
            if name not in found or area > found[name][1]:
                found[name] = (pts, area)
    return {k: v[0] for k, v in found.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pbf")
    ap.add_argument("dist_dir")
    ap.add_argument("--level", type=int, default=9, help="admin_level of the city districts (Prague obvody = 9)")
    ap.add_argument("--match", default=r"^.+ \d+$", help="regex the district name must match")
    ap.add_argument("--simplify", type=float, default=90.0, help="boundary decimation distance, metres")
    args = ap.parse_args()

    d = Path(args.dist_dir)
    proj = json.loads((d / "meta.json").read_text(encoding="utf-8"))["proj"]
    lat0, lon0, kx, ky = proj["lat0"], proj["lon0"], proj["kx"], proj["ky"]
    to_xy = lambda lon, lat: ((lon - lon0) * kx, (lat - lat0) * ky)

    rx = re.compile(args.match)
    found = harvest(args.pbf, args.level, rx)

    admin = []
    for name, lonlat in found.items():
        ring = [to_xy(lon, lat) for lon, lat in lonlat]
        cx, cy = ring_centroid(ring)
        poly = [[round(x, 1), round(y, 1)] for x, y in decimate(ring, args.simplify)]
        m = re.search(r"(\d+)\s*$", name)
        admin.append({
            "name": name,
            "x": round(cx, 1),
            "y": round(cy, 1),
            "n": int(m.group(1)) if m else None,
            "poly": poly,
        })
    admin.sort(key=lambda a: (a["n"] is None, a["n"] or 0, a["name"]))

    sj_path = d / "search.json"
    sj = json.loads(sj_path.read_text(encoding="utf-8"))
    sj["admin"] = admin
    sj_path.write_text(json.dumps(sj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pts = sum(len(a["poly"]) for a in admin)
    print(f"wrote {len(admin)} admin districts ({pts} boundary pts) → {sj_path}: {[a['name'] for a in admin]}")


if __name__ == "__main__":
    main()
