import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // ship the new service worker as soon as it is downloaded rather than
      // waiting for every tab to close -- there is no unsaved editor state
      // here that a reload would lose
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'wishli',
        short_name: 'wishli',
        description: 'Make wishlists, share them with friends, and keep the surprise.',
        theme_color: '#863bff',
        background_color: '#ffffff',
        display: 'standalone',
        // an installed app is almost always already signed in; if not, this
        // bounces to /login the same way opening the site does
        start_url: '/dashboard',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          // android crops icons to its own shape -- the bolt sits well inside
          // the safe zone so the same file works for both purposes
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // the shell only: the two login backgrounds are ~2MB together and are
        // not worth blocking an install on. nothing here caches Supabase --
        // those are cross-origin, so every wishlist still comes from the
        // network and the app is not usable offline by design.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
})
