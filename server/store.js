import { HttpError } from './http.js';
import { hashKey, newGroupId, newKey, newMemberId } from './crypto.js';
import { MAX_MEMBERS, RETENTION_DAYS } from './config.js';

const EXPIRY = `now() + make_interval(days => ${RETENTION_DAYS})`;
const NOT_FOUND = () => new HttpError(404, 'This group has expired or does not exist.');
const FORBIDDEN = () => new HttpError(403, 'You can’t change this.');

const memberParams = (m) => [
  m.name,
  m.work.postal,
  m.work.lat,
  m.work.lng,
  m.home.postal,
  m.home.lat,
  m.home.lng,
];

async function touch(db, groupId) {
  await db.query(
    `UPDATE groups SET last_edit = now(), expires_at = ${EXPIRY} WHERE id = $1::text`,
    [groupId],
  );
}

async function groupIsLive(db, groupId) {
  const rows = await db.query('SELECT 1 FROM groups WHERE id = $1::text AND expires_at > now()', [
    groupId,
  ]);
  return rows.length > 0;
}

// One statement, so the group and its first member are created together or not at all.
export async function createGroup(db, { groupName, member }) {
  const groupId = newGroupId();
  const ownerKey = newKey();
  const memberId = newMemberId();
  const memberKey = newKey();
  await db.query(
    `WITH g AS (
       INSERT INTO groups (id, name, owner_hash, expires_at)
       VALUES ($1::text, $2::text, $3::text, ${EXPIRY})
       RETURNING id
     )
     INSERT INTO members (id, group_id, slot, name, work_postal, work_lat, work_lng,
                          home_postal, home_lat, home_lng, key_hash)
     SELECT $4::text, g.id, 1, $5::text, $6::text, $7::float8, $8::float8,
            $9::text, $10::float8, $11::float8, $12::text
     FROM g`,
    [groupId, groupName, hashKey(ownerKey), memberId, ...memberParams(member), hashKey(memberKey)],
  );
  return { groupId, ownerKey, memberId, memberKey };
}

// Other people's homes are shown on a 0.005-degree grid (about 550 m): Math.round(v * 200) / 200.
const blur = (v) => Math.round(v * 200) / 200;

export async function getGroup(db, groupId, memberKey = null) {
  const groups = await db.query(
    'SELECT id, name, expires_at FROM groups WHERE id = $1::text AND expires_at > now()',
    [groupId],
  );
  if (!groups.length) throw NOT_FOUND();
  const members = await db.query(
    `SELECT id, slot, name, work_postal, work_lat, work_lng, home_postal, home_lat, home_lng, key_hash
     FROM members WHERE group_id = $1::text ORDER BY slot`,
    [groupId],
  );
  const mineHash = memberKey ? hashKey(memberKey) : null;
  return {
    id: groups[0].id,
    name: groups[0].name,
    expiresAt: new Date(groups[0].expires_at).toISOString(),
    maxMembers: MAX_MEMBERS,
    members: members.map((m) => {
      const mine = mineHash !== null && m.key_hash === mineHash;
      const lat = Number(m.home_lat);
      const lng = Number(m.home_lng);
      return {
        id: m.id,
        slot: Number(m.slot),
        name: m.name,
        ...(mine && { mine: true }),
        work: { postal: m.work_postal, lat: Number(m.work_lat), lng: Number(m.work_lng) },
        home: mine ? { postal: m.home_postal, lat, lng } : { lat: blur(lat), lng: blur(lng) },
      };
    }),
  };
}

// The lowest free slot is picked in SQL. UNIQUE (group_id, slot) makes the limit
// race-proof: two people taking the last slot at once cannot both succeed.
export async function addMember(db, groupId, member) {
  const memberId = newMemberId();
  const memberKey = newKey();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = await db.query(
        `INSERT INTO members (id, group_id, slot, name, work_postal, work_lat, work_lng,
                              home_postal, home_lat, home_lng, key_hash)
         SELECT $1::text, g.id, s.slot, $3::text, $4::text, $5::float8, $6::float8,
                $7::text, $8::float8, $9::float8, $10::text
         FROM groups g
         CROSS JOIN LATERAL (
           SELECT min(x) AS slot FROM generate_series(1, ${MAX_MEMBERS}) x
           WHERE x NOT IN (SELECT slot FROM members WHERE group_id = g.id)
         ) s
         WHERE g.id = $2::text AND g.expires_at > now() AND s.slot IS NOT NULL
         RETURNING slot`,
        [memberId, groupId, ...memberParams(member), hashKey(memberKey)],
      );
      if (rows.length) {
        await touch(db, groupId);
        return { memberId, memberKey };
      }
      if (!(await groupIsLive(db, groupId))) throw NOT_FOUND();
      throw new HttpError(409, `This group is full (${MAX_MEMBERS} people).`);
    } catch (err) {
      if (err?.code !== '23505') throw err; // 23505 = someone else took the slot; try again
    }
  }
  throw new HttpError(409, 'The group changed while you were joining. Please try again.');
}

export async function updateMember(db, groupId, memberId, key, member) {
  const rows = await db.query(
    `UPDATE members SET name = $4::text, work_postal = $5::text, work_lat = $6::float8,
            work_lng = $7::float8, home_postal = $8::text, home_lat = $9::float8,
            home_lng = $10::float8, updated_at = now()
     WHERE id = $1::text AND group_id = $2::text AND key_hash = $3::text
       AND EXISTS (SELECT 1 FROM groups WHERE id = $2::text AND expires_at > now())
     RETURNING id`,
    [memberId, groupId, hashKey(key), ...memberParams(member)],
  );
  if (!rows.length) throw (await groupIsLive(db, groupId)) ? FORBIDDEN() : NOT_FOUND();
  await touch(db, groupId);
}

// A member can remove their own entry. The owner can remove any entry.
export async function removeMember(db, groupId, memberId, key) {
  const rows = await db.query(
    `DELETE FROM members m USING groups g
     WHERE m.id = $1::text AND m.group_id = $2::text AND g.id = m.group_id
       AND g.expires_at > now() AND (m.key_hash = $3::text OR g.owner_hash = $3::text)
     RETURNING m.id`,
    [memberId, groupId, hashKey(key)],
  );
  if (!rows.length) throw (await groupIsLive(db, groupId)) ? FORBIDDEN() : NOT_FOUND();
  await touch(db, groupId);
}

export async function deleteGroup(db, groupId, key) {
  const rows = await db.query(
    `DELETE FROM groups WHERE id = $1::text AND owner_hash = $2::text AND expires_at > now()
     RETURNING id`,
    [groupId, hashKey(key)],
  );
  if (!rows.length) throw (await groupIsLive(db, groupId)) ? FORBIDDEN() : NOT_FOUND();
}

export async function cleanup(db) {
  const groups = await db.query('DELETE FROM groups WHERE expires_at <= now() RETURNING id', []);
  const limits = await db.query(
    'DELETE FROM rate_limits WHERE expires_at <= now() RETURNING bucket',
    [],
  );
  return { groups: groups.length, rateLimits: limits.length };
}
