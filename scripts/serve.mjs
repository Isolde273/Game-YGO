import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname !== '/' && !/^\/(src\/|public\/)/.test(pathname)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const content = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
const port = Number(process.env.PORT) || 5173;
server.listen(port, '127.0.0.1', () => console.log(`游戏王开盒模拟器: http://127.0.0.1:${port}`));
