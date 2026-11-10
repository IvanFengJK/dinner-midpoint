// In-memory Postgres (pglite) behind the same { query(text, params) -> rows } shape as the
// Neon handle. Used by the tests and by the local dev server. Data is lost on restart.
import { PGlite } from '@electric-sql/pglite';

export async function createMemoryDb() {
  const pg = new PGlite();
  await pg.waitReady;
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows,
    close: () => pg.close(),
  };
}
