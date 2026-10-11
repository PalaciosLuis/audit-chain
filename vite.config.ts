import { defineConfig } from 'vite';

// Static-only build. No backend, no runtime dependencies beyond the platform.
export default defineConfig({
  build: {
    target: 'es2022',
    cssTarget: 'es2022',
  },
});
