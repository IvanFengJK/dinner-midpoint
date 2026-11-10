// Pre-deploy gate: inspects the built _site/ directory and exits non-zero if
// it is unsafe or broken to publish. Prints file names only, never file content.
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { PUBLISHED_FILES, EXTRA_FILES } from './allowlist.mjs';

const root = process.argv[2] ?? '_site';
const MAX_BYTES = 10 * 1024 * 1024; // sanity budget; Pages itself allows far more
const errors = [];
const fail = (msg) => errors.push(msg);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = (await walk(root)).map((p) => relative(root, p).split('\\').join('/'));

// 1. Only allowlisted files may be present.
const allowed = new Set([...PUBLISHED_FILES, ...EXTRA_FILES]);
for (const f of files) if (!allowed.has(f)) fail(`unexpected file in artifact: ${f}`);
for (const f of PUBLISHED_FILES) if (!files.includes(f)) fail(`missing from artifact: ${f}`);

// 2. Size budget.
let total = 0;
for (const f of files) total += (await stat(join(root, f))).size;
if (total > MAX_BYTES) fail(`artifact is ${(total / 1e6).toFixed(1)} MB, over the ${MAX_BYTES / 1e6} MB budget`);

// 3. No secrets in text files.
const TEXT = /\.(html|js|css|json|svg|txt|md)$/;
const secretPatterns = [
  [/ONEMAP_TOKEN/, 'mentions ONEMAP_TOKEN'],
  [/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/, 'contains a JWT-shaped string'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'contains a private key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'contains a GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'contains an AWS access key id'],
];
// Also look for the real local token value, if there is one (local runs only).
const exact = [];
if (process.env.ONEMAP_TOKEN) exact.push(process.env.ONEMAP_TOKEN);
if (existsSync('.env')) {
  const m = (await readFile('.env', 'utf8')).match(/^ONEMAP_TOKEN=(.+)$/m);
  if (m?.[1].trim()) exact.push(m[1].trim());
}
for (const f of files.filter((f) => TEXT.test(f))) {
  const body = await readFile(join(root, f), 'utf8');
  for (const [re, why] of secretPatterns) if (re.test(body)) fail(`${f} ${why}`);
  if (exact.some((v) => body.includes(v))) fail(`${f} contains the real ONEMAP_TOKEN value`);
}

// 4. Every local reference must resolve inside the artifact.
const refs = []; // [fromFile, ref]
const isLocal = (r) => r && !/^([a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(r);
const grab = (from, body, re) => {
  for (const m of body.matchAll(re)) if (isLocal(m[1])) refs.push([from, m[1]]);
};
for (const f of files) {
  if (!TEXT.test(f)) continue;
  const body = await readFile(join(root, f), 'utf8');
  if (f.endsWith('.html')) grab(f, body, /\b(?:src|href)=["']([^"']+)["']/g);
  if (f.endsWith('.css')) grab(f, body, /url\(\s*["']?([^"')]+)["']?\s*\)/g);
  if (f.endsWith('.js')) grab(f, body, /\bfetch\(\s*["'`]([^"'`$]+)["'`]/g);
}
for (const [from, ref] of refs) {
  const clean = ref.split(/[?#]/)[0];
  const target = posix.normalize(posix.join(dirname(from), clean));
  if (!files.includes(target)) fail(`${from} references ${ref}, which is not in the artifact`);
}

if (errors.length) {
  console.error(`check-site: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-site: OK (${files.length} files, ${(total / 1e6).toFixed(2)} MB, ${refs.length} references resolved)`);
