import * as THREE from '../vendor/three.module.js';

// Submit card tiles together, then cross from WebGL to 2D once per atlas.
// Small atlases bound temporary memory for large sorting fans.
export function createFinishBatchRenderer(renderer, scene, camera, plane) {
  const atlas = document.createElement('canvas');
  const context = atlas.getContext('2d');
  const tilesScene = new THREE.Scene();
  const pool = [];
  let copies = 0;
  let submissions = 0;
  let disposed = false;
  let previewMaterial;
  let bufferResizes = 0;
  const maxPixels = 4194304;
  function capacity(canvas, width, height) {
    if (canvas.width >= width && canvas.height >= height) return null;
    const nextWidth = Math.ceil(Math.max(canvas.width, width) / 64) * 64;
    const nextHeight = Math.ceil(Math.max(canvas.height, height) / 64) * 64;
    // Retain capacity while single cards, strips and suffixes alternate. A
    // different aspect ratio may require replacing the bounded working set.
    return nextWidth * nextHeight <= maxPixels ? [nextWidth, nextHeight] : [width, height];
  }
  function reserve(width, height) {
    const size = capacity(renderer.domElement, width, height);
    if (size) {
      renderer.setSize(...size, false);
      bufferResizes++;
    }
  }
  function renderTile(job, x, y) {
    const { material, light, exposure, toneMappingExposure, w, h, renderW, renderX = 0 } = job;
    material.uniforms.lightPosition.value.copy(light);
    material.uniforms.exposure.value = exposure;
    material.uniforms.diffuseIntensity.value = 1;
    renderer.toneMappingExposure = toneMappingExposure;
    plane.material = material;
    if (renderW < w) camera.setViewOffset(w, h, renderX, 0, renderW, h);
    else camera.clearViewOffset();
    renderer.setViewport(x, y, renderW, h);
    renderer.setScissor(x, y, renderW, h);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(scene, camera);
    submissions++;
  }
  function tileMesh(job, index, x, y, width, height) {
    let mesh = pool[index];
    if (!mesh) {
      const material = job.material.clone();
      // Change clip-space placement only. World positions, film coordinates,
      // fragment shader and all per-card lighting remain those of the original.
      material.vertexShader = material.vertexShader
        .replace(
          'void main()',
          'uniform mat4 tileProjection;\nuniform mat4 cardProjection;\nvoid main()',
        )
        .replace(
          'gl_Position=projectionMatrix*viewMatrix*world;',
          'gl_Position=tileProjection*cardProjection*viewMatrix*world;',
        );
      material.uniforms = {};
      mesh = new THREE.Mesh(plane.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = index;
      pool.push(mesh);
      tilesScene.add(mesh);
    }
    if (job.renderW < job.w)
      camera.setViewOffset(job.w, job.h, job.renderX ?? 0, 0, job.renderW, job.h);
    else camera.clearViewOffset();
    const cardProjection = camera.projectionMatrix.clone();
    mesh.userData.bounds = [x, y, job.renderW, job.h];
    mesh.onBeforeRender = () => {
      renderer.setScissorTest(true);
      renderer.setScissor(...mesh.userData.bounds);
    };
    const projection = new THREE.Matrix4().set(
      job.renderW / width,
      0,
      0,
      (2 * x + job.renderW) / width - 1,
      0,
      job.h / height,
      0,
      (2 * y + job.h) / height - 1,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    );
    Object.assign(mesh.material.uniforms, job.material.uniforms, {
      tileProjection: { value: projection },
      cardProjection: { value: cardProjection },
      lightPosition: { value: job.light },
      exposure: { value: job.exposure },
      diffuseIntensity: { value: 1 },
      toneMappingExposure: { value: job.toneMappingExposure },
    });
    mesh.material.uniformsNeedUpdate = true;
    mesh.visible = true;
    return mesh;
  }
  function flush(tiles, usedHeight, width, maxHeight) {
    const height = Math.min(maxHeight, Math.ceil(usedHeight / 64) * 64);
    reserve(width, height);
    const size = capacity(atlas, width, height);
    if (size) {
      [atlas.width, atlas.height] = size;
    }
    camera.clearViewOffset();
    pool.forEach((mesh) => (mesh.visible = false));
    tiles.forEach(({ job, x, y }, index) =>
      tileMesh(job, index, x, height - y - job.h, width, height),
    );
    camera.clearViewOffset();
    renderer.setViewport(0, 0, width, height);
    renderer.setScissor(0, 0, width, height);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(tilesScene, camera);
    renderer.setScissorTest(false);
    submissions++;
    context.globalCompositeOperation = 'copy';
    context.drawImage(
      renderer.domElement,
      0,
      renderer.domElement.height - height,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    copies++;
    for (const { job, x, y } of tiles) {
      const renderX = job.renderX ?? 0;
      job.context.clearRect(renderX, 0, job.renderW, job.h);
      job.context.drawImage(atlas, x, y, job.renderW, job.h, renderX, 0, job.renderW, job.h);
    }
    // Keep compiled materials for reuse without retaining released card textures.
    for (const mesh of pool) {
      mesh.visible = false;
      for (const name of Object.keys(mesh.material.uniforms)) delete mesh.material.uniforms[name];
    }
  }
  function draw(jobs) {
    if (!jobs.length) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      drawJobs(jobs);
    } finally {
      renderer.autoClear = autoClear;
      renderer.setScissorTest(false);
    }
  }
  function drawJobs(jobs) {
    if (jobs.length === 1) {
      // A dragged card usually updates alone; keep its original single copy.
      const [job] = jobs;
      reserve(job.renderW, job.h);
      renderTile(job, 0, 0);
      job.context.clearRect(job.renderX ?? 0, 0, job.renderW, job.h);
      job.context.drawImage(
        renderer.domElement,
        0,
        renderer.domElement.height - job.h,
        job.renderW,
        job.h,
        job.renderX ?? 0,
        0,
        job.renderW,
        job.h,
      );
      copies++;
      return;
    }
    const width = Math.min(
      2048,
      renderer.capabilities.maxTextureSize,
      Math.ceil(jobs.reduce((sum, job) => sum + Math.ceil(job.renderW / 2) * 2, 0) / 64) * 64,
    );
    const maxHeight =
      Math.floor(Math.min(renderer.capabilities.maxTextureSize, Math.floor(4194304 / width)) / 64) *
      64;
    let tiles = [],
      x = 0,
      y = 0,
      rowHeight = 0;
    for (const job of jobs) {
      if (x + job.renderW > width) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      if (y + Math.ceil(job.h / 2) * 2 > maxHeight) {
        flush(tiles, y + rowHeight, width, maxHeight);
        tiles = [];
        x = y = rowHeight = 0;
      }
      tiles.push({ job, x, y: y + (job.h % 2) });
      // Keep the same 2x2 fragment-derivative grid as a standalone canvas.
      x += Math.ceil(job.renderW / 2) * 2;
      rowHeight = Math.max(rowHeight, Math.ceil(job.h / 2) * 2);
    }
    if (tiles.length) flush(tiles, y + rowHeight, width, maxHeight);
  }
  return {
    draw,
    async prepare(material) {
      // Compile both programs before the inspector starts moving.
      // Keep compilation independent of a warm stack being released/replaced.
      const preview = material.clone();
      previewMaterial = preview;
      plane.material = preview;
      const mesh = tileMesh(
        {
          material: preview,
          light: material.uniforms.lightPosition.value,
          exposure: 1,
          toneMappingExposure: 1,
          w: 2,
          h: 2,
          renderW: 2,
        },
        0,
        0,
        2,
        2,
      );
      try {
        const materials = new Set([
          ...renderer.compile(scene, camera),
          ...renderer.compile(tilesScene, camera),
        ]);
        const programs = [...materials].map((item) => renderer.properties.get(item).currentProgram);
        // Three's compileAsync keeps polling after renderer disposal. Own this
        // wait so exiting during prewarming also settles the prepare promise.
        while (!disposed && programs.some((program) => !program.isReady()))
          await new Promise(requestAnimationFrame);
      } finally {
        // Retain the compiled program, without retaining card textures.
        for (const name of Object.keys(preview.uniforms)) delete preview.uniforms[name];
        mesh.visible = false;
        for (const name of Object.keys(mesh.material.uniforms)) delete mesh.material.uniforms[name];
      }
    },
    stats: () => ({
      copies,
      submissions,
      atlasPixels: atlas.width * atlas.height,
      bufferPixels: renderer.domElement.width * renderer.domElement.height,
      bufferResizes,
      retainedTileUniforms: pool.reduce(
        (sum, mesh) => sum + Object.keys(mesh.material.uniforms).length,
        0,
      ),
    }),
    dispose() {
      disposed = true;
      previewMaterial?.dispose();
      previewMaterial = null;
      for (const mesh of pool) {
        mesh.material.dispose();
        if (mesh.geometry !== plane.geometry) mesh.geometry.dispose();
      }
      tilesScene.clear();
      pool.length = 0;
      atlas.width = atlas.height = 1;
    },
  };
}
