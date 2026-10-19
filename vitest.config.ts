import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@mageknight/engine': path.resolve(import.meta.dirname, 'packages/engine/src/index.ts'),
      '@mageknight/content': path.resolve(import.meta.dirname, 'packages/content/src/index.ts'),
      '@mageknight/content-schema': path.resolve(import.meta.dirname, 'packages/content-schema/src/index.ts'),
      '@mageknight/test-kit': path.resolve(import.meta.dirname, 'packages/test-kit/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    exclude: ['apps/web/e2e/**', 'node_modules/**', 'packages/engine/src/__tests__/conquest-solver.acceptance.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
