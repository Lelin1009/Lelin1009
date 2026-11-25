import { defineConfig } from 'vite';
import fs from 'node:fs';
import crypto from 'node:crypto';

// 빌드 결과물 목록으로 서비스 워커(sw.js)를 만들어 앱을 오프라인 설치 가능하게 함
function serviceWorker() {
  return {
    name: 'suseok-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const extra = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
      const precache = [...new Set([...extra, ...files])];
      const version = crypto.createHash('sha1').update(precache.join('|')).digest('hex').slice(0, 10);
      const src = fs.readFileSync('src/sw-template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// base './' → 어느 주소(GitHub Pages 하위 폴더 등)에 올려도 동작
export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: { outDir: 'docs', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
