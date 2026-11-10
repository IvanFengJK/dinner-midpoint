import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../transit.js';
import '../ranking.js';

const { Transit, Ranking } = globalThis;

// Small real graph: the shipped one, as tests/client.test.mjs loads it.
const read = (f) => readFileSync(new URL(`../data/${f}`, import.meta.url));
const meta = JSON.parse(read('graph.json'));
const bin = read('graph.bin');
const graph = new Transit.Graph(
  meta,
  bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length),
);
const stations = JSON.parse(read('stations.json'));
const at = (name) => stations.find((s) => s.name === name);
const person = (name, work, home) => ({ name, work: at(work), home: at(home) });

const pair = [person('Ann', 'Bishan', 'Orchard'), person('Bob', 'Jurong East', 'Tampines')];

test('stations are ranked by smallest worst detour, best first', () => {
  const ranked = Ranking.rank({ graph, people: pair, mode: 'stations' });
  assert.deepEqual(
    ranked.slice(0, 3).map((r) => r.s.name),
    ['Bishan', 'Caldecott', 'Marymount'],
  );
  assert.ok(Math.abs(ranked[0].worst - 6.5) < 0.1, `got ${ranked[0].worst}`);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].worst <= ranked[i].worst);
});

test('malls mode ranks malls, stations mode ranks MRT stations', () => {
  const malls = Ranking.rank({ graph, people: pair, mode: 'malls' });
  assert.deepEqual(
    malls.slice(0, 2).map((r) => r.s.name),
    ['Junction 8', 'Plaza Singapura'],
  );
  assert.ok(malls.every((r) => meta.malls.some((m) => m.name === r.s.name)));
  const stops = Ranking.rank({ graph, people: pair, mode: 'stations' });
  assert.ok(stops.every((r) => meta.stations.some((s) => s.name === r.s.name)));
});

test('a detour is never negative: a venue on the route costs nothing extra', () => {
  const solo = [person('Bob', 'Jurong East', 'Tampines')];
  const best = Ranking.rank({ graph, people: solo, mode: 'stations' })[0];
  assert.equal(best.s.name, 'Jurong East');
  assert.equal(best.worst, 0);
  assert.deepEqual(best.detours, [0]);
});

test('someone with no transit nearby is reported by name', () => {
  const nowhere = { name: 'Far', work: { lat: 1.4, lng: 104.1 }, home: at('Orchard') };
  assert.throws(
    () => Ranking.rank({ graph, people: [pair[0], nowhere], mode: 'stations' }),
    (e) => e.message === 'unreachable' && e.who === 'Far',
  );
});
