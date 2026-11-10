import { HttpError } from './http.js';
import { hashKey } from './crypto.js';

function visitor(request) {
  const xff = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return xff || request.headers.get('x-real-ip') || 'unknown';
}

// Fixed one-hour window per visitor and kind of request. Only a salted hash of
// the address is stored, and the row expires with the window.
export async function limit(db, request, kind, max, salt = process.env.DATABASE_URL || 'dev') {
  const hour = Math.floor(Date.now() / 3_600_000);
  const bucket = `${kind}:${hour}:${hashKey(salt + visitor(request))}`;
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
