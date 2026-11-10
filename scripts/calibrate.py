"""Calibration: compare OneMap public-transport times with the straight-line estimate for ~30 station pairs.
Reads ONEMAP_TOKEN from .env (never printed). Writes data/calibration.json."""
import json, math, random, time, urllib.request, urllib.error

env = dict(l.strip().split('=', 1) for l in open('.env') if '=' in l and not l.startswith('#'))
TOKEN = env['ONEMAP_TOKEN']
stations = json.load(open('data/stations.json'))
URL = 'https://www.onemap.gov.sg/api/public/routingsvc/route'

def km(a, b):
    r, p = 6371, math.pi / 180
    h = math.sin((b['lat']-a['lat'])*p/2)**2 + math.cos(a['lat']*p)*math.cos(b['lat']*p)*math.sin((b['lng']-a['lng'])*p/2)**2
    return 2 * r * math.asin(math.sqrt(h))

def route(a, b):
    q = f"{URL}?start={a['lat']},{a['lng']}&end={b['lat']},{b['lng']}&routeType=pt&date=11-12-2026&time=18:00:00&mode=TRANSIT&maxWalkDistance=1000&numItineraries=1"
    for n in range(4):
        try:
            req = urllib.request.Request(q, headers={'Authorization': TOKEN})
            d = json.load(urllib.request.urlopen(req, timeout=30))
            it = (d.get('plan') or {}).get('itineraries')
            return (it[0]['duration'] / 60, it[0].get('transfers', 0)) if it else None
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit(f'AUTH FAILED ({e.code}): token missing/expired')
            time.sleep(2 * 2 ** n)
        except Exception:
            time.sleep(2 * 2 ** n)
    return None

random.seed(1)
pairs = []
while len(pairs) < 30:
    a, b = random.sample(stations, 2)
    if 2 <= km(a, b) <= 25:
        pairs.append((a, b))

rows = []
for a, b in pairs:
    r = route(a, b)
    d = km(a, b)
    rows.append({'from': a['name'], 'to': b['name'], 'km': round(d, 1),
                 'actual_min': None if r is None else round(r[0], 1),
                 'transfers': None if r is None else r[1], 'estimate_min': round(10 + 2.2 * d, 1)})
    time.sleep(1.2)
json.dump(rows, open('data/calibration.json', 'w'), indent=1)

ok = [r for r in rows if r['actual_min'] is not None]
print(f'{len(ok)}/{len(rows)} routes returned')
for r in sorted(ok, key=lambda r: r['km']):
    print(f"{r['km']:5.1f} km  actual {r['actual_min']:5.1f}  est {r['estimate_min']:5.1f}  x{r['actual_min']/r['estimate_min']:.2f}  tr{r['transfers']}  {r['from']} -> {r['to']}")
xs = [r['km'] for r in ok]; ys = [r['actual_min'] for r in ok]
mx, my = sum(xs)/len(xs), sum(ys)/len(ys)
b = sum((x-mx)*(y-my) for x, y in zip(xs, ys)) / sum((x-mx)**2 for x in xs)
a = my - b * mx
res = [y - (a + b*x) for x, y in zip(xs, ys)]
ratios = sorted(r['actual_min']/r['estimate_min'] for r in ok)
print(f'median actual/estimate ratio: {ratios[len(ratios)//2]:.2f}')
print(f'linear fit: minutes = {a:.1f} + {b:.2f} x km   (current: 10 + 2.2 x km)')
print(f'fit residual std: {(sum(e*e for e in res)/len(res))**0.5:.1f} min')
