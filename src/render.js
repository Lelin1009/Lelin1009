// 수석 안내판 렌더링
//  - 큰 사진형: 1200×1800 세로
//  - 작은 사진형: 1800×1200 인쇄용 (절취선 안 왼쪽 아래 칸이 안내판)
// 구역(zone)을 고정해 두고, 글자는 자기 구역 안에서만 줄이거나 줄바꿈합니다.
// → 제목이 길어도 사진 영역을 절대 침범하지 않습니다.

export const W = 1200;
export const H = 1800;

export const ZONES = {
  title: { x: 70, y: 240, w: 1060, h: 160 },   // 한국어 제목
  sub:   { x: 70, y: 415, w: 1060, h: 160 },   // 영어 / 중국어
  photo: { x: 80, y: 595, w: 1040, h: 1030 },  // 수석 사진
  info:  { x: 70, y: 1621, w: 1060, h: 100 },  // 산지 · 규격
};

const KR = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const SC = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

const STYLE = {
  title: { max: 130, min: 56, weight: 700, lh: 1.12 },
  sub:   { max: 68, min: 28, weight: 700, scWeight: 500, lh: 1.24, singleMin: 52, ls: -0.03 },
  info:  { max: 60, min: 34, weight: 700 },
};

// ---------- 글자 런(run): 한자는 Noto Sans SC, 나머지는 Pretendard ----------
const HAN = /[\p{Script=Han}　-〿！-｠]/u;

function toRuns(text) {
  const runs = [];
  for (const ch of text) {
    const sc = HAN.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.sc === sc) last.t += ch;
    else runs.push({ t: ch, sc });
  }
  return runs;
}

function fontFor(sc, size, weight, scWeight) {
  return sc ? `${scWeight ?? weight} ${size}px ${SC}` : `${weight} ${size}px ${KR}`;
}

// 자간: 지원하는 브라우저에서만 적용 (미지원 시 기본 자간 → 자동으로 크기 맞춤)
function setSpacing(ctx, size, st) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(st.ls ?? 0) * size}px`;
}

function measure(ctx, text, size, st) {
  setSpacing(ctx, size, st);
  let w = 0;
  for (const r of toRuns(text)) {
    ctx.font = fontFor(r.sc, size, st.weight, st.scWeight);
    w += ctx.measureText(r.t).width;
  }
  return w;
}

function drawLine(ctx, text, cx, baseline, size, st) {
  const total = measure(ctx, text, size, st);
  let x = cx - total / 2;
  setSpacing(ctx, size, st);
  for (const r of toRuns(text)) {
    ctx.font = fontFor(r.sc, size, st.weight, st.scWeight);
    ctx.fillText(r.t, x, baseline);
    x += ctx.measureText(r.t).width;
  }
}

// ---------- 줄바꿈 ----------
// 영어는 단어 단위, 중국어/한국어 붙은 글자는 글자 단위로 나눕니다.
function tokenize(text) {
  const tokens = [];
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    if (/^\s+$/.test(word)) { tokens.push(' '); continue; }
    if (HAN.test(word)) {
      // 한자 묶음은 글자마다 끊을 수 있게 (문장부호는 앞 글자에 붙임)
      let buf = '';
      for (const ch of word) {
        if (HAN.test(ch) && !/[，。、：；！？）」』】]/.test(ch) && buf) { tokens.push(buf); buf = ''; }
        buf += ch;
      }
      if (buf) tokens.push(buf);
    } else tokens.push(word);
  }
  return tokens;
}

function wrap(ctx, text, maxW, size, st) {
  const lines = [];
  let cur = '';
  for (const tok of tokenize(text)) {
    const next = cur + tok;
    if (cur && tok !== ' ' && measure(ctx, next.trimEnd(), size, st) > maxW) {
      lines.push(cur.trim());
      cur = tok === ' ' ? '' : tok;
    } else cur = next;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

const fits = (ctx, lines, size, st, z) =>
  lines.every((l) => measure(ctx, l, size, st) <= z.w) && lines.length * size * st.lh <= z.h + 0.5;

// 구역 안에 들어가는 가장 큰 글자 크기 + 줄 구성을 찾습니다.
function layoutTitle(ctx, text, z) {
  const st = STYLE.title;
  const hard = text.split('\n').map((s) => s.trim()).filter(Boolean);
  for (let s = st.max; s >= st.min; s -= 2) {
    if (fits(ctx, hard, s, st, z)) return { lines: hard, size: s };
    const wrapped = hard.flatMap((l) => wrap(ctx, l, z.w, s, st));
    if (s <= 96 && fits(ctx, wrapped, s, st, z)) return { lines: wrapped, size: s };
  }
  return { lines: hard.flatMap((l) => wrap(ctx, l, z.w, st.min, st)), size: st.min };
}

function layoutSub(ctx, en, zh, z) {
  const st = STYLE.sub;
  const parts = [en, zh].map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { lines: [], size: st.max };
  const manual = parts.some((p) => p.includes('\n'));
  // 1) 한 줄: "English / 中文" (조금 줄여서라도 한 줄이 되면 한 줄 우선)
  if (!manual) {
    const one = [parts.join(' / ')];
    for (let s = st.max; s >= st.singleMin; s -= 2) if (fits(ctx, one, s, st, z)) return { lines: one, size: s };
  }
  // 2) 여러 줄: 영어와 중국어는 각자 새 줄에서 시작, 길면 자동 줄바꿈
  const hard = parts.flatMap((p) => p.split('\n').map((s) => s.trim()).filter(Boolean));
  for (let s = st.max; s >= st.min; s -= 2) {
    const lines = hard.flatMap((l) => wrap(ctx, l, z.w, s, st));
    if (fits(ctx, lines, s, st, z)) return { lines, size: s };
  }
  return { lines: hard.flatMap((l) => wrap(ctx, l, z.w, st.min, st)), size: st.min };
}

function layoutInfo(ctx, text, z, st = STYLE.info) {
  for (let s = st.max; s >= st.min; s -= 2) if (measure(ctx, text, s, st) <= z.w) return { lines: [text], size: s };
  return { lines: [text], size: st.min };
}

// 블록을 구역 세로 가운데에 배치 (글자 모양과 상관없이 같은 기준선 사용)
function drawBlock(ctx, { lines, size }, z, st) {
  if (!lines.length) return;
  ctx.font = `${st.weight} ${size}px ${KR}`;
  const m = ctx.measureText('가H');
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  const lh = size * (st.lh ?? 1.2);
  const blockH = (lines.length - 1) * lh + asc + desc;
  let baseline = z.y + (z.h - blockH) / 2 + asc;
  for (const l of lines) {
    drawLine(ctx, l, z.x + z.w / 2, baseline, size, st);
    baseline += lh;
  }
}

// ---------- 사진 ----------
// 투명 배경을 잘라낸 실제 돌 영역(bounding box)
export function alphaBounds(canvas, threshold = 12) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function drawPhoto(ctx, src, bounds, z, opts) {
  const b = bounds ?? { x: 0, y: 0, w: src.width, h: src.height };
  const scale = Math.min(z.w / b.w, z.h / b.h) * (opts.scale ?? 1);
  const dw = b.w * scale;
  const dh = b.h * scale;
  const dx = z.x + (z.w - dw) / 2;
  const dy = z.y + (z.h - dh) / 2 + (opts.offsetY ?? 0);
  ctx.save();
  // 사진 크기를 키워도 사진 구역 밖(글자 구역)으로는 나가지 않게 자르기
  ctx.beginPath();
  ctx.rect(0, z.y, W, z.y + z.h <= H ? z.h : H - z.y);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, b.x, b.y, b.w, b.h, dx, dy, dw, dh);
  ctx.restore();
}

// ---------- 전체 ----------
export async function ensureFonts(texts) {
  const all = texts.join(' ');
  const jobs = [
    `700 60px "Pretendard"`,
  ].map((f) => document.fonts.load(f, all));
  if (HAN.test(all)) {
    const han = [...all].filter((c) => HAN.test(c)).join('');
    jobs.push(document.fonts.load(`500 60px "Noto Sans SC"`, han));
  }
  try { await Promise.all(jobs); } catch { /* 폰트 실패 시 대체 글꼴로 표시 */ }
}

const infoText = (d) => [
  d.origin?.trim() ? `산지:${d.origin.trim()}` : '',
  d.size?.trim() ? `규격:${d.size.trim()}` : '',
].filter(Boolean).join(' ');

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} d { layout: 'large'|'small', template, photo, bounds, title, en, zh, origin, size, showZones }
 */
export function renderPoster(canvas, d) {
  return d.layout === 'small' ? renderSmall(canvas, d) : renderLarge(canvas, d);
}

function renderLarge(canvas, d) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (d.template) ctx.drawImage(d.template, 0, 0, W, H);

  if (d.photo) drawPhoto(ctx, d.photo, d.bounds, ZONES.photo, d);

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  drawBlock(ctx, layoutTitle(ctx, d.title || '', ZONES.title), ZONES.title, STYLE.title);
  drawBlock(ctx, layoutSub(ctx, d.en || '', d.zh || '', ZONES.sub), ZONES.sub, STYLE.sub);

  const info = infoText(d);
  if (info) drawBlock(ctx, layoutInfo(ctx, info, ZONES.info), ZONES.info, { ...STYLE.info, lh: 1.2 });

  if (d.showZones) {
    ctx.save();
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 3;
    const colors = { title: '#4ea1ff', sub: '#3ddc97', photo: '#ffb020', info: '#ff6b8a' };
    for (const [k, z] of Object.entries(ZONES)) {
      ctx.strokeStyle = colors[k];
      ctx.strokeRect(z.x, z.y, z.w, z.h);
    }
    ctx.restore();
  }
}

// =====================================================================
// 작은 사진형 (1800×1200, 절취선 포함)
// 안내판 칸: x 0~1198, y 336~1200. 로고는 템플릿에 포함(y 375~478).
// 왼쪽 = 수석 사진(좌대 바닥 맞춤), 오른쪽 = 한국어 제목 → 중국어 → 영어, 아래 = 산지·규격
// =====================================================================
export const SW = 1800;
export const SH = 1200;

export const SMALL_ZONES = {
  photo: { x: 40, y: 500, w: 430, h: 625 },   // 수석 사진 (아래 맞춤)
  text:  { x: 490, y: 500, w: 680, h: 530 },  // 제목·중국어·영어
  info:  { x: 490, y: 1040, w: 680, h: 90 },  // 산지 · 규격
};

const SMALL_STYLE = {
  title: { max: 104, min: 50, weight: 700, lh: 1.16 },
  sub:   { max: 46, min: 22, weight: 700, scWeight: 500, lh: 1.32, ls: -0.02 },
  info:  { max: 50, min: 30, weight: 700 },
};

// 줄 수는 그대로 두고 각 줄 길이가 비슷해지도록 나눔 (수고하고 짐진자 / 다 내게로 오라)
function balancedWrap(ctx, text, maxW, size, st) {
  const greedy = wrap(ctx, text, maxW, size, st);
  if (greedy.length <= 1) return greedy;
  let lo = maxW * 0.4;
  let hi = maxW;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(ctx, text, mid, size, st).length <= greedy.length) hi = mid;
    else lo = mid;
  }
  return wrap(ctx, text, hi, size, st);
}

// 중국어: 쉼표·마침표 단위로 먼저 줄을 나눔 (凡劳苦担重担的人可以到我这里来 / 我就使你们得安息)
function wrapChinese(ctx, text, maxW, size, st) {
  const clauses = text.match(/[^，、；。,;]+[，、；。,;]?/gu) ?? [text];
  if (clauses.length > 1 && clauses.every((c) => measure(ctx, c.replace(/[，、；,;]$/u, ''), size, st) <= maxW)) {
    const lines = [];
    let cur = '';
    for (const c of clauses) {
      const next = cur + c;
      if (cur && measure(ctx, next.replace(/[，、；,;]$/u, ''), size, st) > maxW) {
        lines.push(cur);
        cur = c;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines.map((l) => l.trim().replace(/[，、；,;]$/u, ''));
  }
  return balancedWrap(ctx, text, maxW, size, st);
}

function wrapAll(ctx, text, maxW, size, st, zh = false) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => (zh ? wrapChinese(ctx, l, maxW, size, st) : balancedWrap(ctx, l, maxW, size, st)));
}

function layoutSmallText(ctx, d, z) {
  const T = SMALL_STYLE.title;
  const S = SMALL_STYLE.sub;
  const title = (d.title || '').trim();
  const zh = (d.zh || '').trim();
  const en = (d.en || '').trim();
  const manualTitleLines = title ? title.split('\n').filter((l) => l.trim()).length : 0;
  let best = null;
  for (let k = 1; k >= 0.4; k -= 0.02) {
    const ts = Math.max(T.min, Math.round(T.max * k));
    const ss = Math.max(S.min, Math.round(S.max * Math.min(1, k * 1.05)));
    const tl = title ? wrapAll(ctx, title, z.w, ts, T) : [];
    const zl = zh ? wrapAll(ctx, zh, z.w, ss, S, true) : [];
    const el = en ? wrapAll(ctx, en, z.w, ss, S) : [];
    const gap1 = tl.length && (zl.length || el.length) ? ss * 0.55 : 0;
    const gap2 = zl.length && el.length ? ss * 0.25 : 0;
    const h = tl.length * ts * T.lh + gap1 + zl.length * ss * S.lh + gap2 + el.length * ss * S.lh;
    const widthOk = tl.every((l) => measure(ctx, l, ts, T) <= z.w)
      && [...zl, ...el].every((l) => measure(ctx, l, ss, S) <= z.w);
    best = { tl, zl, el, ts, ss, gap1, gap2, h };
    // 제목은 되도록 2줄 이내 (직접 Enter로 나눈 경우는 그대로)
    const titleOk = tl.length <= Math.max(2, manualTitleLines) || ts <= 64;
    if (widthOk && h <= z.h && titleOk) return best;
  }
  return best;
}

function drawLines(ctx, lines, cx, top, size, st) {
  ctx.font = `${st.weight} ${size}px ${KR}`;
  const m = ctx.measureText('가H');
  const lh = size * st.lh;
  // 줄 높이 안에서 글자를 세로 가운데로
  const pad = (lh - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) / 2;
  let y = top;
  for (const l of lines) {
    drawLine(ctx, l, cx, y + pad + m.actualBoundingBoxAscent, size, st);
    y += lh;
  }
  return y;
}

function drawSmallPhoto(ctx, src, bounds, z) {
  const b = bounds ?? { x: 0, y: 0, w: src.width, h: src.height };
  const scale = Math.min(z.w / b.w, z.h / b.h);
  const dw = b.w * scale;
  const dh = b.h * scale;
  const dx = z.x + (z.w - dw) / 2;
  const dy = z.y + z.h - dh; // 좌대 바닥을 아래에 맞춤
  ctx.save();
  ctx.beginPath();
  ctx.rect(z.x, z.y, z.w, z.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, b.x, b.y, b.w, b.h, dx, dy, dw, dh);
  ctx.restore();
}

function renderSmall(canvas, d) {
  canvas.width = SW;
  canvas.height = SH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SW, SH);
  if (d.template) ctx.drawImage(d.template, 0, 0, SW, SH);
  const Z = SMALL_ZONES;

  if (d.photo) drawSmallPhoto(ctx, d.photo, d.bounds, Z.photo);

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  const L = layoutSmallText(ctx, d, Z.text);
  const cx = Z.text.x + Z.text.w / 2;
  // 글 묶음은 칸 안에서 세로 가운데
  let y = Z.text.y + Math.max(0, (Z.text.h - L.h) / 2);
  y = drawLines(ctx, L.tl, cx, y, L.ts, SMALL_STYLE.title) + L.gap1;
  y = drawLines(ctx, L.zl, cx, y, L.ss, SMALL_STYLE.sub) + L.gap2;
  drawLines(ctx, L.el, cx, y, L.ss, SMALL_STYLE.sub);

  const info = infoText(d);
  if (info) drawBlock(ctx, layoutInfo(ctx, info, Z.info, SMALL_STYLE.info), Z.info, { ...SMALL_STYLE.info, lh: 1.2 });

  if (d.showZones) {
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    const colors = { photo: '#ffb020', text: '#4ea1ff', info: '#ff6b8a' };
    for (const [k, z] of Object.entries(Z)) {
      ctx.strokeStyle = colors[k];
      ctx.strokeRect(z.x, z.y, z.w, z.h);
    }
    ctx.restore();
  }
}
