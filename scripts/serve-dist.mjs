// Static server for dist/ (the local build) — used by the browser checks. Node handles the checks' parallel
// browser contexts; python's http.server refuses connections under that load (backlog of 5).
//   node scripts/serve-dist.mjs [PORT]        (default 4330, 127.0.0.1)
// As a module: `const { url, close } = await serveDist(port)`; port 0 = any free port.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
};

function fileFor(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const p = join(DIST, rel);
  if (!p.startsWith(DIST)) return null;
  for (const c of [p, join(p, 'index.html'), `${p}.html`]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {}
  }
  return null;
}

export function serveDist(port = 4330, host = '127.0.0.1') {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    // directory URLs without the trailing slash redirect like GitHub Pages does
    if (!extname(pathname) && !pathname.endsWith('/') && fileFor(`${pathname}/`)) {
      res.writeHead(301, { Location: `${pathname}/` }).end();
      return;
    }
    const file = fileFor(pathname);
    const notFound = !file;
    const path = file ?? fileFor('/404.html');
    if (!path) return res.writeHead(404).end('not found');
    res.writeHead(notFound ? 404 : 200, { 'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(path).pipe(res);
  });
  return new Promise((ok, ko) => {
    server.once('error', ko);
    server.listen(port, host, () => {
      const { port: p } = server.address();
      ok({ url: `http://${host}:${p}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await serveDist(Number(process.argv[2] || 4330));
  console.log(`serving dist/ at ${url}`);
}
