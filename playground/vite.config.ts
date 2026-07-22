import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The playground is served by Vite, separately from the extension build. It is
 * a *host page* the extension gets injected into, so it must not go through
 * WXT's pipeline — it needs to look like any other site on the web.
 */
export default defineConfig({
  root: __dirname,
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Both pages are entrypoints; the Trusted-Types one is a separate host.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        trustedTypes: resolve(__dirname, 'trusted-types.html'),
      },
    },
  },
});
