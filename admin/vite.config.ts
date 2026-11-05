import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The build's identity (5 Nov 2026): baked into the bundle as __ADMIN_BUILD__ and written next to it as version.json, so a
// dashboard left open notices a newer deploy (lib/version.ts) and OFFERS a reload — it never reloads by itself.
const BUILD_ID = process.env.GITHUB_SHA ? `${process.env.GITHUB_SHA.slice(0, 12)}-${Date.now()}` : `local-${Date.now()}`;

// VITE_BASE: '/' on admin.armadaresidence.com; '/armadaresidence-admin/' only while the Pages site has no custom domain.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  // the dashboard imports src/lib/daterange.ts and content/ui.json from the website (phase 2a.1); esbuild would read
  // the website's root tsconfig for those files (extends astro/…, absent in the admin repository's checkout), so the
  // compiler options are given inline and no tsconfig lookup happens
  esbuild: { tsconfigRaw: '{"compilerOptions":{"target":"ES2022","jsx":"react-jsx","verbatimModuleSyntax":true,"useDefineForClassFields":true}}' },
  define: { __ADMIN_BUILD__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'admin-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', sourcemap: false },
});
