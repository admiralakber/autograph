import { defineConfig } from 'vite';

// Autograph ships as a GitHub Pages *project* site at
// https://admiralakber.github.io/autograph/ , so every asset URL must be
// resolved under the `/autograph/` base. Override with AUTOGRAPH_BASE when
// hosting elsewhere (e.g. a user/organisation page at `/`).
const base = process.env.AUTOGRAPH_BASE ?? '/autograph/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
});
