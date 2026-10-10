import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = [];
async function collect(directory) {
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!['vendor', 'generated', '__pycache__'].includes(entry.name)) await collect(name);
    } else if (/\.(js|mjs|cjs|css)$/.test(name)) sourceFiles.push(name);
  }
}
await collect('src');
await collect('desktop');
await collect('scripts');
await collect('tests');
sourceFiles.push('public/material-review/review.js', 'public/material-review/review.css');
let references = 0;
async function checkReference(from, reference) {
  if (/^(data:|https?:|#|node:)/.test(reference)) return;
  let file = reference.startsWith('/')
    ? path.resolve(root, '.' + reference)
    : path.resolve(root, path.dirname(from), reference);
  if (file === root) file = path.join(root, 'index.html');
  if (!file.startsWith(root + path.sep)) throw new Error(`Reference outside project: ${from}`);
  try {
    await fs.access(file);
  } catch {
    throw new Error(`Missing reference: ${from} -> ${reference}`);
  }
  references++;
}
for (const file of sourceFiles) {
  if (/\.(js|mjs|cjs)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`${file}\n${result.stderr}`);
    const text = await fs.readFile(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) await checkReference(file, match[1]);
    }
  } else {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g))
      await checkReference(file, match[1]);
  }
}
for (const html of ['index.html', 'public/material-review/index.html']) {
  const text = await fs.readFile(path.join(root, html), 'utf8');
  for (const match of text.matchAll(/(?:src|href)="([^"#]+)"/g))
    await checkReference(html, match[1]);
}
for (const file of ['启动游戏.cmd', '预览源码.cmd', '审查卡面.cmd']) {
  const text = await fs.readFile(path.join(root, file), 'utf8');
  if (/(^|[^\r])\n/.test(text)) throw new Error(`${file} 必须使用 Windows CRLF 换行。`);
}
for (const file of [
  'public/assets/models/card-shop.glb',
  'src/generated/card-shop-glb.js',
  'src/generated/card-shop-meta.js',
])
  await fs.access(path.join(root, file));
console.log(
  `源码与离线引用检查通过：${sourceFiles.length} 个文件，${references} 个引用。此命令不更新绿色版。`,
);
const cardData = spawnSync(process.execPath, ['scripts/generate-card-data.mjs', '--check'], {
  cwd: root,
  encoding: 'utf8',
});
if (cardData.status !== 0) throw new Error(cardData.stderr || cardData.stdout);
process.stdout.write(cardData.stdout);
