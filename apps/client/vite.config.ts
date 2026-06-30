import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import { resolve } from 'path';

export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    // pinia 2.0.x 通过 vue-demi 做 vue2/3 兼容垫片，Vite 8 不会自动把它加入预构建
    include: ['vue-demi', 'pinia', 'vue'],
  },
});
