import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['pipeline/test/**/*.test.mjs', 'sensors/test/**/*.test.mjs'],
  },
})
