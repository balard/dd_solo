import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Engine and data tests are pure; no DOM needed yet. Phase 7 adds a
    // jsdom project for component tests.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
