#!/usr/bin/env python3
"""Extract a REAL junction's geometry from car-sim's OSM bake into a situation-quiz scene stub (msg 3104).

car-sim already bakes precise OSM geometry (lanes/width/oneway/name per edge, signs, rails, crossings) for
every city. Rather than hand-trace junctions, this pulls a real junction straight from the bake, so the
situation quizzes are faithful AND can be authored at scale. It emits the `geom` block (roads with real
street names, signs, rails, crossings, deduped street labels, junction-core mask) + a suggested view in the
scene's centre-origin, y-up frame; the teaching layer (actors / decision / question / options / explain /
stats / location) is authored by hand on top.

Locate a junction by a street pair (from search.json) or explicit coords:
  python3 tools/extract_junction.py --city praha --streets "Sokolská|Ječná" --name "I. P. Pavlova" --r 55
  python3 tools/extract_junction.py --city praha --xy 1234 -5678 --r 50
"""
import argparse, glob, json, math, os, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TILE_M = 400.0
KEEP_CLS = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential",
            "unclassified", "living_street",
            "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
PRIORITY_CLS = {"motorway", "trunk", "primary", "secondary"}
SIGN_CODE = {"give_way": "P4", "priority_road": "P2", "stop": "P6", "signal": "signal"}


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c)).lower().strip()


def _pathlen(cl):
    return sum(math.dist(cl[i - 1], cl[i]) for i in range(1, len(cl)))


def _walk(cl, dist):                       # point + heading `dist` metres along cl from its start
    acc = 0
    for i in range(1, len(cl)):
        seg = math.dist(cl[i - 1], cl[i])
        if acc + seg >= dist and seg:
            t = (dist - acc) / seg
            p = [cl[i - 1][0] + (cl[i][0] - cl[i - 1][0]) * t, cl[i - 1][1] + (cl[i][1] - cl[i - 1][1]) * t]
            return p, math.atan2(cl[i][1] - cl[i - 1][1], cl[i][0] - cl[i - 1][0])
        acc += seg
    a, b = cl[-2], cl[-1]
    return b, math.atan2(b[1] - a[1], b[0] - a[0])


def city_dir(city):
    base = ROOT / "data" / "cities" / "cz" / city
    for d in sorted(base.glob("*")):
        if (d / "meta.json").exists() and (d / "tiles").is_dir():
            return d
    sys.exit(f"no baked tiles for city '{city}' under {base}")


def load_tiles(tdir, cx, cy, half):
    """Load every tile overlapping the [cx±half, cy±half] window; return merged feature lists."""
    i0, i1 = int(math.floor((cx - half) / TILE_M)), int(math.floor((cx + half) / TILE_M))
    j0, j1 = int(math.floor((cy - half) / TILE_M)), int(math.floor((cy + half) / TILE_M))
    out = {k: [] for k in ("edges", "junctions", "signs", "crossings", "rails")}
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            f = tdir / "tiles" / f"{i}_{j}.json"
            if not f.exists():
                continue
            t = json.loads(f.read_text())
            for k in out:
                out[k].extend(t.get(k, []))
    return out


def find_center(feat, streets, near):
    """Intersection node of two street names, else the seed point."""
    a, b = (fold(x) for x in streets)
    ea = [e for e in feat["edges"] if a in fold(e.get("name", ""))]
    eb = [e for e in feat["edges"] if b in fold(e.get("name", ""))]
    if not ea or not eb:
        sys.exit(f"streets not both found in window (A:{len(ea)} B:{len(eb)} edges) — widen --win or use --xy")
    nodes_b = {n for e in eb for n in (e["a"], e["b"])}
    shared = []
    for e in ea:
        for end, n in (("a", e["a"]), ("b", e["b"])):
            if n in nodes_b:
                p = e["geom"][0] if end == "a" else e["geom"][-1]
                shared.append(p)
    if not shared:                        # no shared node — fall back to closest approach of the two geometries
        best, bd = None, 1e18
        for x in ea:
            for px in x["geom"]:
                for y in eb:
                    for py in y["geom"]:
                        d = (px[0] - py[0]) ** 2 + (px[1] - py[1]) ** 2
                        if d < bd:
                            bd, best = d, [(px[0] + py[0]) / 2, (px[1] + py[1]) / 2]
        if bd > 40 ** 2:
            sys.exit(f"streets do not meet within 40 m (min gap {math.sqrt(bd):.0f} m)")
        return best
    if near:
        shared.sort(key=lambda p: (p[0] - near[0]) ** 2 + (p[1] - near[1]) ** 2)
    return shared[0]


def clip_runs(geom, cx, cy, R):
    """Sub-polylines of `geom` lying within radius R of (cx,cy), splitting boundary segments."""
    R2 = R * R
    inside = lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2 <= R2

    def cross(p, q):                       # point where segment p->q crosses the circle
        dx, dy = q[0] - p[0], q[1] - p[1]
        fx, fy = p[0] - cx, p[1] - cy
        A = dx * dx + dy * dy
        B = 2 * (fx * dx + fy * dy)
        C = fx * fx + fy * fy - R2
        disc = B * B - 4 * A * C
        if disc < 0 or A == 0:
            return None
        disc = math.sqrt(disc)
        for t in ((-B - disc) / (2 * A), (-B + disc) / (2 * A)):
            if 0 <= t <= 1:
                return [p[0] + dx * t, p[1] + dy * t]
        return None

    runs, cur = [], []
    for i, p in enumerate(geom):
        if inside(p):
            if not cur and i > 0:                 # entered: add boundary point
                c = cross(geom[i - 1], p)
                if c:
                    cur.append(c)
            cur.append(p)
        else:
            if cur:
                c = cross(geom[i - 1], p)
                if c:
                    cur.append(c)
                runs.append(cur); cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True)
    ap.add_argument("--streets", help='"NameA|NameB" to locate the intersection')
    ap.add_argument("--xy", nargs=2, type=float, help="explicit centre in projected metres")
    ap.add_argument("--near", nargs=2, type=float, help="disambiguate multiple crossings (projected metres)")
    ap.add_argument("--name", default="", help="junction display name")
    ap.add_argument("--r", type=float, default=55.0, help="extract radius (m)")
    ap.add_argument("--win", type=float, default=1100.0, help="street-search window half-size (m)")
    ap.add_argument("--out", help="output file (default stdout)")
    args = ap.parse_args()

    tdir = city_dir(args.city)
    meta = json.loads((tdir / "meta.json").read_text())

    if args.xy:
        cx, cy = args.xy
    else:
        if not args.streets or "|" not in args.streets:
            sys.exit("need --streets 'A|B' or --xy X Y")
        cx, cy = locate(tdir, args.streets, args.near, args.win)

    geom, info = build_geom(tdir, cx, cy, args.r, meta)
    span = args.r + 8
    stub = {
        "id": "TODO_id", "order": 0, "city": args.city,
        "junction": {"name": args.name or "TODO", "lat": info["lat"], "lon": info["lon"], "source": "OSM bake (car-sim)"},
        "stats": {"_comment": "fill: accidents/injured/period/source if known"},
        "title": {"cs": "TODO"}, "hint": {"cs": "Sledujte situaci a rozhodněte, jak budete pokračovat."},
        "view": {"minx": -span, "miny": -span, "maxx": span, "maxy": span},
        "geom": geom,
        "actors": [{"kind": "ego", "path": [["TODO"]], "v": 8, "spawn": 0}],
        "decision": {"t": 3.0},
        "question": {"cs": "TODO"}, "options": [], "explain": {"cs": "TODO"}, "citation": "TODO",
    }
    out = json.dumps(stub, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(out)
    else:
        print(out)
    print(f"\n# center=({cx:.1f},{cy:.1f}) roads={len(geom['roads'])} signs={len(geom['signs'])} "
          f"rails={len(geom['rails'])} crossings={len(geom['crossings'])} streets={info['streets']}", file=sys.stderr)


def locate(tdir, streets, near=None, win=1100.0):
    """Return the projected-metre centre of a junction given a 'A|B' street pair (+ optional --near seed)."""
    if near:
        seed = {"x": near[0], "y": near[1]}
    else:
        sj = json.loads((tdir / "search.json").read_text())
        a = fold(streets.split("|")[0])
        s = next((s for s in sj["streets"] if a in fold(s["name"])), None)
        if not s:
            sys.exit(f"street '{streets.split('|')[0]}' not in search.json")
        seed = s
    w = load_tiles(tdir, seed["x"], seed["y"], win)
    cx, cy = find_center(w, streets.split("|"), near)
    sw = load_tiles(tdir, cx, cy, TILE_M)
    cand = [(j["x"], j["y"]) for j in sw["junctions"] if j.get("deg", 0) >= 3
            and (j["x"] - cx) ** 2 + (j["y"] - cy) ** 2 <= 30 ** 2]
    return min(cand, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2) if cand else (cx, cy)


def build_geom(tdir, cx, cy, R, meta):
    """Build a scene `geom` dict (roads/rails/signs/crossings/labels/core) around (cx,cy) in the centre-origin,
    north-up frame. Returns (geom, info) where info has lat/lon + the street-name list."""
    feat = load_tiles(tdir, cx, cy, R + TILE_M)
    sx = lambda x: round(x - cx, 1)
    sy = lambda y: round(-(y - cy), 1)         # flip → north up in the y-down canvas

    roads, names = [], {}
    for e in feat["edges"]:
        if e.get("cls") not in KEEP_CLS:
            continue
        for run in clip_runs(e["geom"], cx, cy, R):
            cl = [[sx(p[0]), sy(p[1])] for p in run]
            length = sum(math.dist(cl[i - 1], cl[i]) for i in range(1, len(cl)))
            if length < 6:
                continue
            roads.append({"name": e.get("name", ""), "centerline": cl,
                          "halfW": round(e.get("width", 6.0) / 2, 2), "lanes": e.get("lanes", 2),
                          "oneway": bool(e.get("oneway")), "priority": e.get("cls") in PRIORITY_CLS})
            nm = e.get("name", "")
            if nm and (nm not in names or length > names[nm]["len"]):
                names[nm] = {"len": length, "cl": cl}

    signs = [{"code": SIGN_CODE[s["kind"]], "x": sx(s["x"]), "y": sy(s["y"])}
             for s in feat["signs"] if (s["x"] - cx) ** 2 + (s["y"] - cy) ** 2 <= R * R and s["kind"] in SIGN_CODE]
    rails = []
    for rl in feat["rails"]:
        g = rl.get("geom") or ([[rl["x"], rl["y"]]] if "x" in rl else None)
        if not g:
            continue
        for run in clip_runs(g, cx, cy, R):
            rails.append([[sx(p[0]), sy(p[1])] for p in run])
    crossings = [{"center": [sx(c["x"]), sy(c["y"])], "dir": [c.get("tx", 1), -c.get("ty", 0)],
                  "halfW": round(c.get("w", 6) / 2, 2)}
                 for c in feat["crossings"] if (c["x"] - cx) ** 2 + (c["y"] - cy) ** 2 <= R * R]

    labels = []                                # one deduped label per street, ~60% out along its arm, along the road
    for nm, ninfo in names.items():
        cl = ninfo["cl"]
        if math.hypot(*cl[0]) > math.hypot(*cl[-1]):   # orient core→outer
            cl = cl[::-1]
        target = min(_pathlen(cl) * 0.7, R * 0.6)
        p, ang = _walk(cl, target)
        ang += -math.pi if ang > math.pi / 2 else (math.pi if ang < -math.pi / 2 else 0)
        labels.append({"x": round(p[0], 1), "y": round(p[1], 1), "text": nm, "rot": round(ang, 3)})

    geom = {"core": {"x": 0, "y": 0, "r": 6}, "roads": roads, "rails": rails,
            "signs": signs, "crossings": crossings, "labels": labels}
    info = {"lat": round(cy / meta["proj"]["ky"] + meta["proj"]["lat0"], 6),
            "lon": round(cx / meta["proj"]["kx"] + meta["proj"]["lon0"], 6), "streets": sorted(names)}
    return geom, info


def load_city(city):
    tdir = city_dir(city)
    return tdir, json.loads((tdir / "meta.json").read_text())


if __name__ == "__main__":
    main()
