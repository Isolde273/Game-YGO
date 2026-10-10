import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CARD_PRINTS } from '../src/game/card-data.js';

test('导入校验覆盖328版本，拒绝缺价、重复、未知规格、版本错配及非法金额', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ygo-price-fixture-'));
  const csv = path.join(dir, 'synthetic.csv');
  const generated = await fs.readFile('src/generated/jihuanshe-prices.js');
  const header = 'printId,cardId,rarity,style,overframe,jihuanshePrice,checkedAt';
  const rows = CARD_PRINTS.map(
    (p) => `${p.id},${p.cardId},${p.rarity},${p.style},${p.overframe},1.25,2026-10-10`,
  );
  const run = async (data, options = []) => {
    await fs.writeFile(csv, '\uFEFF' + data);
    return spawnSync(
      process.execPath,
      ['scripts/import-card-prices.mjs', csv, '--check', ...options],
      { encoding: 'utf8' },
    );
  };
  assert.equal((await run([header, ...rows].join('\r\n'))).status, 0);
  const report = JSON.parse(await fs.readFile(path.join(dir, 'price-import-report.json')));
  assert.equal(report.matched, 328);
  assert.equal(report.complete, true);
  for (const data of [
    [header, ...rows.slice(1)],
    [header, ...rows, rows[0]],
    [header, rows[0].replace(CARD_PRINTS[0].id, 'unknown')],
    [header, rows[0].replace(`,${CARD_PRINTS[0].rarity},`, ',INVALID,')],
    [header, rows[0].replace(',1.25,', ',1.234,')],
    [header, rows[0].replace(',1.25,', ',0,')],
    [header, rows[0].replace('2026-10-10', 'invalid-date')],
    [header, '"unclosed'],
  ])
    assert.notEqual((await run(data.join('\n'))).status, 0);
  const userRows = CARD_PRINTS.map(
    (p) =>
      `${p.id},${p.cardId},${p.rarity},${p.style},${p.overframe},${p.id.startsWith('LOSP-') ? 0 : 1.25},2026-10-10`,
  );
  const userCSV = [header, ...userRows].join('\n');
  assert.notEqual((await run(userCSV, ['--source=user'])).status, 0);
  assert.notEqual((await run(userCSV, ['--exclude-zero'])).status, 0);
  assert.equal((await run(userCSV, ['--source=user', '--exclude-zero'])).status, 0);
  const userReport = JSON.parse(await fs.readFile(path.join(dir, 'price-import-report.json')));
  assert.equal(userReport.source, '用户定价');
  assert.equal(userReport.matched, 318);
  assert.equal(userReport.required, 318);
  assert.equal(userReport.excludedPrintIds.length, 10);
  assert.equal(userReport.complete, true);
  assert.notEqual(
    (await run([header, ...userRows.slice(1)].join('\n'), ['--source=user', '--exclude-zero']))
      .status,
    0,
  );
  assert.deepEqual(await fs.readFile('src/generated/jihuanshe-prices.js'), generated);
  await fs.rm(dir, { recursive: true });
});
