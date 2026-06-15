"""Server-side shortest-path routing on a baked road graph (graph.json).

The full city graph (113k edges) is too big to ship to the streaming client, so routing lives here:
load the directed graph once per district, A* between the nodes nearest the from/to points, return
the route polyline (following real road geometry) + length. One-way streets are honoured (a two-way
edge adds both directions, a one-way only its flow direction). Turn-restriction "rules" beyond
one-ways are a future enhancement.
"""
import heapq
import json
import math
from pathlib import Path

_routers: dict = {}
_CELL = 200  # metres, for nearest-node grid


class Router:
    def __init__(self, graph_path: Path):
        rows = json.loads(Path(graph_path).read_text(encoding="utf-8"))
        self.geoms = [None] * len(rows)
        self.node_pt: dict = {}      # node id -> (x, y)
        self.adj: dict = {}          # node id -> list of (nbr, cost, geom_index, forward)
        self.grid: dict = {}         # (cx, cy) -> [node ids]

        def add_node(nid, x, y):
            if nid not in self.node_pt:
                self.node_pt[nid] = (x, y)
                self.grid.setdefault((int(x // _CELL), int(y // _CELL)), []).append(nid)

        for gi, (a, b, ow, g) in enumerate(rows):
            self.geoms[gi] = g
            add_node(a, g[0][0], g[0][1])
            add_node(b, g[-1][0], g[-1][1])
            length = 0.0
            for i in range(1, len(g)):
                length += math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1])
            self.adj.setdefault(a, []).append((b, length, gi, True))
            if not ow:
                self.adj.setdefault(b, []).append((a, length, gi, False))

    def nearest_node(self, x, y):
        cx, cy = int(x // _CELL), int(y // _CELL)
        best, bd = None, 1e18
        rng = 2
        while best is None and rng <= 12:           # widen the ring until a node is found
            for dx in range(-rng, rng + 1):
                for dy in range(-rng, rng + 1):
                    for nid in self.grid.get((cx + dx, cy + dy), []):
                        px, py = self.node_pt[nid]
                        d = (px - x) ** 2 + (py - y) ** 2
                        if d < bd:
                            bd, best = d, nid
            rng += 4
        return best

    def route(self, fx, fy, tx, ty):
        s, t = self.nearest_node(fx, fy), self.nearest_node(tx, ty)
        if s is None or t is None:
            return None
        gx, gy = self.node_pt[t]
        dist = {s: 0.0}
        prev: dict = {}                              # node -> (prev_node, geom_index, forward)
        pq = [(math.hypot(self.node_pt[s][0] - gx, self.node_pt[s][1] - gy), 0.0, s)]
        seen = set()
        while pq:
            _, d, u = heapq.heappop(pq)
            if u in seen:
                continue
            seen.add(u)
            if u == t:
                break
            for (v, w, gi, fwd) in self.adj.get(u, []):
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = (u, gi, fwd)
                    px, py = self.node_pt[v]
                    heapq.heappush(pq, (nd + math.hypot(px - gx, py - gy), nd, v))
        if t != s and t not in prev:
            return None
        # reconstruct the polyline (concatenate edge geoms, reversed where travelled backwards)
        segs, cur = [], t
        while cur != s and cur in prev:
            pu, gi, fwd = prev[cur]
            g = self.geoms[gi]
            segs.append(g if fwd else g[::-1])
            cur = pu
        segs.reverse()
        poly = []
        for seg in segs:
            for p in seg:
                if not poly or poly[-1] != p:
                    poly.append(p)
        return {"polyline": poly, "length_m": round(dist.get(t, 0.0))}


def get_router(graph_path: Path) -> Router | None:
    """Cached per graph file (lazy — only built when routing is first used)."""
    key = str(graph_path)
    if key not in _routers:
        if not Path(graph_path).is_file():
            return None
        _routers[key] = Router(graph_path)
    return _routers[key]
