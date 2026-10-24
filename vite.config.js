import { defineConfig } from 'vite';

// Relative base so the build works at any path. In development the API calls go
// to the Node server (npm run server) on port 3000.
export default defineConfig({
  base: './',
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
