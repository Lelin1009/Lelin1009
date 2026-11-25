// 누끼(배경 제거): AI 자동 처리 + 지우개/복원 브러시로 수정
import { removeBackground } from '@imgly/background-removal';

const MAX_SIDE = 2400; // 폰 원본(4000px 이상)은 이 크기로 줄여서 처리 → 결과물(1200px)에는 충분

const CDN = 'https://staticimgly.com/@imgly/background-removal-data/1.4.5/dist/';
let publicPathPromise;
function getPublicPath() {
  // 같은 폴더에 모델(bgdata)이 있으면 그것을, 없으면 제작사 CDN 을 사용
  // (GET 사용: 앱 오프라인 저장소가 이 파일도 보관해서 인터넷 없이도 동작)
  publicPathPromise ??= fetch(new URL('bgdata/resources.json', document.baseURI))
    .then((r) => (r.ok ? new URL('bgdata/', document.baseURI).href : CDN))
    .catch(() => CDN);
  return publicPathPromise;
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 옵션을 지원하지 않는 구형 브라우저 → <img> 로 열기 (회전 정보는 브라우저가 적용)
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function loadImageToCanvas(file) {
  const bmp = await decode(file);
  if (!bmp.width || !bmp.height) throw new Error('empty image');
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

const toBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));

/** AI 자동 누끼 → 마스크 캔버스(알파 채널 = 남길 부분) */
export async function autoMask(src, onProgress) {
  const publicPath = await getPublicPath();
  const input = await toBlob(src, 'image/jpeg', 0.95);
  const out = await removeBackground(input, {
    publicPath,
    model: 'medium',
    proxyToWorker: false,
    output: { format: 'image/png' },
    progress: (key, cur, total) => {
      if (!onProgress) return;
      if (key.startsWith('fetch')) onProgress({ stage: 'download', ratio: total ? cur / total : 0 });
      else onProgress({ stage: 'compute', ratio: total ? cur / total : 0 });
    },
  });
  const bmp = await createImageBitmap(out);
  const mask = document.createElement('canvas');
  mask.width = src.width;
  mask.height = src.height;
  mask.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);
  bmp.close?.();
  return mask;
}

/** 원본 + 마스크 → 배경이 투명한 사진 */
export function composite(src, mask, out = document.createElement('canvas')) {
  // 크기가 같으면 다시 할당하지 않음 (브러시로 그릴 때 매번 호출되므로)
  if (out.width !== src.width) out.width = src.width;
  if (out.height !== src.height) out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

export function cloneCanvas(c) {
  const n = document.createElement('canvas');
  n.width = c.width;
  n.height = c.height;
  n.getContext('2d').drawImage(c, 0, 0);
  return n;
}

/**
 * 누끼 수정 화면
 * 모드: erase(지우개) / restore(복원) / pan(이동)
 */
export class MaskEditor {
  constructor(root) {
    this.root = root;
    this.wrap = root.querySelector('.ed-stage');
    this.view = root.querySelector('#ed-canvas');
    this.vctx = this.view.getContext('2d');
    this.mode = 'erase';
    this.brush = 40;
    this.zoom = 1;
    this.undoStack = [];
    this.drawing = false;
    this.cursor = null;

    this.view.addEventListener('pointerdown', (e) => this.down(e));
    this.view.addEventListener('pointermove', (e) => this.move(e));
    this.view.addEventListener('pointerup', (e) => this.up(e));
    this.view.addEventListener('pointercancel', (e) => this.up(e));
    this.view.addEventListener('pointerleave', () => { this.cursor = null; this.paint(); });
  }

  open(src, mask, aiMask = mask) {
    this.src = src;
    this.mask = cloneCanvas(mask);
    this.initial = cloneCanvas(aiMask); // "AI 결과로" = 처음 자동 누끼 결과
    this.undoStack = [];
    this.view.width = src.width;
    this.view.height = src.height;
    // 브러시 기본 크기 = 사진 긴 변의 3%
    this.setBrushPct(this.brushPct ?? 3);
    this.setZoom(1);
    this.paint();
  }

  setBrushPct(pct) {
    this.brushPct = pct;
    this.brush = Math.max(4, (Math.max(this.src?.width ?? 1000, this.src?.height ?? 1000) * pct) / 100);
    this.paint();
  }

  setZoom(z) {
    // 확대 1 = 화면에 사진 전체가 들어오는 크기
    this.zoom = z;
    const pad = 32;
    const sw = this.wrap.clientWidth - pad;
    const sh = this.wrap.clientHeight - pad;
    const fit = Math.min(sw / this.view.width, sh / this.view.height);
    this.view.style.width = `${Math.max(50, this.view.width * fit * z)}px`;
  }

  setMode(m) {
    this.mode = m;
    this.view.style.cursor = m === 'pan' ? 'grab' : 'none';
    this.view.style.touchAction = 'none';
  }

  pos(e) {
    const r = this.view.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.view.width, y: ((e.clientY - r.top) / r.height) * this.view.height };
  }

  down(e) {
    // 두 번째 손가락 등은 무시 (선이 엉뚱하게 이어지는 것 방지)
    if (!e.isPrimary || this.drawing) return;
    e.preventDefault();
    this.view.setPointerCapture(e.pointerId);
    this.drawing = true;
    if (this.mode === 'pan') {
      this.panStart = { x: e.clientX, y: e.clientY, sl: this.wrap.scrollLeft, st: this.wrap.scrollTop };
      this.view.style.cursor = 'grabbing';
      return;
    }
    this.pushUndo();
    this.last = this.pos(e);
    this.stroke(this.last, this.last);
  }

  move(e) {
    if (!e.isPrimary) return;
    if (this.mode === 'pan') {
      if (this.drawing && this.panStart) {
        this.wrap.scrollLeft = this.panStart.sl - (e.clientX - this.panStart.x);
        this.wrap.scrollTop = this.panStart.st - (e.clientY - this.panStart.y);
      }
      return;
    }
    const p = this.pos(e);
    this.cursor = p;
    if (this.drawing) {
      this.stroke(this.last, p);
      this.last = p;
    } else this.paint();
  }

  up(e) {
    if (e && !e.isPrimary) return;
    if (!this.drawing) return;
    this.drawing = false;
    this.panStart = null;
    if (this.mode === 'pan') this.view.style.cursor = 'grab';
    this.onChange?.();
  }

  stroke(a, b) {
    const ctx = this.mask.getContext('2d');
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.brush;
    ctx.strokeStyle = '#fff';
    ctx.globalCompositeOperation = this.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y);
    ctx.stroke();
    ctx.restore();
    this.paint();
  }

  pushUndo() {
    this.undoStack.push(cloneCanvas(this.mask));
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.mask = prev;
    this.paint();
    this.onChange?.();
  }

  reset() {
    this.pushUndo();
    this.mask = cloneCanvas(this.initial);
    this.paint();
    this.onChange?.();
  }

  clearAll() {
    this.pushUndo();
    this.mask.getContext('2d').clearRect(0, 0, this.mask.width, this.mask.height);
    this.paint();
    this.onChange?.();
  }

  fillAll() {
    this.pushUndo();
    const ctx = this.mask.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.mask.width, this.mask.height);
    this.paint();
    this.onChange?.();
  }

  paint() {
    if (!this.src) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const ctx = this.vctx;
      const { width: w, height: h } = this.view;
      ctx.clearRect(0, 0, w, h);
      // 지워진 부분도 흐리게 보여서 복원할 곳을 찾기 쉽게
      ctx.globalAlpha = 0.22;
      ctx.drawImage(this.src, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(composite(this.src, this.mask, this.tmp ??= document.createElement('canvas')), 0, 0);
      if (this.cursor && this.mode !== 'pan') {
        ctx.beginPath();
        ctx.arc(this.cursor.x, this.cursor.y, this.brush / 2, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2, w / 500);
        ctx.strokeStyle = this.mode === 'erase' ? '#ff5a6e' : '#3ddc97';
        ctx.stroke();
      }
    });
  }
}
