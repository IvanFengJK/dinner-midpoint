"""OSM malls (data/malls-raw.json) -> data/malls.json: deduped by name, with nearest MRT station."""
import json, math, collections
raw = json.load(open('data/malls-raw.json'))['elements']
stations = json.load(open('data/stations.json'))

def pt(e):
    return (e['lat'], e['lon']) if 'lat' in e else (e['center']['lat'], e['center']['lon'])

def km(a, b):
    r, p = 6371, math.pi / 180
    h = math.sin((b[0]-a[0])*p/2)**2 + math.cos(a[0]*p)*math.cos(b[0]*p)*math.sin((b[1]-a[1])*p/2)**2
    return 2 * r * math.asin(math.sqrt(h))

groups = collections.defaultdict(list)
for e in raw:
    n = e.get('tags', {}).get('name', '').strip()
    if n:
        groups[n].append(pt(e))

out = []
for name, pts in sorted(groups.items()):
    lat = sum(p[0] for p in pts) / len(pts); lng = sum(p[1] for p in pts) / len(pts)
    st = min(stations, key=lambda s: km((lat, lng), (s['lat'], s['lng'])))
    out.append({'name': name, 'lat': round(lat, 5), 'lng': round(lng, 5),
                'station': st['name'], 'stationKm': round(km((lat, lng), (st['lat'], st['lng'])), 2)})
json.dump(out, open('data/malls.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(out), 'malls;', sum(1 for m in out if m['stationKm'] <= 1), 'within 1 km of an MRT station')
