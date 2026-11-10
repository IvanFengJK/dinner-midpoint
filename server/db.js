import { neon } from '@neondatabase/serverless';
import { HttpError } from './http.js';

let db = null;

// Neon over HTTP: no connection pool to manage in a serverless function.
// Lazy, so importing this module never fails when DATABASE_URL is missing.
export function getDb() {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new HttpError(503, 'The database is not set up yet.');
    const sql = neon(url);
    db = { query: (text, params = []) => sql.query(text, params) };
  }
  return db;
}
