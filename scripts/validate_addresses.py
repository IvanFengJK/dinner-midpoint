"""Held-out check: random bus stop -> random mall (ordinary points, not stations). OneMap vs graph vs fitted formula."""
import json, random, sys, time, urllib.request, urllib.error
sys.path.insert(0, 'scripts')
from transit_graph import Topology, travel_minutes, dist_km
env = dict(l.strip().split('=', 1) for l in open('.env') if '=' in l and not l.startswith('#'))
TOKEN = env['ONEMAP_TOKEN']
URL = 'https://www.onemap.gov.sg/api/public/routingsvc/route'
T = Topology(); adj = T.build()
malls = json.load(open('data/malls.json'))
random.seed(7)
pairs = []
while len(pairs) < 30:
    i = random.randrange(T.n_bus_stops); m = random.choice(malls)
    d = dist_km(T.lat[i], T.lng[i], m['lat'], m['lng'])
    if 2 <= d <= 25: pairs.append(((T.lat[i], T.lng[i], T.names[i]), m, d))

def route(a, b):
    q = f"{URL}?start={a[0]},{a[1]}&end={b['lat']},{b['lng']}&routeType=pt&date=11-12-2026&time=18:00:00&mode=TRANSIT&maxWalkDistance=1000&numItineraries=1"
    for n in range(4):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(q, headers={'Authorization': TOKEN}), timeout=30))
            it = (d.get('plan') or {}).get('itineraries')
            return it[0]['duration'] / 60 if it else None
        except urllib.error.HTTPError as e:
            if e.code in (401, 403): raise SystemExit('AUTH FAILED')
            time.sleep(2 * 2 ** n)
        except Exception:
            time.sleep(2 * 2 ** n)

rows = []
for a, m, d in pairs:
    act = route(a, m); time.sleep(1.2)
    g = travel_minutes(T, adj, (a[0], a[1]), (m['lat'], m['lng']))
    rows.append({'from': a[2], 'to': m['name'], 'km': round(d, 1), 'actual': None if act is None else round(act, 1),
                 'graph': None if g is None else round(g, 1), 'fit': round(18.1 + 2.03 * d, 1)})
json.dump(rows, open('data/calibration2.json', 'w'), indent=1)
ok = [r for r in rows if r['actual'] and r['graph']]
for r in sorted(ok, key=lambda r: r['km']): print(f"{r['km']:5.1f} km actual {r['actual']:5.1f} graph {r['graph']:5.1f} fit {r['fit']:5.1f}  {r['from']} -> {r['to']}")
rm = lambda xs: (sum(x*x for x in xs)/len(xs))**0.5
print(f'{len(ok)}/{len(rows)} usable | graph RMSE {rm([r["graph"]-r["actual"] for r in ok]):.1f} bias {sum(r["graph"]-r["actual"] for r in ok)/len(ok):+.1f} | fitted RMSE {rm([r["fit"]-r["actual"] for r in ok]):.1f}')
