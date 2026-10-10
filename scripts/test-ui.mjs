import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:5173';
let server;
async function available() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    const html = await response.text();
    if (!response.ok || !html.includes('./src/ui/styles/base.css'))
      throw new Error('5173 端口运行的不是当前项目，请停止该服务后重试。');
    return true;
  } catch (error) {
    if (error.message.includes('不是当前项目')) throw error;
    return false;
  }
}
try {
  if (!(await available())) {
    server = spawn(process.execPath, ['scripts/serve.mjs'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '5173' },
    });
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (server.exitCode !== null) throw new Error('源码预览服务启动失败。');
      if (await available()) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('源码预览服务启动超时。');
  }
  const suites = process.argv.slice(2);
  for (const name of suites.length
    ? suites
    : [
        'compact-pages',
        'album-motion',
        'persona-ui',
        'interface-fixes',
        'room-motion',
        'interfaces-layout',
        'navigation-transitions',
        'purchase-overlay',
        'inspector-actions',
        'inspector-routing',
        'game-finishes',
        'room-portals',
        'ui-smoke',
      ]) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid suite: ${name}`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`tests/${name}.mjs`], { cwd: root, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`${name} 未通过（exit ${code}）。`);
  }
} finally {
  server?.kill();
}
