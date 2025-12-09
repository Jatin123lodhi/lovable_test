import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
      port: 80, // v1.0.0
      protocol: 'ws'
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})

