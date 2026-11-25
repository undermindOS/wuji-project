import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { accessKeyFromEnv, createApi, memoryKv } from './api/csr.ts';

// On the site /api/csr is a Vercel Function backed by shared storage. Locally the same handler runs
// here with storage kept in memory: it lasts until the dev server stops and never leaves this machine.
// CSR_NO_STORAGE=1 npm run dev shows the page as it is on a site where storage is not connected.
// CSR_ACCESS_KEY=… npm run dev locks the local storage with a team key, as the owner does on the site.
declare const process: { env: Record<string, string | undefined> };

function localSharedStorage(): Plugin {
  const api = createApi(process.env.CSR_NO_STORAGE ? null : memoryKv(), undefined, accessKeyFromEnv(process.env));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const serve = (request: any, response: any, next: () => void) => {
    if (!request.url?.startsWith('/api/csr')) return next();
    const chunks: Uint8Array[] = [];
    request.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    request.on('end', async () => {
      const body = chunks.length ? new TextDecoder().decode(new Uint8Array(chunks.flatMap(chunk => [...chunk]))) : undefined;
      const key = request.headers['x-csr-key'];
      const answer = await api.fetch(new Request(`http://localhost${request.url}`, { method: request.method, headers: typeof key === 'string' ? { 'x-csr-key': key } : undefined, body: request.method === 'GET' ? undefined : body }));
      response.statusCode = answer.status;
      answer.headers.forEach((value, name) => response.setHeader(name, value));
      response.end(await answer.text());
    });
  };
  return {
    name: 'csr-local-shared-storage',
    configureServer(server) { server.middlewares.use(serve); },
    configurePreviewServer(server) { server.middlewares.use(serve); },
  };
}

export default defineConfig({
  base: '/',
  plugins: [react(), localSharedStorage()],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8000' } } },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8000' } } },
});
