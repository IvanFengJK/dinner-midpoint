/* Shortest transit times over the prebuilt graph (data/graph.bin + data/graph.json). */
(function (root) {
  const WALK_KMH = 4.5, WALK_CIRC = 1.3;

  function distKm(la1, lo1, la2, lo2) {
    const x = (lo2 - lo1) * Math.cos(((la1 + la2) / 2) * Math.PI / 180), y = la2 - la1;
    return 111.32 * Math.hypot(x, y);
  }
  const walkMin = (d) => (d * WALK_CIRC) / WALK_KMH * 60;

  class MinHeap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v, topK = k[0], topV = v[0], lastK = k.pop(), lastV = v.pop(), n = k.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lastK) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lastK; v[i] = lastV;
      }
      return [topK, topV];
    }
  }

  function Graph(meta, buf) {
    const n = meta.n_nodes, e = meta.n_edges;
    this.meta = meta;
    this.offsets = new Int32Array(buf, 0, n + 1);
    this.targets = new Int32Array(buf, (n + 1) * 4, e);
    this.costs = new Float32Array(buf, (n + 1) * 4 + e * 4, e);
    // reverse graph, so "everything -> home" is one search from home
    const deg = new Int32Array(n + 1);
    for (let i = 0; i < e; i++) deg[this.targets[i] + 1]++;
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    this.roff = deg; this.rtar = new Int32Array(e); this.rcost = new Float32Array(e);
    const fill = deg.slice(0, n);
    for (let u = 0; u < n; u++) for (let j = this.offsets[u]; j < this.offsets[u + 1]; j++) {
      const v = this.targets[j], p = fill[v]++; this.rtar[p] = u; this.rcost[p] = this.costs[j];
    }
  }

  // Walkable nodes near a point: [[node, walkMinutes]]. Falls back to the nearest few within 2 km.
  Graph.prototype.access = function (lat, lng) {
    const { lat: la, lng: lo, n_w } = this.meta, near = [], far = [];
    for (let i = 0; i < n_w; i++) {
      const d = distKm(lat, lng, la[i], lo[i]);
      if (d <= 0.6) near.push([i, walkMin(d), d]); else if (d <= 2) far.push([i, walkMin(d), d]);
    }
    const out = near.length ? near : far.sort((a, b) => a[2] - b[2]).slice(0, 3);
    return out.map(([i, m]) => [i, m]);
  };

  Graph.prototype.search = function (acc, reverse) {
    const n = this.meta.n_nodes, dist = new Float64Array(n).fill(Infinity);
    const off = reverse ? this.roff : this.offsets, tar = reverse ? this.rtar : this.targets, cost = reverse ? this.rcost : this.costs;
    const h = new MinHeap();
    for (const [i, c] of acc) if (c < dist[i]) { dist[i] = c; h.push(c, i); }
    while (h.size) {
      const [c, u] = h.pop();
      if (c > dist[u]) continue;
      for (let j = off[u]; j < off[u + 1]; j++) {
        const v = tar[j], nc = c + cost[j];
        if (nc < dist[v]) { dist[v] = nc; h.push(nc, v); }
      }
    }
    return dist;
  };

  // Minutes from the search origin to a place described by its access list (node, walk minutes).
  Graph.prototype.reach = function (dist, acc) {
    let best = Infinity;
    for (const [i, m] of acc) best = Math.min(best, dist[i] + m);
    return best;
  };

  const api = { Graph, distKm, walkMin };
  if (typeof module !== 'undefined') module.exports = api; else root.Transit = api;
})(typeof window !== 'undefined' ? window : globalThis);
