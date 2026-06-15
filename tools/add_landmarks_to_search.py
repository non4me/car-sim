#!/usr/bin/env python3
"""Add a `landmarks` array to a district's search.json by harvesting the MAJOR named labels already baked
into the tiles (msg 2784: the City/Trasa minimap overviews show "наиболее крупные объекты" city-wide, but
labels stream per-tile so they aren't all in memory at runtime — like streets/places, the overview set must
live in the always-loaded search.json). No re-bake / re-tile needed; only search.json is rewritten.

Usage: python tools/add_landmarks_to_search.py data/cities/cz/praha/prague
"""
import json
import sys
from pathlib import Path

# city-defining categories worth showing at a whole-city scale (the noisy everyday kinds are excluded)
MAJOR = {"airport", "castle", "stadium", "university", "hospital", "station", "museum", "theatre"}


def main(dist_dir: str):
    d = Path(dist_dir)
    sj_path = d / "search.json"
    sj = json.loads(sj_path.read_text(encoding="utf-8"))
    seen, landmarks = set(), []
    for tile in sorted((d / "tiles").glob("*.json")):
        t = json.loads(tile.read_text(encoding="utf-8"))
        for l in t.get("labels", []):
            if l.get("kind") not in MAJOR or not l.get("name"):
                continue
            key = (l["kind"], l["name"], round(l["x"]), round(l["y"]))
            if key in seen:
                continue
            seen.add(key)
            landmarks.append({"name": l["name"], "x": l["x"], "y": l["y"], "kind": l["kind"]})
    landmarks.sort(key=lambda m: m["name"])
    sj["landmarks"] = landmarks
    sj_path.write_text(json.dumps(sj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from collections import Counter
    print(f"wrote {len(landmarks)} landmarks → {sj_path}  {dict(Counter(m['kind'] for m in landmarks))}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/cities/cz/praha/prague")
