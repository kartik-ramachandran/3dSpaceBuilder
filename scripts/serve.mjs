// Zero-dependency static server for local development.
// Usage: node scripts/serve.mjs [port]   ->   http://localhost:5173/  (built page: /dist/)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './claude-api.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer(port = 5173, root = ROOT) {
  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (await handleApi(req, res, pathname)) return;
      let file = join(root, normalize(decodeURIComponent(pathname)));
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('Forbidden'); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((ok, fail) => { server.once('error', fail); server.listen(port, () => ok(server)); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 5173;
  await startServer(port);
  console.log(`3dSpaceBuilder dev server: http://localhost:${port}/  (overview)  ·  builder: /app.html  ·  home walkthrough: /home.html  ·  single-file build: /dist/`);
}
