import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // *.live.test.ts hit real network endpoints (e.g. OMIE). Kept out of the default run
    // for speed + determinism; run one explicitly: `npx vitest run path/to/x.live.test.ts`.
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
