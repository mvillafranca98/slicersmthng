import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
  optimizeDeps: {
    // List every runtime dep up front so Vite bundles them all on first start.
    // If a new import appears in source that isn't here, Vite re-optimizes
    // mid-session — that invalidates the browser's cached module hashes and
    // freezes the page on this Intel Mac.
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      'zustand',
      'socket.io-client',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'class-variance-authority',
      // installed but not yet wired into the UI — pre-bundle anyway so they
      // don't trigger re-optimization when we start using them.
      'wavesurfer.js',
      'tone',
      'lottie-react',
      'react-hotkeys-hook',
    ],
  },
})
