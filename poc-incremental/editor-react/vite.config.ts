import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@udsl/engine': r('../src/incremental.js'),
      '@udsl/engine-kernel': r('../src/kernel.js'),
      '@udsl/ui-kit-core': r('../ui-kit-core/src/index.ts'),
      '@udsl/ui-kit-react': r('../ui-kit-react/src/index.ts'),
    },
  },
  server: { fs: { allow: [r('..')] } },
});
