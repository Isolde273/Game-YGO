import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import * as PE from 'pe-library';
import * as RE from 'resedit';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(process.argv[2], 'Provide the packaged executable path');
const target = path.resolve(process.argv[2]);
assert.equal(path.extname(target).toLowerCase(), '.exe');
const icon = RE.Data.IconFile.from(
  await fs.readFile(path.join(project, 'public/assets/application-icon.ico')),
);
assert.ok(icon.icons.length);
const hash = (binary) => crypto.createHash('sha256').update(Buffer.from(binary)).digest('hex');
const iconBinary = (group, entries) => {
  const file = new RE.Data.IconFile();
  file.icons = group.getIconItemsFromEntries(entries).map((data) => ({ data }));
  return file.generate();
};
const canonicalIcon = new RE.Data.IconFile();
canonicalIcon.icons = icon.icons.map(({ data }) => ({ data }));
const iconHash = hash(canonicalIcon.generate());
const original = await fs.readFile(target);
const exe = PE.NtExecutable.from(original, { ignoreCert: true });
const resources = PE.NtExecutableResource.from(exe);
const groups = RE.Resource.IconGroupEntry.fromEntries(resources.entries);
if (
  groups.length &&
  groups.every((group) => hash(iconBinary(group, resources.entries)) === iconHash)
) {
  console.log(JSON.stringify({ target, frames: icon.icons.length, alreadyApplied: true }));
} else {
  const resourceSection = exe.getSectionByEntry(PE.Format.ImageDirectoryEntry.Resource);
  const sections = exe
    .getAllSections()
    .filter((section) => section !== resourceSection)
    .map((section) => ({
      name: section.info.name,
      hash: hash(section.data || new ArrayBuffer(0)),
    }));
  const nonIconResources = (entries) =>
    entries
      .filter((entry) => entry.type !== 3 && entry.type !== 14)
      .map((entry) => ({
        type: entry.type,
        id: entry.id,
        lang: entry.lang,
        codepage: entry.codepage,
        hash: hash(entry.bin),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const preservedResources = nonIconResources(resources.entries);
  resources.entries = resources.entries.filter((entry) => entry.type !== 3 && entry.type !== 14);
  for (const group of groups.length ? groups : [{ id: 101, lang: 1033 }]) {
    RE.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      icon.icons.map(({ data }) => data),
    );
  }
  resources.outputResource(exe);
  const generated = Buffer.from(exe.generate());
  const checkedExe = PE.NtExecutable.from(generated);
  const checkedResources = PE.NtExecutableResource.from(checkedExe);
  assert.deepEqual(nonIconResources(checkedResources.entries), preservedResources);
  const checkedResourceSection = checkedExe.getSectionByEntry(
    PE.Format.ImageDirectoryEntry.Resource,
  );
  assert.deepEqual(
    checkedExe
      .getAllSections()
      .filter((section) => section !== checkedResourceSection)
      .map((section) => ({
        name: section.info.name,
        hash: hash(section.data || new ArrayBuffer(0)),
      })),
    sections,
  );
  assert.ok(
    RE.Resource.IconGroupEntry.fromEntries(checkedResources.entries).every(
      (group) => hash(iconBinary(group, checkedResources.entries)) === iconHash,
    ),
  );
  const history = path.join(project, 'test-results/package-history');
  await fs.mkdir(history, { recursive: true });
  const backup = path.join(history, `exe-before-${crypto.randomUUID()}.exe`);
  await fs.copyFile(target, backup, constants.COPYFILE_EXCL);
  const temporary = path.join(path.dirname(target), `.icon-stage-${crypto.randomUUID()}.exe`);
  try {
    await fs.writeFile(temporary, generated, { flag: 'wx' });
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  console.log(
    JSON.stringify({ target, frames: icon.icons.length, nonIconSectionsUnchanged: true, backup }),
  );
}
