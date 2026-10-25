import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@core': r('./packages/core/src'),
      '@physics': r('./packages/physics/src'),
      '@render': r('./packages/render/src'),
      '@ui': r('./packages/ui/src'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
