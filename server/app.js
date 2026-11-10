import { HttpError, json, readJson } from './http.js';
import { GROUP_ID_RE, KEY_RE, MEMBER_ID_RE } from './crypto.js';
import { cleanGroupCreate, cleanMember } from './validate.js';
import { ensureSchema } from './schema.js';
import { limit } from './ratelimit.js';
import { LIMITS } from './config.js';
import { getDb } from './db.js';
import * as store from './store.js';

const SEG = '([A-Za-z0-9_-]+)';
const ROUTES = [
  { re: /^\/api\/groups\/?$/, name: 'groups' },
  { re: new RegExp(`^/api/groups/${SEG}/?$`), name: 'group' },
  { re: new RegExp(`^/api/groups/${SEG}/members/?$`), name: 'members' },
  { re: new RegExp(`^/api/groups/${SEG}/members/${SEG}/?$`), name: 'member' },
];

function match(pathname) {
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (m) return { name: r.name, groupId: m[1], memberId: m[2] };
  }
  return null;
}

function secret(request) {
  const key = request.headers.get('x-key') || '';
  if (!KEY_RE.test(key)) throw new HttpError(403, 'You can’t change this.');
  return key;
}

function ids(route) {
  // Malformed ids can never exist, so skip the database entirely.
  if (route.groupId && !GROUP_ID_RE.test(route.groupId)) {
    throw new HttpError(404, 'This group has expired or does not exist.');
  }
  if (route.memberId && !MEMBER_ID_RE.test(route.memberId)) {
    throw new HttpError(404, 'That entry does not exist.');
  }
}

async function dispatch(request, db) {
  const route = match(new URL(request.url).pathname);
  if (!route) throw new HttpError(404, 'Not found.');
  ids(route);
  const { method } = request;
  const allowed = {
    groups: ['POST'],
    group: ['GET', 'DELETE'],
    members: ['POST'],
    member: ['PUT', 'DELETE'],
  }[route.name];
  if (!allowed.includes(method)) {
    throw Object.assign(new HttpError(405, 'Method not allowed.'), { allow: allowed.join(', ') });
  }

  if (route.name === 'groups') {
    await limit(db, request, 'create', LIMITS.create);
    const created = await store.createGroup(db, cleanGroupCreate(await readJson(request)));
    return json(201, created);
  }
  if (route.name === 'group' && method === 'GET') {
    await limit(db, request, 'read', LIMITS.read);
    return json(200, await store.getGroup(db, route.groupId));
  }
  await limit(db, request, 'write', LIMITS.write);
  if (route.name === 'group') {
    await store.deleteGroup(db, route.groupId, secret(request));
    return json(200, { ok: true });
  }
  if (route.name === 'members') {
    const added = await store.addMember(db, route.groupId, cleanMember(await readJson(request)));
    return json(201, added);
  }
  if (method === 'PUT') {
    const member = cleanMember(await readJson(request));
    await store.updateMember(db, route.groupId, route.memberId, secret(request), member);
    return json(200, { ok: true });
  }
  await store.removeMember(db, route.groupId, route.memberId, secret(request));
  return json(200, { ok: true });
}

function fail(err) {
  if (err instanceof HttpError) {
    return json(
      err.status,
      { error: err.message, field: err.field },
      err.allow ? { allow: err.allow } : {},
    );
  }
  console.error(err);
  return json(500, { error: 'Something went wrong. Please try again.' });
}

export async function handle(request, deps = {}) {
  try {
    const db = deps.db ?? getDb();
    await ensureSchema(db);
    return await dispatch(request, db);
  } catch (err) {
    return fail(err);
  }
}

// Daily clean-up of expired groups. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export async function handleCleanup(request, deps = {}) {
  try {
    const expected = process.env.CRON_SECRET;
    if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
      throw new HttpError(401, 'Unauthorized.');
    }
    const db = deps.db ?? getDb();
    await ensureSchema(db);
    return json(200, await store.cleanup(db));
  } catch (err) {
    return fail(err);
  }
}
