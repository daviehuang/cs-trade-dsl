import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 别名同其它样本：@udsl/* 指到源码，引擎指到 incremental.js。
// proxy：把 /api 代到 store-server(:8788)，让浏览器同源拉规则（避免跨源、贴近生产 Rule Bundle API）。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@udsl/engine': r('../src/incremental.js'),
      '@udsl/ui-kit-core': r('../ui-kit-core/src/index.ts'),
      '@udsl/ui-kit-react': r('../ui-kit-react/src/index.ts'),
    },
  },
  server: {
    fs: { allow: [r('..')] },
    proxy: { '/api': 'http://localhost:8788' },
  },
});
