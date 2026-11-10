"""Export the transit graph for the browser: data/graph.bin (CSR) + data/graph.json (meta + candidate access lists)."""

import json, sys

sys.path.insert(0, "scripts")
import array
from transit_graph import Topology, DEFAULTS

T = Topology()
adj = T.build()
n = T.n_nodes
offsets = array.array("i", [0])
targets = array.array("i")
costs = array.array("f")
for u in range(n):
    for v, c in adj[u]:
        targets.append(v)
        costs.append(c)
    offsets.append(len(targets))
with open("data/graph.bin", "wb") as f:
    f.write(offsets.tobytes())
    f.write(targets.tobytes())
    f.write(costs.tobytes())

wm = lambda d: round(d * DEFAULTS["walk_circ"] / DEFAULTS["walk_kmh"] * 60, 2)


def access(lat, lng):
    near = T.near(lat, lng, 0.6)
    if not near:
        near = sorted(T.near(lat, lng, 2.0), key=lambda x: x[1])[:3]
    return [[j, wm(d)] for j, d in near]


malls = json.load(open("data/malls.json"))
for m in malls:
    m["access"] = access(m["lat"], m["lng"])
stations = [
    {"name": name, "lat": T.lat[i], "lng": T.lng[i], "node": i}
    for name, i in sorted(T.station_idx.items())
]
meta = {
    "n_nodes": n,
    "n_w": T.n_w,
    "n_edges": len(targets),
    "lat": [round(x, 5) for x in T.lat[: T.n_w]],
    "lng": [round(x, 5) for x in T.lng[: T.n_w]],
    "malls": malls,
    "stations": stations,
    "params": DEFAULTS,
}
json.dump(meta, open("data/graph.json", "w"), separators=(",", ":"), ensure_ascii=False)
print(
    "nodes",
    n,
    "edges",
    len(targets),
    "| malls with no access:",
    sum(1 for m in malls if not m["access"]),
)
