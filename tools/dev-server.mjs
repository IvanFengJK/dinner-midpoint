// Local preview: serves the published files and the /api routes, backed by an in-memory
// Postgres (data is lost when you stop it). Run with: npm run dev
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { handle } from '../server/app.js';
import { createMemoryDb } from './memory-db.mjs';
import { PUBLISHED_FILES } from './allowlist.mjs';

// Same security headers as production (vercel.json), so a too-strict policy shows up locally.
const vercelConfig = JSON.parse(
  await readFile(join(import.meta.dirname, '..', 'vercel.json'), 'utf8'),
);
const siteHeaders = Object.fromEntries(
  (vercelConfig.headers ?? []).flatMap((h) =>
    h.headers.map(({ key, value }) => [key.toLowerCase(), value]),
  ),
);

// The limiter only trusts the address Vercel's edge sets. Locally this server plays that edge.
process.env.VERCEL ||= '1';

const port = Number(process.env.PORT ?? 8765);
const db = await createMemoryDb();
const published = new Set(PUBLISHED_FILES);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const request = new Request(url, {
        method: req.method,
        headers: { ...req.headers, 'x-vercel-forwarded-for': req.socket.remoteAddress ?? '' },
        body: hasBody ? await body(req) : undefined,
      });
      const out = await handle(request, { db });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!published.has(file)) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      ...siteHeaders,
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(await readFile(join(import.meta.dirname, '..', file)));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Server error');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Where To Eat Ah? running at http://localhost:${port} (in-memory database)`);
});
