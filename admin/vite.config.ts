import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// VITE_BASE: '/' on admin.armadaresidence.com; '/armadaresidence-admin/' only while the Pages site has no custom domain.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  // the dashboard imports src/lib/daterange.ts and content/ui.json from the website (phase 2a.1); esbuild would read
  // the website's root tsconfig for those files (extends astro/…, absent in the admin repository's checkout), so the
  // compiler options are given inline and no tsconfig lookup happens
  esbuild: { tsconfigRaw: '{"compilerOptions":{"target":"ES2022","jsx":"react-jsx","verbatimModuleSyntax":true,"useDefineForClassFields":true}}' },
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', sourcemap: false },
});
