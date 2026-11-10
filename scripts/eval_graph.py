import json, sys, time
sys.path.insert(0, 'scripts')
from transit_graph import Topology, travel_minutes
t0 = time.time(); T = Topology(); print(f'topology: {T.n_w} walkable nodes, {T.n_nodes} total, {len(T.edges)} edges, {len(T.walk)} walk links in {time.time()-t0:.1f}s')
print('rail line station counts:', T.rail_gaps)
st = {s['name']: (s['lat'], s['lng']) for s in json.load(open('data/stations.json'))}
cal = json.load(open('data/calibration.json'))
adj = T.build()
errs = []
for r in cal:
    if r['actual_min'] is None: continue
    m = travel_minutes(T, adj, st[r['from']], st[r['to']])
    errs.append((r['actual_min'], m, r))
    print(f"{r['km']:5.1f} km  actual {r['actual_min']:5.1f}  graph {('%5.1f' % m) if m else '  n/a'}  fit {18.1+2.03*r['km']:5.1f}  {r['from']} -> {r['to']}")
ok = [(a, m) for a, m, _ in errs if m]
rm = lambda xs: (sum(x*x for x in xs)/len(xs))**0.5
print('graph  RMSE', round(rm([m-a for a, m in ok]), 1), 'bias', round(sum(m-a for a, m in ok)/len(ok), 1), f'({len(ok)} routes)')
print('fitted RMSE', round(rm([(18.1+2.03*r['km'])-a for a, m, r in errs if m]), 1))
