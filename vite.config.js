import { defineConfig } from 'vite';

// Relative base so the build works at any path (e.g. https://<user>.github.io/Worldbuilder/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
