import { HttpError } from './http.js';
import { createHmac } from 'node:crypto';
import { hashKey } from './crypto.js';

let warnedNoIp = false;

// Only the address Vercel's edge sets is trusted. X-Forwarded-For and X-Real-IP are
// client-controlled elsewhere, so off Vercel everyone shares one bucket.
function visitor(request) {
  if (process.env.VERCEL) {
    const ip = (request.headers.get('x-vercel-forwarded-for') || '').split(',')[0].trim();
    if (ip) return ip;
  }
  if (!warnedNoIp) {
    warnedNoIp = true;
    console.warn('rate limit: no trusted client IP available; using one shared bucket');
  }
  return 'unknown';
}

let warnedNoSalt = false;

// HMAC with a dedicated secret. Until RATE_LIMIT_SALT is set, fall back to the old
// DATABASE_URL-derived value so deploying this change does not break rate limiting.
function hashVisitor(ip) {
  const salt = process.env.RATE_LIMIT_SALT;
  if (salt) return createHmac('sha256', salt).update(ip).digest('hex');
  if (!warnedNoSalt) {
    warnedNoSalt = true;
    console.warn('RATE_LIMIT_SALT is not set; falling back to a DATABASE_URL-derived salt');
  }
  return hashKey((process.env.DATABASE_URL || 'dev') + ip);
}

// Fixed one-hour window per visitor and kind of request. Only a salted hash of
// the address is stored, and the row expires with the window.
export async function limit(db, request, kind, max) {
  return count(db, `${kind}:${hashVisitor(visitor(request))}`, max);
}

// Caps writes to one group across all visitors, so holding the link cannot churn it.
export function limitGroup(db, groupId, max) {
  return count(db, `group:${hashKey(groupId)}`, max);
}

async function count(db, name, max) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const [kind, id] = name.split(':');
  const bucket = `${kind}:${hour}:${id}`;
  const rows = await db.query(
    `INSERT INTO rate_limits (bucket, n, expires_at) VALUES ($1::text, 1, now() + interval '2 hours')
     ON CONFLICT (bucket) DO UPDATE SET n = rate_limits.n + 1
     RETURNING n`,
    [bucket],
  );
  if (Number(rows[0].n) > max) {
    throw new HttpError(429, 'Too many requests. Please try again later.');
  }
}
