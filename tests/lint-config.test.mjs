import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ESLint } from 'eslint';

const eslint = new ESLint();

async function rulesFired(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId);
}

test('no-var is enforced in .mjs tooling files', async () => {
  assert.ok(
    (await rulesFired('var x = 1;\nexport { x };\n', 'tools/example.mjs')).includes('no-var'),
  );
});

test('eqeqeq is enforced in .mjs test files', async () => {
  assert.ok(
    (await rulesFired('export const f = (a, b) => a == b;\n', 'tests/example.mjs')).includes(
      'eqeqeq',
    ),
  );
});

test('browser globals are undefined in server code', async () => {
  const fired = await rulesFired(
    'export const t = document.title + window.name;\n',
    'server/example.js',
  );
  assert.deepEqual(fired, ['no-undef', 'no-undef']);
});

test('browser globals are undefined in api code', async () => {
  assert.deepEqual(
    await rulesFired('export const t = document.title;\n', 'api/groups/example.js'),
    ['no-undef'],
  );
});

test('browser globals are undefined in tools and tests', async () => {
  assert.deepEqual(await rulesFired('export const t = window.name;\n', 'tools/example.mjs'), [
    'no-undef',
  ]);
  assert.deepEqual(await rulesFired('export const t = window.name;\n', 'tests/example.mjs'), [
    'no-undef',
  ]);
});

test('node globals are defined in server, api, tools and tests', async () => {
  const code = 'export const e = process.env.X + Buffer.from("a").length;\n';
  for (const file of [
    'server/example.js',
    'api/groups/example.js',
    'tools/example.mjs',
    'tests/example.mjs',
  ]) {
    assert.deepEqual(await rulesFired(code, file), [], file);
  }
});

test('node globals are undefined in page scripts', async () => {
  for (const file of ['app.js', 'groups.js', 'transit.js']) {
    assert.deepEqual(
      await rulesFired('const e = process.env.X;\nvoid e;\n', file),
      ['no-undef'],
      file,
    );
  }
});

test('page scripts keep browser globals and the L, Transit, Groups globals', async () => {
  const code = 'const m = L.map(document.body);\nvoid [m, Transit, Groups, window.name];\n';
  assert.deepEqual(await rulesFired(code, 'app.js'), []);
});

function attr(name, path) {
  const out = execFileSync('git', ['check-attr', name, '--', path], { encoding: 'utf8' });
  return out.trim().split(': ').pop();
}

test('text files check out with LF endings', () => {
  for (const file of [
    'app.js',
    'server/app.js',
    'tools/build-site.mjs',
    'index.html',
    'style.css',
  ]) {
    assert.equal(attr('eol', file), 'lf', file);
  }
});

test('binary data and fonts are marked binary', () => {
  for (const file of ['data/graph.bin', 'fonts/atkinson-hyperlegible-next.woff2']) {
    assert.equal(attr('binary', file), 'set', file);
    assert.equal(attr('text', file), 'unset', file);
  }
});
