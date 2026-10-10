import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const root = path.resolve(process.argv[2] || '');
assert.match(path.basename(root), /^\.app-stage-[a-f0-9]{32}$/);
assert.equal(path.basename(path.dirname(root)), 'resources');
const output = path.resolve('test-results/player-size-lossless-20261010');
const cache = path.join(output, 'cache');
await fs.mkdir(cache, { recursive: true });
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const relative = (file) => path.relative(root, file).replaceAll('\\', '/');
const inside = (file) => assert.ok(path.resolve(file).startsWith(root + path.sep));
async function walk(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(file)));
    else result.push(file);
  }
  return result.sort();
}
const assets = (await walk(path.join(root, 'public'))).filter((file) =>
  /\.(png|jpg|webp)$/.test(file),
);
const names = new Map();
for (const file of assets)
  names.set(path.basename(file), (names.get(path.basename(file)) || 0) + 1);
const aliases = new Map();
const duplicates = [];
const duplicateBytes = 0;
// ASAR already shares offsets for identical files. Preserve every asset name.
const converted = [];
const retained = [];
let imageBytes = 0;
for (const file of (await walk(path.join(root, 'public'))).filter((file) =>
  file.endsWith('.png'),
)) {
  // Keep the original favicon format; native Windows icons use a separate ICO.
  if (relative(file) === 'public/assets/theme-icon.png') {
    retained.push({ file: relative(file), reason: 'original favicon' });
    continue;
  }
  if (names.get(path.basename(file)) !== 1) continue;
  const source = await fs.readFile(file);
  const sourceHash = hash(source);
  const cached = path.join(cache, `${sourceHash}.webp`);
  let optimized;
  try {
    optimized = await fs.readFile(cached);
  } catch {
    optimized = await sharp(source).keepMetadata().webp({ lossless: true, effort: 6 }).toBuffer();
    await fs.writeFile(cached, optimized);
  }
  if (optimized.length >= source.length - 256) {
    retained.push({ file: relative(file), reason: 'not smaller' });
    continue;
  }
  const beforeMeta = await sharp(source).metadata();
  const afterMeta = await sharp(optimized).metadata();
  const before = await sharp(source).ensureAlpha().raw().toBuffer();
  const after = await sharp(optimized).ensureAlpha().raw().toBuffer();
  const equal =
    before.equals(after) &&
    (beforeMeta.icc || Buffer.alloc(0)).equals(afterMeta.icc || Buffer.alloc(0)) &&
    (beforeMeta.orientation ?? 1) === (afterMeta.orientation ?? 1) &&
    beforeMeta.width === afterMeta.width &&
    beforeMeta.height === afterMeta.height;
  if (!equal) {
    retained.push({ file: relative(file), reason: 'pixel or color metadata differs' });
    continue;
  }
  const target = file.slice(0, -4) + '.webp';
  inside(file);
  inside(target);
  try {
    await fs.access(target);
    retained.push({ file: relative(file), reason: 'target already exists' });
    continue;
  } catch {}
  await fs.writeFile(target, optimized);
  await fs.unlink(file);
  aliases.set(path.basename(file), path.basename(target));
  imageBytes += source.length - optimized.length;
  converted.push({
    file: relative(file),
    target: relative(target),
    before: source.length,
    after: optimized.length,
    sourceHash,
    rgbaHash: hash(before),
    pixelsIdentical: true,
    colorProfileIdentical: true,
    orientationEquivalent: true,
  });
}
function resolve(name) {
  const seen = new Set();
  while (aliases.has(name)) {
    assert.ok(!seen.has(name));
    seen.add(name);
    name = aliases.get(name);
  }
  return name;
}
const escaped = [...aliases.keys()]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const pattern = new RegExp(`(?<![\\w.-])(?:${escaped.join('|')})(?![\\w.-])`, 'g');
const rewritten = [];
for (const file of await walk(root)) {
  if (
    !/\.(js|mjs|cjs|css|html|json|svg)$/.test(file) ||
    relative(file) === 'src/generated/card-shop-glb.js'
  )
    continue;
  const original = await fs.readFile(file, 'utf8');
  const next = original.replace(pattern, resolve);
  if (next !== original) {
    inside(file);
    await fs.writeFile(file, next);
    rewritten.push(relative(file));
  }
}
for (const name of aliases.keys())
  assert.ok(
    (await walk(path.join(root, 'public'))).some((file) => path.basename(file) === resolve(name)),
  );
const redundantModel = path.join(root, 'public/assets/models/card-shop.glb');
const scene = await fs.readFile(path.join(root, 'src/scene/desk-scene.js'), 'utf8');
assert.ok(scene.includes('cardShopGLB') && scene.includes('../generated/card-shop-glb.js'));
const modelBytes = (await fs.stat(redundantModel)).size;
inside(redundantModel);
await fs.unlink(redundantModel);
const report = {
  createdAt: new Date().toISOString(),
  root,
  duplicates,
  converted,
  retained,
  rewritten,
  duplicateBytes,
  imageBytes,
  redundantEmbeddedModelBytes: modelBytes,
  totalSavedBytes: duplicateBytes + imageBytes + modelBytes,
  originalAssetsUnchanged: true,
  archiveDeduplication: 'ASAR shares identical payloads without changing asset names',
};
await fs.writeFile(path.join(output, 'assets.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    converted: converted.length,
    duplicates: duplicates.length,
    retained: retained.length,
    savedMiB: report.totalSavedBytes / 1048576,
    pixelAndColorMetadataIdentical: true,
  }),
);
