import { defineConfig } from 'vite';

/** Builds the standalone replay page script that "Share as HTML" inlines into its exports. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    lib: {
      entry: 'src/share/viewer.ts',
      formats: ['iife'],
      name: 'TrailTrackViewer',
      fileName: () => 'share-viewer.js',
    },
  },
});
