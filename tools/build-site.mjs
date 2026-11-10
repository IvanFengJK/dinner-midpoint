import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PUBLISHED_FILES, EXTRA_FILES } from './allowlist.mjs';

const OUT = '_site';

await rm(OUT, { recursive: true, force: true });
for (const file of PUBLISHED_FILES) {
  await access(file).catch(() => {
    console.error(`build: allowlisted file is missing: ${file}`);
    process.exit(1);
  });
  await mkdir(join(OUT, dirname(file)), { recursive: true });
  await cp(file, join(OUT, file));
}
for (const file of EXTRA_FILES) await writeFile(join(OUT, file), '');

console.log(`build: wrote ${PUBLISHED_FILES.length} files to ${OUT}/`);
