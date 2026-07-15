import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 别名：@udsl/* 指到源码，引擎指到单源 incremental.js。
// proxy：/api 代到 store-server(:8788)，浏览器同源拉规则（与 React runtime-loader 一致）。
export default defineConfig({
  resolve: {
    alias: {
      '@udsl/engine': r('../src/incremental.js'),
      '@udsl/ui-kit-core': r('../ui-kit-core/src/index.ts'),
      '@udsl/ui-kit-html': r('../ui-kit-html/src/index.ts'),
    },
  },
  server: {
    fs: { allow: [r('..')] },
    proxy: { '/api': 'http://localhost:8788' },
  },
});
