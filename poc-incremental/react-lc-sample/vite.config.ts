import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 别名：把 @udsl/* 指到源码（PoC 直接吃 TS/JS 源，免打包），引擎指到现有 incremental.js。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@udsl/engine': r('../src/incremental.js'),
      '@udsl/ui-kit-core': r('../ui-kit-core/src/index.ts'),
      '@udsl/ui-kit-react': r('../ui-kit-react/src/index.ts'),
    },
  },
  server: { fs: { allow: [r('..')] } },     // 允许引用 poc-incremental 下的规则/页面 JSON
});
