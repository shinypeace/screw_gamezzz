import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const developmentEntry = fileURLToPath(new URL('./dev.html', import.meta.url));

// The repository root contains the compiled Pages export. Local development
// always serves the editable HTML entry, so it cannot accidentally load an old build.
const serveDevelopmentEntry: Plugin = {
  name: 'serve-development-entry',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const pathname = request.url?.split('?')[0];
      if (pathname !== '/' && pathname !== '/index.html') return next();
      try {
        const html = await readFile(developmentEntry, 'utf8');
        const transformed = await server.transformIndexHtml(request.url ?? '/', html);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(transformed);
      } catch (error) {
        next(error);
      }
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [serveDevelopmentEntry],
  build: {
    target: 'es2020',
    rollupOptions: { input: developmentEntry },
  },
});
