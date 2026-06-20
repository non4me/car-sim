#!/usr/bin/env python3
"""Geometric correctness test for road intersections in a baked city graph.

Roads are rendered as centerline strokes of width `w` with round caps (so a stroke reaches w/2 past
its centerline endpoint). For intersections to read as a single continuous carriageway — "стык в стык",
no gaps, no overshoots — we check:

  TEST 1  COINCIDENCE — edges sharing a node id must have coincident geometry endpoints, else the
          centerlines don't meet → gap / overlapping splay at that junction.

  TEST 2  DEAD-END vs FOREIGN ROAD — a degree-1 road end near another road, classified using width:
            • GAP        — the road stops short; surface-to-surface clearance D - wS/2 - wM/2 > tol,
                           and the road is aimed at the other road (an approach, not a parallel street).
            • OVERSHOOT  — the road crosses the other road's centerline and its end pokes past the far
                           edge (D - wM/2 beyond the carriageway).
            • UNNODED-T  — the end lies essentially on another road's centerline but shares no node
                           (a T-junction that was never noded → not a real junction in data).

Map-edge dead-ends (truncated at the city bbox) are excluded.

Usage:  .venv/bin/python tools/test_intersections.py [graph.json] [--json out.json]
"""
import json, sys, math, glob, os
from collections import defaultdict

JSON_OUT = None
argv = sys.argv[1:]
positional = []
i = 0
while i < len(argv):
    if argv[i] == '--json':
        JSON_OUT = argv[i + 1]; i += 2; continue
    if not argv[i].startswith('-'):
        positional.append(argv[i])
    i += 1
GRAPH = positional[0] if positional else 'data/cities/cz/praha/prague/graph.json'
CITY_DIR = os.path.dirname(GRAPH)
META = os.path.join(CITY_DIR, 'meta.json')

COINCIDE_TOL = 0.5     # m
GAP_TOL = 0.5          # m of visible asphalt-to-asphalt clearance before it counts as a gap
APPROACH_DOT = 0.30    # the foreign road must be roughly ahead of the dead-end's heading
TOUCH_TOL = 0.4        # m — end effectively on the other centerline → unnoded T
BBOX_MARGIN = 60.0     # m — ignore dead-ends this close to the city bbox (map-edge truncations)
NEAR = 14.0            # m search radius for a foreign road

edges = json.load(open(GRAPH))
meta = json.load(open(META))
pj = meta['proj']; lat0, lon0, kx, ky = pj['lat0'], pj['lon0'], pj['kx'], pj['ky']
bx = meta['bounds']
def to_ll(x, y): return (lat0 + y / ky, lon0 + x / kx)
def dist(p, q): return math.hypot(p[0] - q[0], p[1] - q[1])

# width per edge, joined from the tiles by node-pair (geom is identical/unclipped)
wmap = {}
for tf in glob.glob(os.path.join(CITY_DIR, 'tiles', '*.json')):
    for e in json.load(open(tf)).get('edges', []):
        a, b, w = e.get('a'), e.get('b'), e.get('width')
        if a is not None and b is not None and w:
            wmap[(min(a, b), max(a, b))] = (w, e.get('cls'))
def ewidth(e): return wmap.get((min(e[0], e[1]), max(e[0], e[1])), (6.0, None))[0]

# index endpoints by node
node_pts = defaultdict(list)        # nid -> [(xy, edge_idx)]
for i, e in enumerate(edges):
    geom = e[3]
    if not geom or len(geom) < 2:
        continue
    node_pts[e[0]].append((tuple(geom[0]), i))
    node_pts[e[1]].append((tuple(geom[-1]), i))
degree = {n: len(v) for n, v in node_pts.items()}

# ---- TEST 1 ----
mis = []
for nid, pts in node_pts.items():
    if len(pts) < 2:
        continue
    mx = max((dist(pts[i][0], pts[j][0])
              for i in range(len(pts)) for j in range(i + 1, len(pts))), default=0.0)
    if mx > COINCIDE_TOL:
        mis.append((mx, nid, pts[0][0], len(pts)))
mis.sort(reverse=True)

# ---- spatial hash of segments ----
CELL = 25.0
grid = defaultdict(list)
def cells(p, q):
    for cx in range(int(min(p[0], q[0]) // CELL), int(max(p[0], q[0]) // CELL) + 1):
        for cy in range(int(min(p[1], q[1]) // CELL), int(max(p[1], q[1]) // CELL) + 1):
            yield (cx, cy)
for i, e in enumerate(edges):
    g = e[3]
    if not g or len(g) < 2:
        continue
    for k in range(len(g) - 1):
        p, q = tuple(g[k]), tuple(g[k + 1])
        for c in cells(p, q):
            grid[c].append((p, q, i))

def foot(pt, a, b):
    ax, ay = a; bx2, by2 = b; px, py = pt
    dx, dy = bx2 - ax, by2 - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return a, dist(pt, a)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    fx, fy = ax + t * dx, ay + t * dy
    return (fx, fy), math.hypot(px - fx, py - fy)

def ccw(A, B, C): return (C[1]-A[1])*(B[0]-A[0]) > (B[1]-A[1])*(C[0]-A[0])
def seg_cross(A, B, C, D):
    return ccw(A, C, D) != ccw(B, C, D) and ccw(A, B, C) != ccw(A, B, D)

def at_bbox(p):
    return (p[0] - bx['minx'] < BBOX_MARGIN or bx['maxx'] - p[0] < BBOX_MARGIN or
            p[1] - bx['miny'] < BBOX_MARGIN or bx['maxy'] - p[1] < BBOX_MARGIN)

# ---- TEST 2 ----
gaps, overs, unnoded = [], [], []
for nid, pts in node_pts.items():
    if degree.get(nid, 0) != 1:
        continue
    P, eidx = pts[0]
    if at_bbox(P):
        continue
    g = edges[eidx][3]
    prev = tuple(g[-2]) if tuple(g[-1]) == P else tuple(g[1])   # neighbour vertex along this road
    tdx, tdy = P[0] - prev[0], P[1] - prev[1]
    tl = math.hypot(tdx, tdy) or 1.0
    tdx, tdy = tdx / tl, tdy / tl
    wS = ewidth(edges[eidx])

    best = None
    R = int(math.ceil(NEAR / CELL))
    cx, cy = int(P[0] // CELL), int(P[1] // CELL)
    for ax in range(cx - R, cx + R + 1):
        for ay in range(cy - R, cy + R + 1):
            for (p, q, j) in grid.get((ax, ay), ()):
                if j == eidx:
                    continue
                F, D = foot(P, p, q)
                if best is None or D < best[0]:
                    best = (D, F, p, q, j)
    if not best or best[0] > NEAR:
        continue
    D, F, p, q, j = best
    wM = ewidth(edges[j])
    # is the foreign road ahead of where this road is heading?
    fl = dist(P, F) or 1.0
    ahead = ((F[0] - P[0]) / fl) * tdx + ((F[1] - P[1]) / fl) * tdy
    crosses = seg_cross(prev, P, p, q)

    ll = to_ll(*P)
    rec = {'node': nid, 'lat': round(ll[0], 5), 'lon': round(ll[1], 5),
           'D': round(D, 2), 'wS': wS, 'wM': wM}
    if crosses and D > wM / 2 + TOUCH_TOL:
        rec['overshoot_m'] = round(D - wM / 2, 2)
        overs.append((D - wM / 2, rec))
    elif D <= TOUCH_TOL:
        unnoded.append((D, rec))
    elif ahead > APPROACH_DOT:
        clear = D - wS / 2 - wM / 2
        if clear > GAP_TOL:
            rec['gap_m'] = round(clear, 2)
            gaps.append((clear, rec))

gaps.sort(key=lambda x: x[0], reverse=True); overs.sort(key=lambda x: x[0], reverse=True); unnoded.sort(key=lambda x: x[0])

multi = sum(1 for v in node_pts.values() if len(v) >= 2)
print(f"city: {len(edges)} edges, {len(node_pts)} nodes, {multi} junctions, "
      f"{sum(1 for n in degree if degree[n]==1)} dead-ends\n")
print(f"TEST 1  shared-node coincidence (tol {COINCIDE_TOL}m): {len(mis)} misaligned junctions")
for spread, nid, xy, deg in mis[:10]:
    la, lo = to_ll(*xy); print(f"        spread {spread:.2f}m deg {deg} @ {la:.5f},{lo:.5f}")
print(f"\nTEST 2  dead-end vs foreign road (width-aware):")
print(f"        GAPS (visible asphalt clearance > {GAP_TOL}m): {len(gaps)}")
for c, r in gaps[:12]:
    print(f"          gap {r['gap_m']:5.2f}m  (centre-dist {r['D']}m, wS {r['wS']}, wM {r['wM']})  @ {r['lat']},{r['lon']}")
print(f"        OVERSHOOTS (poke past far edge): {len(overs)}")
for c, r in overs[:12]:
    print(f"          over {r['overshoot_m']:5.2f}m  @ {r['lat']},{r['lon']}")
print(f"        UNNODED-T (end on a road, no shared node): {len(unnoded)}")
for c, r in unnoded[:12]:
    print(f"          on-centreline {r['D']}m  @ {r['lat']},{r['lon']}")

if JSON_OUT:
    json.dump({'misaligned': [r for _, r in [(m[0], {'spread': m[0], 'node': m[1],
              'lat': to_ll(*m[2])[0], 'lon': to_ll(*m[2])[1], 'deg': m[3]}) for m in mis]],
               'gaps': [r for _, r in gaps], 'overshoots': [r for _, r in overs],
               'unnoded': [r for _, r in unnoded]}, open(JSON_OUT, 'w'), indent=1)
    print(f"\nwrote {JSON_OUT}")
