import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {readFileSync} from 'node:fs';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    define: {'__APP_VERSION__': JSON.stringify(readFileSync(path.resolve(__dirname, '../VERSION'), 'utf8').trim())},
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '127.0.0.1',
      strictPort: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
        '/ws': {
          target: env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3001',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
