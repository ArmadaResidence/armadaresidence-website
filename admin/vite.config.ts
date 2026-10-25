import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// VITE_BASE: '/' on admin.armadaresidence.com; '/armadaresidence-admin/' only while the Pages site has no custom domain.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', sourcemap: false },
});
