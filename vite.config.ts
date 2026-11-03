import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverPort = Number(process.env.GERENCIADOR_SVN_PORT ?? 4517);

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // app local servido pelo próprio servidor: o tamanho do bundle não pesa no carregamento
    chunkSizeWarningLimit: 1500,
  },
});
