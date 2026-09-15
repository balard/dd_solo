import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-180.png'],
      manifest: {
        name: 'dd_solo — Dragon Dice',
        short_name: 'dd_solo',
        description: 'Solo play for Dragon Dice. Unofficial fan project.',
        theme_color: '#2f6f4f',
        background_color: '#fbfaf8',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The whole app is static and small; precaching all of it is what makes it
        // work offline, which is the point of installing it at all.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
     * Vitest defaults to 5s, which the seeded self-play tests blow through: the
     * replay check alone replays 25 full games (~6.5s here) and the 1000-game fuzz
     * is heavier still. They are slow because they are thorough, not because
     * anything is hanging -- `advance` throws after 1000 steps, so a real hang
     * fails fast regardless of this number.
     */
    testTimeout: 30_000,
  },
})
