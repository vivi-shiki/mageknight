import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, 'apps/web'),
  resolve: {
    alias: {
      '@mageknight/engine': path.resolve(import.meta.dirname, 'packages/engine/src/index.ts'),
      '@mageknight/content': path.resolve(import.meta.dirname, 'packages/content/src/index.ts'),
      '@mageknight/content-schema': path.resolve(import.meta.dirname, 'packages/content-schema/src/index.ts'),
      '@mageknight/test-kit': path.resolve(import.meta.dirname, 'packages/test-kit/src/index.ts'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 4173,
    proxy: {
      '/api': process.env.VITE_API_TARGET ?? 'http://127.0.0.1:4174',
    },
  },
});
