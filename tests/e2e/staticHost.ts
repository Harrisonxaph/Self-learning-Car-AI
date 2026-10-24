// A deliberately plain static file server for the browser tests (P1-11): it serves the production build in
// dist/ with no rewrites, no fallbacks and no server code, as any static host would. It serves the same files
// at the site root and under a sub-path, to show the build does not depend on being hosted at "/".
//
// Run by Playwright (playwright.config.ts) with `node tests/e2e/staticHost.ts`. Not part of the app.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

export const STATIC_PORT = 4174;
/** Where the build is mounted: the site root, and a sub-path such as a project page on a shared host. */
export const MOUNTS = ['/', '/nested/app/'] as const;

const DIST = resolve('dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** The file in dist/ for a request path, or null if the path is outside every mount or outside dist/. */
function fileFor(pathname: string): string | null {
  // The longest mount wins, so /nested/app/x is served from the sub-path mount, not as /nested/app/x at root.
  const mount = [...MOUNTS].sort((a, b) => b.length - a.length).find((m) => pathname.startsWith(m));
  if (!mount) return null;
  const relative = pathname.slice(mount.length) || 'index.html';
  const file = resolve(join(DIST, relative.endsWith('/') ? `${relative}index.html` : relative));
  return file === DIST || file.startsWith(DIST + sep) ? file : null;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname === '/__ready') {
      response.writeHead(200).end('ok');
      return;
    }
    const file = request.method === 'GET' ? fileFor(decodeURIComponent(pathname)) : null;
    try {
      if (!file) throw new Error('not found');
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  }).listen(STATIC_PORT, '127.0.0.1');
}
