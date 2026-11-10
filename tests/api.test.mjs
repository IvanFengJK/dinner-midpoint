import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../tools/memory-db.mjs';
import { handle, handleCleanup } from '../server/app.js';
import { MAX_MEMBERS, GROUP_WRITES_PER_HOUR } from '../server/config.js';

// Production identifies visitors by the header Vercel's edge sets. Tests act as that edge.
process.env.VERCEL = '1';

let db;
before(async () => {
  db = await createMemoryDb();
});
after(() => db.close());

let ipCounter = 0;
async function call(method, path, { body, key, ip, headers = {} } = {}) {
  const h = {
    'x-vercel-forwarded-for': ip ?? `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`,
    ...headers,
  };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (key) h['x-key'] = key;
  const res = await handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { db },
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const place = (postal = '238801', lat = 1.3, lng = 103.8) => ({ postal, lat, lng });
const entry = (name = 'Ann') => ({
  name,
  work: place('238801'),
  home: place('558762', 1.36, 103.86),
});
const create = (extra = {}) =>
  call('POST', '/api/groups', { body: { groupName: 'Dinner', ...entry(), ...extra } });

test('creating a group returns secrets once and the group is readable', async () => {
  const { status, body } = await create();
  assert.equal(status, 201);
  assert.match(body.groupId, /^[\w-]{22}$/);
  for (const k of ['ownerKey', 'memberId', 'memberKey']) assert.ok(body[k]);

  const got = await call('GET', `/api/groups/${body.groupId}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.name, 'Dinner');
  assert.equal(got.body.members.length, 1);
  assert.equal(got.body.members[0].work.postal, '238801');
  assert.equal(got.headers.get('cache-control'), 'no-store');
  const text = JSON.stringify(got.body);
  assert.ok(!text.includes(body.ownerKey) && !text.includes(body.memberKey), 'no secrets in GET');
  assert.ok(!/hash/i.test(text));
});

test('an unknown or malformed group id is a 404', async () => {
  assert.equal((await call('GET', '/api/groups/' + 'a'.repeat(22))).status, 404);
  assert.equal((await call('GET', '/api/groups/short')).status, 404);
});

test('anyone with the link can join, and only the owner key deletes the group', async () => {
  const g = (await create()).body;
  const joined = await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Bob') });
  assert.equal(joined.status, 201);
  assert.equal((await call('GET', `/api/groups/${g.groupId}`)).body.members.length, 2);

  const nope = await call('DELETE', `/api/groups/${g.groupId}`, { key: joined.body.memberKey });
  assert.equal(nope.status, 403);
  const noKey = await call('DELETE', `/api/groups/${g.groupId}`);
  assert.equal(noKey.status, 403);
  assert.equal((await call('DELETE', `/api/groups/${g.groupId}`, { key: g.ownerKey })).status, 200);
  assert.equal((await call('GET', `/api/groups/${g.groupId}`)).status, 404);
});

test('members edit and remove only their own entry; the owner can remove but not edit others', async () => {
  const g = (await create()).body;
  const bob = (await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Bob') })).body;
  const cat = (await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Cat') })).body;
  const url = (m) => `/api/groups/${g.groupId}/members/${m.memberId}`;

  assert.equal(
    (await call('PUT', url(bob), { key: bob.memberKey, body: entry('Bobby') })).status,
    200,
  );
  const names = (await call('GET', `/api/groups/${g.groupId}`)).body.members.map((m) => m.name);
  assert.deepEqual(names, ['Ann', 'Bobby', 'Cat']);

  // Cat cannot edit or remove Bob; the owner cannot edit Bob.
  assert.equal((await call('PUT', url(bob), { key: cat.memberKey, body: entry('X') })).status, 403);
  assert.equal((await call('DELETE', url(bob), { key: cat.memberKey })).status, 403);
  assert.equal((await call('PUT', url(bob), { key: g.ownerKey, body: entry('X') })).status, 403);
  // Bob removes himself; the owner removes Cat.
  assert.equal((await call('DELETE', url(bob), { key: bob.memberKey })).status, 200);
  assert.equal((await call('DELETE', url(cat), { key: g.ownerKey })).status, 200);
  assert.equal((await call('GET', `/api/groups/${g.groupId}`)).body.members.length, 1);
});

test(`a group holds at most ${MAX_MEMBERS} people, even when they join at once`, async () => {
  const g = (await create()).body;
  const results = await Promise.all(
    Array.from({ length: 14 }, (_, i) =>
      call('POST', `/api/groups/${g.groupId}/members`, { body: entry(`P${i}`) }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, MAX_MEMBERS - 1);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
  const got = (await call('GET', `/api/groups/${g.groupId}`)).body.members;
  assert.equal(got.length, MAX_MEMBERS);
  assert.deepEqual(
    got.map((m) => m.slot),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test('a freed slot is reused', async () => {
  const g = (await create()).body;
  const bob = (await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Bob') })).body;
  await call('DELETE', `/api/groups/${g.groupId}/members/${bob.memberId}`, { key: bob.memberKey });
  await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Cat') });
  const slots = (await call('GET', `/api/groups/${g.groupId}`)).body.members.map((m) => m.slot);
  assert.deepEqual(slots, [1, 2]);
});

test('input is validated', async () => {
  const bad = async (patch, field) => {
    const r = await create(patch);
    assert.equal(r.status, 400, JSON.stringify(patch));
    if (field) assert.equal(r.body.field, field);
  };
  await bad({ name: '' }, 'name');
  await bad({ name: 'x'.repeat(31) }, 'name');
  await bad({ name: 'bad\u0007name' }, 'name');
  await bad({ groupName: '   ' }, 'groupName');
  await bad({ work: place('12345') }, 'work');
  await bad({ work: place('12345a') }, 'work');
  await bad({ home: place('558762', 51.5, -0.12) }, 'home'); // London
  await bad({ home: { postal: '558762', lat: 'x', lng: 103.8 } }, 'home');
  await bad({ work: undefined }, 'work');
});

test('only JSON is accepted, and oversized bodies are refused', async () => {
  const r = await handle(
    new Request('http://localhost/api/groups', {
      method: 'POST',
      body: 'hi',
      headers: { 'content-type': 'text/plain' },
    }),
    { db },
  );
  assert.equal(r.status, 415);
  const big = await call('POST', '/api/groups', {
    body: { groupName: 'x'.repeat(5000), ...entry() },
  });
  assert.equal(big.status, 413);
});

test('wrong methods are refused', async () => {
  const r = await call('PUT', '/api/groups');
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'POST');
});

test('expired groups disappear and the clean-up removes them', async () => {
  const g = (await create()).body;
  await db.query("UPDATE groups SET expires_at = now() - interval '1 minute' WHERE id = $1", [
    g.groupId,
  ]);
  assert.equal((await call('GET', `/api/groups/${g.groupId}`)).status, 404);
  assert.equal(
    (await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Late') })).status,
    404,
  );

  process.env.CRON_SECRET = 'test-secret';
  const run = (auth) =>
    handleCleanup(
      new Request('http://localhost/api/cron/cleanup', {
        headers: auth ? { authorization: auth } : {},
      }),
      { db },
    );
  assert.equal((await run()).status, 401);
  assert.equal((await run('Bearer wrong')).status, 401);
  const ok = await run('Bearer test-secret');
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).groups >= 1);
  assert.equal((await db.query('SELECT 1 FROM groups WHERE id = $1', [g.groupId])).length, 0);
  delete process.env.CRON_SECRET;
});

test('every change pushes the expiry out by 7 days', async () => {
  const g = (await create()).body;
  await db.query("UPDATE groups SET expires_at = now() + interval '1 hour' WHERE id = $1", [
    g.groupId,
  ]);
  await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Bob') });
  const [row] = await db.query(
    "SELECT expires_at > now() + interval '6 days' AS ok FROM groups WHERE id = $1",
    [g.groupId],
  );
  assert.equal(row.ok, true);
});

test('group creation is rate limited per visitor', async () => {
  const ip = '203.0.113.9';
  const codes = [];
  for (let i = 0; i < 12; i++) {
    codes.push(
      (await call('POST', '/api/groups', { ip, body: { groupName: 'G', ...entry() } })).status,
    );
  }
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(201));
  assert.deepEqual(codes.slice(10), [429, 429]);
  // A different visitor is unaffected.
  assert.equal((await create()).status, 201);
});

test('the database stores only hashes of the keys', async () => {
  const g = (await create()).body;
  const rows = await db.query(
    'SELECT g.owner_hash, m.key_hash FROM groups g JOIN members m ON m.group_id = g.id WHERE g.id = $1',
    [g.groupId],
  );
  assert.notEqual(rows[0].owner_hash, g.ownerKey);
  assert.notEqual(rows[0].key_hash, g.memberKey);
  assert.match(rows[0].owner_hash, /^[0-9a-f]{64}$/);
});

test('a group accepts a limited number of writes per hour, from any visitor', async () => {
  const g = (await create()).body;
  const other = (await create()).body;
  const path = `/api/groups/${g.groupId}/members`;
  const bob = (await call('POST', path, { body: entry('Bob') })).body;
  const edit = () =>
    call('PUT', `${path}/${bob.memberId}`, { key: bob.memberKey, body: entry('Bobby') });
  // The add above was write 1; every call uses a new visitor, so only the group cap can stop them.
  for (let i = 2; i <= GROUP_WRITES_PER_HOUR; i++) assert.equal((await edit()).status, 200);
  const over = await edit();
  assert.equal(over.status, 429);
  assert.equal(
    (await call('GET', `/api/groups/${g.groupId}`)).status,
    200,
    'reads are not counted',
  );
  assert.equal(
    (await call('POST', `/api/groups/${other.groupId}/members`, { body: entry() })).status,
    201,
  );
});

test('editing late in a group’s life never pushes expiry past 30 days from creation', async () => {
  const g = (await create()).body;
  await db.query(
    "UPDATE groups SET created_at = now() - interval '29 days', expires_at = now() + interval '1 hour' WHERE id = $1",
    [g.groupId],
  );
  await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Bob') });
  const [row] = await db.query(
    "SELECT expires_at <= created_at + interval '30 days' AS capped, expires_at > now() + interval '23 hours' AS extended FROM groups WHERE id = $1",
    [g.groupId],
  );
  assert.equal(row.capped, true);
  assert.equal(row.extended, true, 'still pushed forward, up to the cap');
});

test('a group older than 30 days is gone and the clean-up removes it, however much it was edited', async () => {
  const g = (await create()).body;
  await db.query(
    "UPDATE groups SET created_at = now() - interval '31 days', expires_at = now() + interval '5 days' WHERE id = $1",
    [g.groupId],
  );
  assert.equal((await call('GET', `/api/groups/${g.groupId}`)).status, 404);
  const join = await call('POST', `/api/groups/${g.groupId}/members`, { body: entry('Bob') });
  assert.equal(join.status, 404);
  process.env.CRON_SECRET = 'cron-secret';
  const res = await handleCleanup(
    new Request('http://localhost/api/cron/cleanup', {
      headers: { authorization: 'Bearer cron-secret' },
    }),
    { db },
  );
  assert.equal(res.status, 200);
  const rows = await db.query('SELECT 1 FROM groups WHERE id = $1', [g.groupId]);
  assert.equal(rows.length, 0);
});

// Sends group-creation requests with exactly the given headers; returns the status codes.
async function createMany(n, headersFor) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const res = await handle(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headersFor(i) },
        body: JSON.stringify({ groupName: 'G', ...entry() }),
      }),
      { db },
    );
    codes.push(res.status);
  }
  return codes;
}

test('on Vercel the visitor is the edge-set address; a spoofed X-Forwarded-For buys nothing', async () => {
  const codes = await createMany(12, (i) => ({
    'x-vercel-forwarded-for': '198.51.100.7, 10.0.0.1',
    'x-forwarded-for': `203.0.113.${i}`,
  }));
  assert.deepEqual(codes.slice(10), [429, 429]);
});

test('off Vercel, forwarded headers are ignored, so spoofing cannot buy extra requests', async () => {
  delete process.env.VERCEL;
  try {
    const codes = await createMany(12, (i) => ({
      'x-forwarded-for': `203.0.114.${i}`,
      'x-real-ip': `203.0.115.${i}`,
      'x-vercel-forwarded-for': `203.0.116.${i}`,
    }));
    assert.deepEqual(codes.slice(10), [429, 429]);
  } finally {
    process.env.VERCEL = '1';
  }
});

test('the clean-up accepts only the exact cron secret, whatever the length of a wrong one', async () => {
  process.env.CRON_SECRET = 'cron-secret';
  const run = async (authorization) =>
    (
      await handleCleanup(
        new Request('http://localhost/api/cron/cleanup', {
          headers: authorization === undefined ? {} : { authorization },
        }),
        { db },
      )
    ).status;
  assert.equal(await run(undefined), 401);
  assert.equal(await run('Bearer '), 401);
  assert.equal(await run('Bearer cron-secre'), 401);
  assert.equal(await run('Bearer cron-secret-and-much-more' + 'x'.repeat(5000)), 401);
  assert.equal(await run('cron-secret'), 401);
  assert.equal(await run('Bearer cron-secret'), 200);
});

test('rate-limit counts are keyed by RATE_LIMIT_SALT, so a new salt starts a fresh count', async () => {
  const headers = () => ({ 'x-vercel-forwarded-for': '198.51.100.99' });
  const before = process.env.RATE_LIMIT_SALT;
  process.env.RATE_LIMIT_SALT = 'salt-one';
  try {
    const first = await createMany(11, headers);
    assert.equal(first[10], 429);
    process.env.RATE_LIMIT_SALT = 'salt-two';
    assert.deepEqual(await createMany(1, headers), [201]);
  } finally {
    if (before === undefined) delete process.env.RATE_LIMIT_SALT;
    else process.env.RATE_LIMIT_SALT = before;
  }
});

const post = (body, headers = {}, init = {}) =>
  handle(
    new Request('http://localhost/api/groups', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vercel-forwarded-for': '192.0.2.50',
        ...headers,
      },
      body,
      ...init,
    }),
    { db },
  );

test('body size is counted in bytes: 1500 euro signs is 4500 bytes and is refused', async () => {
  const body = JSON.stringify({ groupName: '€'.repeat(1500), ...entry() });
  const res = await post(body, { 'content-length': String(new TextEncoder().encode(body).length) });
  assert.equal(res.status, 413);
  assert.equal((await post(body)).status, 413, 'also when no content-length is sent');
});

test('an oversized content-length is refused without reading the body', async () => {
  let pulled = 0;
  const stream = new ReadableStream(
    {
      pull(controller) {
        pulled++;
        if (pulled > 3) return controller.close();
        controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
      },
    },
    { highWaterMark: 0 },
  );
  const res = await post(stream, { 'content-length': '1000000' }, { duplex: 'half' });
  assert.equal(res.status, 413);
  assert.equal(pulled, 0);
});

test('without content-length the body is read only up to the cap', async () => {
  let pulled = 0;
  const stream = new ReadableStream(
    {
      pull(controller) {
        pulled++;
        if (pulled > 1000) return controller.close();
        controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
      },
    },
    { highWaterMark: 0 },
  );
  const res = await post(stream, {}, { duplex: 'half' });
  assert.equal(res.status, 413);
  assert.ok(pulled <= 6, `read ${pulled} chunks of 1000 bytes`);
});
