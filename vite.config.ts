import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // względne ścieżki -> działa na GitHub Pages pod /nazwa-repo/
  base: './',
  resolve: {
    alias: {
      // logika gry współdzielona z serwerem (Supabase Edge Function)
      '@sim': fileURLToPath(new URL('./supabase/functions/_shared/sim.ts', import.meta.url)),
    },
  },
});
