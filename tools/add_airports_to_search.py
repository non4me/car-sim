"""Add big airports (aeroway=aerodrome) to a district's search.json landmarks.

The normal bake (`bake_prague.read_pbf`) harvests landmark labels from nodes + simple ways, so it catches
small airfields but MISSES large airports tagged as multipolygon *relations* — e.g. Letiště Václava Havla
Praha was absent (msg 3185). This post-bake patch reads the city pbf with the area builder (handles
relations), and for each aerodrome places the search point at its passenger-terminal cluster (aeroway=terminal
areas inside the aerodrome) so a route lands AT the terminal, not mid-runway — falling back to the aerodrome
centroid. Same post-bake-patch pattern as add_landmarks_to_search.py / add_admin_districts.py.

Usage:  .venv/bin/python tools/add_airports_to_search.py <city.pbf> <district_dir>
   e.g. .venv/bin/python tools/add_airports_to_search.py data/osm/praha.osm.pbf data/cities/cz/praha/prague
"""
import json
import sys
from pathlib import Path

import osmium


def _ring_centroid_bbox(area):
    xs, ys = [], []
    for ring in area.outer_rings():
        for n in ring:
            xs.append(n.lon); ys.append(n.lat)
    if not xs:
        return None
    return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2,   # clon, clat
            min(xs), min(ys), max(xs), max(ys))                  # bbox


class _Aero(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.aerodromes = []   # (name, clon, clat, bbox)
        self.terminals = []    # (clon, clat)

    def area(self, a):
        t = a.tags
        if t.get("aeroway") == "aerodrome" and t.get("name"):
            c = _ring_centroid_bbox(a)
            if c:
                self.aerodromes.append((t["name"], c[0], c[1], c[2:6]))
        elif t.get("aeroway") == "terminal":
            c = _ring_centroid_bbox(a)
            if c:
                self.terminals.append((c[0], c[1]))


def main(pbf: str, dist_dir: str):
    d = Path(dist_dir)
    meta = json.loads((d / "meta.json").read_text())
    pr = meta["proj"]
    P = lambda lat, lon: ((lon - pr["lon0"]) * pr["kx"], (lat - pr["lat0"]) * pr["ky"])

    h = _Aero()
    h.apply_file(pbf, locations=True)

    sj_path = d / "search.json"
    sj = json.loads(sj_path.read_text())
    landmarks = sj.get("landmarks", [])
    have = {(l.get("kind"), l.get("name")) for l in landmarks}

    added = 0
    for name, clon, clat, bbox in h.aerodromes:
        if ("airport", name) in have:
            continue
        minx, miny, maxx, maxy = bbox
        # passenger-terminal cluster inside this aerodrome → land the route at the terminal, not mid-runway
        tin = [(tx, ty) for (tx, ty) in h.terminals if minx <= tx <= maxx and miny <= ty <= maxy]
        if tin:
            plon = sum(t[0] for t in tin) / len(tin)
            plat = sum(t[1] for t in tin) / len(tin)
        else:
            plon, plat = clon, clat
        x, y = P(plat, plon)
        landmarks.append({"name": name, "x": round(x, 1), "y": round(y, 1), "kind": "airport"})
        have.add(("airport", name))
        added += 1
        print(f"  + {name}  → world ({x:.0f}, {y:.0f})  [{'terminal' if tin else 'centroid'}]")

    sj["landmarks"] = landmarks
    sj_path.write_text(json.dumps(sj, ensure_ascii=False, separators=(",", ":")))
    n_air = sum(1 for l in landmarks if l.get("kind") == "airport")
    print(f"wrote {added} new airport(s); {n_air} airport landmarks total → {sj_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
