"""Group MRT station exits into one point per station -> data/stations.json"""

import json, re, collections

g = json.load(open("data/mrt-exits.geojson"))
acc = collections.defaultdict(list)
for f in g["features"]:
    name = re.sub(r"\s+(MRT|LRT)\s+STATION$", "", f["properties"]["STATION_NA"]).title()
    acc[name].append(f["geometry"]["coordinates"])
out = [
    {
        "name": n,
        "lng": round(sum(c[0] for c in v) / len(v), 5),
        "lat": round(sum(c[1] for c in v) / len(v), 5),
    }
    for n, v in sorted(acc.items())
]
json.dump(out, open("data/stations.json", "w"), separators=(",", ":"))
print(len(out), "stations")
