"""Approximate public-transport travel times from busrouter.sg bus data + OSM rail data.
Nodes: bus stops and MRT stations (walkable), plus 'on-service' nodes so waiting is paid only when boarding."""

import json, math, re, heapq, collections

DEFAULTS = dict(
    walk_kmh=4.5,
    walk_circ=1.3,
    walk_link_m=300,
    station_link_m=450,
    bus_kmh=19.0,
    bus_circ=1.25,
    bus_dwell_s=20,
    bus_wait_min=6.0,
    mrt_kmh=42.0,
    mrt_dwell_s=30,
    mrt_wait_min=3.5,
)


def dist_km(la1, lo1, la2, lo2):
    x = (lo2 - lo1) * math.cos(math.radians((la1 + la2) / 2))
    y = la2 - la1
    return 111.32 * math.hypot(x, y)


class Topology:
    """Parameter-independent structure: nodes and edges with raw distances."""

    def __init__(self, base="data"):
        stops = json.load(open(f"{base}/bus/stops.min.json"))
        services = json.load(open(f"{base}/bus/services.min.json"))
        rail = json.load(open(f"{base}/rail/sg-rail.geojson"))["features"]
        self.names, self.lat, self.lng = [], [], []
        self.idx = {}
        for sid, (lng, lat, name, _road) in stops.items():
            self.idx[("b", sid)] = len(self.names)
            self.names.append(name)
            self.lat.append(lat)
            self.lng.append(lng)
        self.n_bus_stops = len(self.names)
        rail_st = [f for f in rail if f["properties"].get("stop_type") == "station"]
        codes = collections.defaultdict(list)
        self.station_idx = {}
        for f in rail_st:
            p = f["properties"]
            lng, lat = f["geometry"]["coordinates"][:2]
            i = len(self.names)
            self.names.append(p["name"])
            self.lat.append(lat)
            self.lng.append(lng)
            self.station_idx[p["name"]] = i
            for tok in re.split(r"[-;,]", p["station_codes"]):
                tok = tok.strip()
                if tok == "STC":
                    codes["SE"].append((0, i))
                    codes["SW"].append((0, i))
                elif tok == "PTC":
                    codes["PE"].append((0, i))
                    codes["PW"].append((0, i))
                else:
                    m = re.fullmatch(r"([A-Z]+?)(\d*)", tok)
                    if m:
                        codes[m.group(1)].append((int(m.group(2) or 0), i))
        self.n_w = len(self.names)
        # edges: (u, v, kind, km, aux)  kinds: walk, ride_bus, ride_rail, board_bus, board_rail, alight
        self.edges = []
        self.n_nodes = self.n_w
        for sv in services.values():
            for route in sv["routes"]:
                prev = None
                for sid in route:
                    w = self.idx.get(("b", sid))
                    if w is None:
                        continue
                    on = self.n_nodes
                    self.n_nodes += 1
                    self.edges.append((w, on, "board_bus", 0, 0))
                    self.edges.append((on, w, "alight", 0, 0))
                    if prev is not None:
                        pw, pon = prev
                        self.edges.append(
                            (
                                pon,
                                on,
                                "ride_bus",
                                dist_km(self.lat[pw], self.lng[pw], self.lat[w], self.lng[w]),
                                0,
                            )
                        )
                    prev = (w, on)
        self.rail_gaps = {}
        for line, lst in codes.items():
            lst = sorted(set(lst))
            self.rail_gaps[line] = len(lst)
            prev = None
            for _num, w in lst:
                on = self.n_nodes
                self.n_nodes += 1
                self.edges.append((w, on, "board_rail", 0, 0))
                self.edges.append((on, w, "alight", 0, 0))
                if prev is not None:
                    pw, pon = prev
                    d = dist_km(self.lat[pw], self.lng[pw], self.lat[w], self.lng[w])
                    self.edges.append((pon, on, "ride_rail", d, 0))
                    self.edges.append((on, pon, "ride_rail", d, 0))
                prev = (w, on)
        # walk links between walkable nodes
        cell = 0.004
        grid = collections.defaultdict(list)
        for i in range(self.n_w):
            grid[(int(self.lat[i] / cell), int(self.lng[i] / cell))].append(i)
        self.walk = []
        for i in range(self.n_w):
            cy, cx = int(self.lat[i] / cell), int(self.lng[i] / cell)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for j in grid.get((cy + dy, cx + dx), ()):
                        if j <= i:
                            continue
                        d = dist_km(self.lat[i], self.lng[i], self.lat[j], self.lng[j])
                        if d <= 0.45:
                            self.walk.append(
                                (i, j, d, i >= self.n_bus_stops or j >= self.n_bus_stops)
                            )
        self.grid, self.cell = grid, cell

    def build(self, **kw):
        p = dict(DEFAULTS, **kw)
        adj = [[] for _ in range(self.n_nodes)]
        wm = lambda d: d * p["walk_circ"] / p["walk_kmh"] * 60
        for i, j, d, has_station in self.walk:
            lim = p["station_link_m"] if has_station else p["walk_link_m"]
            if d * 1000 <= lim:
                c = wm(d)
                adj[i].append((j, c))
                adj[j].append((i, c))
        for u, v, kind, d, _ in self.edges:
            if kind == "board_bus":
                c = p["bus_wait_min"]
            elif kind == "board_rail":
                c = p["mrt_wait_min"]
            elif kind == "alight":
                c = 0.0
            elif kind == "ride_bus":
                c = d * p["bus_circ"] / p["bus_kmh"] * 60 + p["bus_dwell_s"] / 60
            else:
                c = d / p["mrt_kmh"] * 60 + p["mrt_dwell_s"] / 60
            adj[u].append((v, c))
        return adj

    def near(self, lat, lng, radius_km=0.6):
        out = []
        cy, cx = int(lat / self.cell), int(lng / self.cell)
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                for j in self.grid.get((cy + dy, cx + dx), ()):
                    d = dist_km(lat, lng, self.lat[j], self.lng[j])
                    if d <= radius_km:
                        out.append((j, d))
        return out


def travel_minutes(topo, adj, a, b, walk_kmh=4.5, walk_circ=1.3, radius_km=0.6):
    """a, b = (lat, lng). Minutes by transit incl. walking at both ends; None if unreachable."""
    wm = lambda d: d * walk_circ / walk_kmh * 60
    src = {j: wm(d) for j, d in topo.near(*a, radius_km)}
    dst = {j: wm(d) for j, d in topo.near(*b, radius_km)}
    if not src or not dst:
        return None
    best = dist_km(*a, *b) * walk_circ / walk_kmh * 60 if dist_km(*a, *b) < 1.2 else float("inf")
    dist = dict(src)
    h = [(c, j) for j, c in src.items()]
    heapq.heapify(h)
    done = set()
    while h:
        c, u = heapq.heappop(h)
        if u in done:
            continue
        done.add(u)
        if c >= best:
            break
        if u in dst:
            best = min(best, c + dst[u])
        for v, w in adj[u]:
            nc = c + w
            if nc < dist.get(v, 1e18):
                dist[v] = nc
                heapq.heappush(h, (nc, v))
    return None if best == float("inf") else best
