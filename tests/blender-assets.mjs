import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cardShopGLB } from '../src/generated/card-shop-glb.js';
import { cardShopMeta } from '../src/generated/card-shop-meta.js';
const file = await fs.readFile('public/assets/models/card-shop.glb'),
  embedded = Buffer.from(cardShopGLB, 'base64');
assert.equal(file.toString('ascii', 0, 4), 'glTF');
assert.equal(file.readUInt32LE(4), 2);
assert.equal(file.readUInt32LE(8), file.length);
assert.deepEqual(embedded, file, 'file:// asset must exactly match the Blender-exported GLB');
const json = JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)));
assert.match(json.asset.generator, /Blender/i);
assert.equal(json.scenes.length, 1, 'editable and optimized scenes must not both be shipped');
assert.ok(json.meshes.length <= 90);
assert.ok(file.length < 15 * 1024 * 1024);
assert.ok(!json.buffers.some((b) => b.uri));
assert.ok(
  (json.images ?? []).every((i) => i.bufferView !== undefined),
  'all textures embedded for offline play',
);
for (const material of json.materials)
  if (/walnut|leather|Woven/i.test(material.name))
    assert.equal(
      material.normalTexture,
      undefined,
      'height maps must not be exported as tangent-space normals',
    );
for (const mesh of json.meshes)
  for (const primitive of mesh.primitives) {
    const count = json.accessors[primitive.attributes.POSITION].count;
    for (const attribute of ['NORMAL', 'TEXCOORD_0'])
      assert.equal(
        json.accessors[primitive.attributes[attribute]].count,
        count,
        `${mesh.name}: incomplete ${attribute}`,
      );
  }
for (const name of cardShopMeta.groups)
  assert.ok(
    json.nodes.some((n) => n.extras?.assetGroup === name),
    name,
  );
await fs.access(cardShopMeta.source);
assert.ok(cardShopMeta.sourceParts > 1000);
assert.equal(cardShopMeta.colliders.length, 6);
assert.ok(!cardShopMeta.groups.includes('Lamp'));
for (const group of ['Binder', 'Warehouse', 'AlbumHint', 'ShopHint'])
  assert.ok(cardShopMeta.groups.includes(group));
assert.equal(
  cardShopMeta.colliders.find((c) => c.group === 'Warehouse')?.name,
  'warehouse-cardboard-carton',
);
const result = {
  passed: true,
  assetGenerator: json.asset.generator,
  scenes: json.scenes.length,
  meshes: json.meshes.length,
  bytes: file.length,
  embeddedTextures: json.images?.length ?? 0,
  sha256: createHash('sha256').update(file).digest('hex'),
  source: cardShopMeta.source,
  sourceParts: cardShopMeta.sourceParts,
  triangles: cardShopMeta.triangles,
};
await fs.writeFile('test-results/blender-assets.json', JSON.stringify(result, null, 2));
console.log(result);
