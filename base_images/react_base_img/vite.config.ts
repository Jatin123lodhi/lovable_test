import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // Allow all hosts
    watch: {
      usePolling: true,
      interval: 1000 // Check for changes every second
    },
    hmr: {
      host: process.env.VITE_HMR_HOST,
      clientPort: 80,
      protocol: 'ws'
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
