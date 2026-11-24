// 누끼(배경 제거) AI 모델과 실행 엔진을 public/bgdata 로 복사합니다.
// 외부 서버 없이 웹페이지 안에서 바로 누끼를 딸 수 있게 하기 위함입니다.
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'node_modules/@imgly/background-removal-data/dist';
const DST = 'public/bgdata';

// medium = 고품질 모델(fp16). wasm 은 브라우저 환경에 따라 하나만 사용됩니다.
const KEEP = [
  '/models/medium',
  '/onnxruntime-web/ort-wasm-simd.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  '/onnxruntime-web/ort-wasm.wasm',
];

const all = JSON.parse(fs.readFileSync(path.join(SRC, 'resources.json'), 'utf8'));
const picked = {};
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });
let bytes = 0;
for (const key of KEEP) {
  picked[key] = all[key];
  for (const chunk of all[key].chunks) {
    fs.copyFileSync(path.join(SRC, chunk.hash), path.join(DST, chunk.hash));
    bytes += fs.statSync(path.join(DST, chunk.hash)).size;
  }
}
fs.writeFileSync(path.join(DST, 'resources.json'), JSON.stringify(picked, null, 2));
console.log(`bgdata: ${Object.keys(picked).length} resources, ${(bytes / 1e6).toFixed(1)} MB`);
