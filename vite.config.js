import { defineConfig } from 'vite';

// base './' → 어느 주소(GitHub Pages 하위 폴더 등)에 올려도 동작
export default defineConfig({
  base: './',
  build: { outDir: 'docs', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
