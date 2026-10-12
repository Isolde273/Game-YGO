// Compile before drawing and spread texture uploads across browser frames.
// Keep this wait owned by the visit, so leaving a room can cancel preparation.
import { scheduleResourceTask } from './resource-scheduler.js';
const uploads = new WeakMap();
const nextFrame = () => new Promise(requestAnimationFrame);

export async function prepareRenderer(renderer, scene, camera, valid = () => true, target = scene) {
  if (!valid()) return;
  let materials;
  await scheduleResourceTask(() => (materials = renderer.compile(scene, camera, target)), {
    valid,
  });
  if (!valid()) return;
  const programs = [
    ...new Set(
      [...materials].flatMap((material) => {
        const properties = renderer.properties.get(material);
        return properties.programs
          ? [...properties.programs.values()]
          : [properties.currentProgram];
      }),
    ),
  ];
  while (valid() && programs.some((program) => !program.isReady())) await nextFrame();
  if (!valid()) return;
  for (const program of programs) {
    await scheduleResourceTask(() => program.getUniforms(), { valid });
    if (!valid()) return;
  }
  let uploaded = uploads.get(renderer);
  if (!uploaded) uploads.set(renderer, (uploaded = new WeakMap()));
  const textures = new Set();
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const uniform of Object.values(material.uniforms ?? {}))
      if (uniform.value?.isTexture) textures.add(uniform.value);
  }
  for (const texture of textures) {
    if (!texture.image || uploaded.get(texture) === texture.version) continue;
    await scheduleResourceTask(
      () => {
        renderer.initTexture(texture);
        uploaded.set(texture, texture.version);
      },
      { valid },
    );
  }
}
