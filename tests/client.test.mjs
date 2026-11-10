import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../groups.js';
import '../transit.js';

const { Groups, Transit } = globalThis;
const ID = 'A'.repeat(22);
const KEY = 'b'.repeat(22);
const MID = 'c'.repeat(11);

test('group links parse, and junk is ignored', () => {
  assert.deepEqual(Groups.parseHash(`#g=${ID}`), { id: ID });
  assert.deepEqual(Groups.parseHash(`#g=${ID}&m=${MID}.${KEY}`), {
    id: ID,
    memberId: MID,
    memberKey: KEY,
  });
  assert.deepEqual(Groups.parseHash(`#g=${ID}&o=${KEY}`), { id: ID, ownerKey: KEY });
  assert.equal(Groups.parseHash(''), null);
  assert.equal(Groups.parseHash('#g=short'), null);
  assert.equal(Groups.parseHash(`#g=${ID}x`), null);
  assert.deepEqual(Groups.parseHash(`#g=${ID}&m=bad&o=bad`), { id: ID });
});

test('links are built from the saved keys', () => {
  const base = 'https://example.com/';
  assert.deepEqual(Groups.links(base, ID, {}), {
    group: `${base}#g=${ID}`,
    personal: null,
    owner: null,
  });
  const all = Groups.links(base, ID, { memberId: MID, memberKey: KEY, ownerKey: KEY });
  assert.equal(all.personal, `${base}#g=${ID}&m=${MID}.${KEY}`);
  assert.equal(all.owner, `${base}#g=${ID}&o=${KEY}`);
  // What a link carries must parse back to the same keys.
  assert.deepEqual(Groups.parseHash(new URL(all.personal).hash), {
    id: ID,
    memberId: MID,
    memberKey: KEY,
  });
});

test('saved keys work without localStorage and can be forgotten', () => {
  assert.deepEqual(Groups.creds(ID), {});
  Groups.save(ID, { memberId: MID, memberKey: KEY });
  Groups.save(ID, { ownerKey: KEY });
  assert.deepEqual(Groups.creds(ID), { memberId: MID, memberKey: KEY, ownerKey: KEY });
  Groups.forget(ID, 'memberId', 'memberKey');
  assert.deepEqual(Groups.creds(ID), { ownerKey: KEY });
  Groups.forget(ID);
  assert.deepEqual(Groups.creds(ID), {});
});

test('API errors carry the status and field; network failures have status 0', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Postal codes have 6 digits.', field: 'work' }),
    });
    await assert.rejects(
      Groups.request('POST', ''),
      (e) => e.status === 400 && e.field === 'work' && /6 digits/.test(e.message),
    );
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('html');
      },
    });
    await assert.rejects(Groups.request('GET', `/${ID}`), (e) => e.status === 502);
    globalThis.fetch = async () => {
      throw new TypeError('offline');
    };
    await assert.rejects(Groups.request('GET', `/${ID}`), (e) => e.status === 0);
  } finally {
    globalThis.fetch = real;
  }
});

// ---- transit search (loads the shipped graph) ----
const meta = JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url)));
const bin = readFileSync(new URL('../data/graph.bin', import.meta.url));
const graph = new Transit.Graph(
  meta,
  bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length),
);
const stations = JSON.parse(readFileSync(new URL('../data/stations.json', import.meta.url)));
const at = (name) => stations.find((s) => s.name === name);

function minutes(a, b) {
  const fwd = graph.search(graph.access(a.lat, a.lng), false);
  return graph.reach(fwd, graph.access(b.lat, b.lng));
}

test('the graph agrees with OneMap on a known trip within a sensible band', () => {
  // OneMap said 23.4 min for Great World -> Lavender at 6pm (data/calibration.json).
  const t = minutes(at('Great World'), at('Lavender'));
  assert.ok(t > 15 && t < 32, `got ${t.toFixed(1)}`);
});

test('travel times are positive, finite and roughly symmetric', () => {
  const a = at('Bishan'),
    b = at('Orchard');
  const ab = minutes(a, b),
    ba = minutes(b, a);
  assert.ok(Number.isFinite(ab) && ab > 5);
  assert.ok(Math.abs(ab - ba) < 8, `${ab.toFixed(1)} vs ${ba.toFixed(1)}`);
});

test('walking time and distance helpers', () => {
  assert.ok(Math.abs(Transit.walkMin(1) - 17.33) < 0.1);
  assert.ok(Math.abs(Transit.distKm(1.3, 103.8, 1.3, 103.9) - 11.1) < 0.3);
});
