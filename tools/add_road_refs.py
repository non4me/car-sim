#!/usr/bin/env python3
"""Add a `road_refs` array (numbered-highway badges) to a district's search.json.

Vlad (msg 2971): the City-mode minimap should show a blue badge with the road number on each highway
(D0, D1, …). Road refs live on the OSM ways, not in the baked overview.json, so this harvests one
representative on-road point per ref (the midpoint of that ref's longest motorway/trunk way), projects it
with the district's meta.json projection, and writes:

    search.json["road_refs"] = [{ref, x, y, m}]    # m = True if the ref is a motorway (dálnice)

No re-bake — same post-bake-patch pattern as add_landmarks_to_search.py / add_admin_districts.py.

Usage:
  python tools/add_road_refs.py data/osm/praha.osm.pbf data/cities/cz/praha/prague
"""
import argparse
import json
from pathlib import Path

import osmium


def harvest(pbf: str):
    """ref -> {'pts': longest-way geometry [(lon,lat)…], 'len': nodes, 'm': is-motorway}."""
    best = {}
    fp = osmium.FileProcessor(pbf).with_locations().with_filter(osmium.filter.KeyFilter("highway"))
    for o in fp:
        if not o.is_way():
            continue
        t = o.tags
        hw = t.get("highway")
        if hw not in ("motorway", "trunk"):
            continue
        ref = t.get("ref")
        if not ref:
            continue
        ref = ref.split(";")[0].strip()
        if not ref:
            continue
        pts = []
        for n in o.nodes:
            if n.location.valid():
                pts.append((n.location.lon, n.location.lat))
        if len(pts) < 2:
            continue
        is_m = hw == "motorway"
        cur = best.get(ref)
        if cur is None or len(pts) > cur["len"]:
            best[ref] = {"pts": pts, "len": len(pts), "m": (cur["m"] if cur else False) or is_m}
        elif is_m:
            cur["m"] = True
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pbf")
    ap.add_argument("dist_dir")
    args = ap.parse_args()

    d = Path(args.dist_dir)
    proj = json.loads((d / "meta.json").read_text(encoding="utf-8"))["proj"]
    lat0, lon0, kx, ky = proj["lat0"], proj["lon0"], proj["kx"], proj["ky"]
    to_xy = lambda lon, lat: ((lon - lon0) * kx, (lat - lat0) * ky)

    best = harvest(args.pbf)
    refs = []
    for ref, v in best.items():
        pts = v["pts"]
        lon, lat = pts[len(pts) // 2]                       # midpoint node — sits on the road
        x, y = to_xy(lon, lat)
        refs.append({"ref": ref, "x": round(x, 1), "y": round(y, 1), "m": bool(v["m"])})
    # motorways first, then by ref so the de-overlap favours the dálnice
    refs.sort(key=lambda r: (not r["m"], r["ref"]))

    sj_path = d / "search.json"
    sj = json.loads(sj_path.read_text(encoding="utf-8"))
    sj["road_refs"] = refs
    sj_path.write_text(json.dumps(sj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(refs)} road refs → {sj_path}: {[r['ref'] for r in refs]}")


if __name__ == "__main__":
    main()
