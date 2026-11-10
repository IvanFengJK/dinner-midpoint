/* Ranks venues (malls or MRT stations) by how fair they are for a group to reach.
   Detour = trip via the venue minus the direct work-to-home trip. No DOM access. */
(function (root) {
  // Under this distance a person can just walk work to home or to a venue.
  const WALK_ONLY_KM = 1.2;

  const walkDirect = (a, b) => {
    const d = root.Transit.distKm(a.lat, a.lng, b.lat, b.lng);
    return d < WALK_ONLY_KM ? root.Transit.walkMin(d) : Infinity;
  };

  // graph: a Transit.Graph. people: [{ name, work: {lat, lng}, home: {lat, lng} }].
  // mode: 'malls' or 'stations'. Returns [{ s, worst, detours, trip, gap }], best first.
  // Throws Error('unreachable') with .who set when one person has no usable transit.
  function rank({ graph: g, people, mode }) {
    const M = g.meta;
    const places =
      mode === 'malls'
        ? M.malls.filter((m) => m.access.length)
        : M.stations.map((s) => ({ ...s, access: [[s.node, 0]] }));
    const per = people.map((p) => {
      const wa = g.access(p.work.lat, p.work.lng),
        ha = g.access(p.home.lat, p.home.lng);
      if (!wa.length || !ha.length) throw Object.assign(new Error('unreachable'), { who: p.name });
      const fwd = g.search(wa, false),
        rev = g.search(ha, true);
      const direct = Math.min(g.reach(fwd, ha), walkDirect(p.work, p.home));
      if (!Number.isFinite(direct)) throw Object.assign(new Error('unreachable'), { who: p.name });
      return { fwd, rev, direct };
    });
    const out = [];
    for (const s of places) {
      const trips = [],
        detours = [];
      for (let i = 0; i < people.length; i++) {
        const q = per[i];
        const to = Math.min(g.reach(q.fwd, s.access), walkDirect(people[i].work, s));
        const from = Math.min(g.reach(q.rev, s.access), walkDirect(s, people[i].home));
        trips.push(to + from);
        detours.push(Math.max(0, to + from - q.direct));
      }
      if (!trips.every(Number.isFinite)) continue;
      const worst = Math.max(...detours);
      out.push({ s, worst, detours, trip: Math.max(...trips), gap: worst - Math.min(...detours) });
    }
    if (!out.length) throw new Error('unreachable');
    return out.sort((a, b) => a.worst - b.worst || a.trip - b.trip);
  }

  root.Ranking = { rank };
})(typeof window !== 'undefined' ? window : globalThis);
