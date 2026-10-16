import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

// Electron's filesystem reads directly from app.asar. The browser edition shares
// the packaged game resources and only listens on this computer's loopback IP.
export async function startLocalBrowser(root, openBrowser) {
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const reduced = html.includes('data-game-quality="reduced"');
  const port = reduced ? 28102 : 28101;
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.otf': 'font/otf',
    '.m4a': 'audio/mp4',
  };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname !== '/' && !/^\/(src|public)\//.test(pathname)) {
        response.writeHead(404).end();
        return;
      }
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await fs.readFile(file);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${port}/`;
  await openBrowser(url);
  return { server, url };
}
