import { defineConfig, loadEnv } from 'vite';

function apiHealthCheck(apiPort) {
  return {
    name: 'api-health-check',
    async configureServer() {
      try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
        if (!res.ok) throw new Error();
      } catch {
        console.warn(
          `\n⚠️  API offline em http://localhost:${apiPort}\n` +
            '   Rode "npm run dev" (API + frontend), não apenas "vite".\n',
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT || '3001';

  return {
    base: './',
    plugins: [
      apiHealthCheck(apiPort),
      {
        name: 'public-form-route',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url?.split('?')[0] || '';
            if (/^\/f\/[^/]+/.test(url)) {
              req.url = '/formulario.html';
            }
            next();
          });
        },
      },
    ],
    server: {
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
        '/ws': {
          target: `http://127.0.0.1:${apiPort}`,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
