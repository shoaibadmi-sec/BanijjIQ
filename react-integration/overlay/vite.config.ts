import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative assets allow a separate preview deployment. Proxy requests only during local development.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8787', changeOrigin: true }
    }
  }
});
