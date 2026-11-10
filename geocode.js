/* Postal code to coordinates through OneMap, with a cache, a parallel-lookup limit and retries.
   fetch and sleep are injected so the logic can be tested without a network or real waiting. */
(function (root) {
  const ONEMAP = 'https://www.onemap.gov.sg/api/common/elastic/search';

  function createGeocoder({ fetch, sleep }) {
    const cache = new Map();

    // Limit parallel lookups: OneMap answers 429 when calls arrive in a burst.
    let active = 0;
    const waiting = [];
    async function limited(fn) {
      if (active >= 2)
        await new Promise((r) => waiting.push(r)); // the slot is handed to us
      else active++;
      try {
        return await fn();
      } finally {
        const next = waiting.shift();
        if (next)
          next(); // pass our slot straight on: active stays the same
        else active--;
      }
    }

    async function fetchOnce(postal) {
      const res = await fetch(
        `${ONEMAP}?searchVal=${postal}&returnGeom=Y&getAddrDetails=Y&pageNum=1`,
      );
      if (!res.ok) throw new Error('busy');
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error('busy');
      }
      if (!Array.isArray(data.results)) throw new Error('busy');
      return data.results[0];
    }

    async function lookup(postal) {
      let hit, err;
      for (let n = 0; n < 5; n++) {
        try {
          hit = await fetchOnce(postal);
          err = null;
          break;
        } catch (e) {
          err = e;
          if (n < 4) await sleep(300 * 2 ** n);
        }
      }
      if (err) throw err;
      if (!hit) throw new Error('not found');
      return { lat: +hit.LATITUDE, lng: +hit.LONGITUDE, label: hit.SEARCHVAL };
    }

    return function geocode(postal) {
      if (!cache.has(postal)) {
        const p = limited(() => lookup(postal));
        cache.set(postal, p);
        p.catch(() => cache.delete(postal)); // only successes are remembered
      }
      return cache.get(postal);
    };
  }

  const api = { createGeocoder };
  root.Geocode = api;
})(typeof window !== 'undefined' ? window : globalThis);
