import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

// Remove obsolete branding from current text and preserved project records.
// Copies of edited text are kept outside the project for recovery.
const term = '\u8bcd\u796d';
const root = process.cwd();
const backup = path.resolve(root, '..', 'Game-YGO-backups', '20261009-label-cleanup');
const scan = spawnSync(
  'rg',
  [
    '-l',
    '--hidden',
    '--null',
    term,
    '-g',
    '!node_modules/**',
    '-g',
    '!src/vendor/**',
    '-g',
    '!src/generated/card-shop-glb.js',
    '-g',
    '!*.exe',
    '-g',
    '!*.zip',
    '-g',
    '!*.glb',
    '-g',
    '!*.blend',
    '.',
  ],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);
if (scan.status !== 0 && scan.status !== 1) throw new Error(scan.stderr);
const files = scan.stdout.split('\0').filter(Boolean);
const changed = [];
for (const relative of files) {
  const filename = path.resolve(root, relative);
  const bytes = await fs.readFile(filename);
  // Handle ordinary UTF-8 text without changing line endings or byte-order marks.
  if (bytes.includes(0)) continue;
  const original = bytes.toString('utf8');
  if (!Buffer.from(original).equals(bytes)) continue;
  let text = original
    .replaceAll(`${term} · 决斗档案`, '游戏王开盒模拟器')
    .replaceAll(`游戏王开盒模拟器 · ${term}`, '游戏王开盒模拟器')
    .replaceAll(`*${term}*`, '*游戏王开盒模拟器*')
    .replaceAll(term, '');
  // A decoded URL has the same old label; keep the historical source link valid.
  // No file, asset, test record or binary resource is removed.
  if (text === original) continue;
  const copy = path.join(backup, relative);
  await fs.mkdir(path.dirname(copy), { recursive: true });
  try {
    await fs.writeFile(copy, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await fs.writeFile(filename, text);
  changed.push(relative);
}
await fs.mkdir('test-results/opening-fixes-20261009', { recursive: true });
await fs.writeFile(
  'test-results/opening-fixes-20261009/label-cleanup.json',
  JSON.stringify({ count: changed.length, backup, changed }, null, 2),
);
console.log(
  `Removed obsolete label from ${changed.length} text files; recovery copies are outside the project.`,
);
