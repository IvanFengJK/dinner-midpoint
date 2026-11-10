import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../geocode.js';

const { createGeocoder } = globalThis.Geocode;

const HIT = { LATITUDE: '1.3', LONGITUDE: '103.8', SEARCHVAL: 'SOME ROAD' };
const ok = (results) => ({ ok: true, json: async () => ({ results }) });
const noSleep = async () => {};

test('geocode: 10 identical postal codes in one burst make 1 request', async () => {
  let calls = 0;
  const geocode = createGeocoder({
    fetch: async () => (calls++, ok([HIT])),
    sleep: noSleep,
  });
  const pts = await Promise.all(Array.from({ length: 10 }, () => geocode('123456')));
  assert.equal(calls, 1);
  assert.deepEqual(pts[9], { lat: 1.3, lng: 103.8, label: 'SOME ROAD' });
});

test('geocode: "not found" is final and is not retried', async () => {
  let calls = 0;
  const sleeps = [];
  const geocode = createGeocoder({
    fetch: async () => (calls++, ok([])),
    sleep: async (ms) => void sleeps.push(ms),
  });
  await assert.rejects(geocode('000000'), { message: 'not found' });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('geocode: a busy answer is retried with backoff until it succeeds', async () => {
  let calls = 0;
  const sleeps = [];
  const geocode = createGeocoder({
    fetch: async () => (++calls < 3 ? { ok: false } : ok([HIT])),
    sleep: async (ms) => void sleeps.push(ms),
  });
  assert.deepEqual(await geocode('123456'), { lat: 1.3, lng: 103.8, label: 'SOME ROAD' });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [300, 600]);
});

test('geocode: gives up after 5 attempts without sleeping after the last one', async () => {
  let calls = 0;
  const sleeps = [];
  const geocode = createGeocoder({
    fetch: async () => (calls++, { ok: false }),
    sleep: async (ms) => void sleeps.push(ms),
  });
  await assert.rejects(geocode('123456'), { message: 'busy' });
  assert.equal(calls, 5);
  assert.deepEqual(sleeps, [300, 600, 1200, 2400]);
});

// A fetch the test resolves by hand, so lookups stay "in flight" on demand.
function manualFetch() {
  const pending = [];
  let inFlight = 0;
  let max = 0;
  const fn = () =>
    new Promise((resolve) => {
      max = Math.max(max, ++inFlight);
      pending.push(() => {
        inFlight--;
        resolve(ok([HIT]));
      });
    });
  return { fn, pending, max: () => max };
}
const tick = () => new Promise((r) => setImmediate(r));

test('geocode: a burst of different postal codes never runs more than 2 lookups at once', async () => {
  const f = manualFetch();
  const geocode = createGeocoder({ fetch: f.fn, sleep: noSleep });
  const all = Promise.all(['100001', '100002', '100003', '100004', '100005'].map(geocode));
  await tick();
  assert.equal(f.pending.length, 2);
  while (f.pending.length) {
    f.pending.shift()();
    await tick();
  }
  await all;
  assert.equal(f.max(), 2);
});

test('geocode: a call arriving the moment a slot frees up cannot jump the queue', async () => {
  // Microtasks queued just before a lookup finishes run between "slot released" and
  // "queued waiter resumes". Try every hop count so one of them lands in that gap.
  for (let hops = 0; hops < 25; hops++) {
    const f = manualFetch();
    const geocode = createGeocoder({ fetch: f.fn, sleep: noSleep });
    const all = ['100001', '100002', '100003'].map(geocode);
    await tick();
    let late;
    const hop = (n) => (n ? Promise.resolve().then(() => hop(n - 1)) : (late = geocode('100009')));
    f.pending.shift()();
    hop(hops);
    await tick();
    while (f.pending.length) {
      f.pending.shift()();
      await tick();
    }
    await Promise.all([...all, late]);
    assert.equal(f.max(), 2, `more than 2 lookups at once with ${hops} hops`);
  }
});

test('geocode: a failed lookup is not remembered, so trying again asks OneMap again', async () => {
  let calls = 0;
  const geocode = createGeocoder({
    fetch: async () => (++calls <= 5 ? { ok: false } : ok([HIT])),
    sleep: noSleep,
  });
  await assert.rejects(geocode('123456'), { message: 'busy' });
  assert.equal((await geocode('123456')).lat, 1.3);
  assert.equal(calls, 6);
});
