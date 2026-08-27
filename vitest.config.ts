import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Le cœur métier ne touche ni au DOM ni à UXP : Node suffit et va plus vite.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/core/**/*.ts'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
})
