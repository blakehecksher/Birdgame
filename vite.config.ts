import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Birdgame/',
  server: {
    port: 3000,
    host: true, // Allow network access for testing on different devices
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
  },
});
