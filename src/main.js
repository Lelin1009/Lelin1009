import templateUrl from './assets/template.jpg';
import { renderPoster, ensureFonts, alphaBounds } from './render.js';
import { loadImageToCanvas, autoMask, composite, MaskEditor } from './cutout.js';

const $ = (s) => document.querySelector(s);
const fields = ['title', 'en', 'zh', 'origin', 'size'];

const state = {
  template: null,
  src: null,      // 원본(축소된) 사진
  mask: null,     // 누끼 마스크
  cut: null,      // 배경 제거된 사진
  bounds: null,   // 돌이 있는 영역
  busy: false,
};

const poster = $('#poster');

// ---------- 렌더 ----------
let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const data = readFields();
  await ensureFonts([data.title, data.en, data.zh, data.origin, data.size, '산지 규격']);
  if (token !== renderToken) return;
  renderPoster(poster, {
    ...data,
    template: state.template,
    photo: state.cut ?? state.src,
    bounds: state.cut ? state.bounds : null,
    showZones: $('#zones').checked,
  });
  $('#empty').hidden = !!state.src;
}
const schedule = () => requestAnimationFrame(render);

function readFields() {
  return Object.fromEntries(fields.map((f) => [f, $('#' + f).value]));
}

// ---------- 사진 / 누끼 ----------
function setStatus(text, ratio, isError = false) {
  const box = $('#status');
  box.hidden = false;
  box.classList.toggle('error', isError);
  $('#status-text').textContent = text;
  $('#status-pct').textContent = ratio == null ? '' : `${Math.round(ratio * 100)}%`;
  $('#bar').style.width = `${Math.round((ratio ?? 0) * 100)}%`;
}

// 사진이 바뀔 때마다 번호를 올려서, 이전 사진의 누끼 결과가 늦게 도착해도 버림
let photoId = 0;

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const id = ++photoId;
  let src;
  try {
    src = await loadImageToCanvas(file);
  } catch (e) {
    if (id === photoId) setStatus('이 사진을 열 수 없습니다. JPG 또는 PNG로 다시 시도해 주세요.', null, true);
    return;
  }
  if (id !== photoId) return;
  state.src = src;
  state.mask = state.aiMask = state.cut = state.bounds = null;
  schedule();
  await runCutout();
}

function setBusy(busy) {
  state.busy = busy;
  $('#cut-btns').hidden = busy || !state.src;
  $('#btn-save').disabled = busy;
  $('#btn-share').disabled = busy;
}

// 이전 작업이 진행 중이면 끝난 뒤 최신 사진으로 다시 실행
let pending = false;
async function runCutout() {
  if (!state.src) return;
  if (state.busy) { pending = true; return; }
  const id = photoId;
  const src = state.src;
  setBusy(true);
  setStatus('누끼 AI 준비 중…', 0);
  try {
    const mask = await autoMask(src, ({ stage, ratio }) => {
      if (id !== photoId) return;
      if (stage === 'download') setStatus('AI 모델 내려받는 중 (처음 한 번만, 약 100MB)', ratio);
      else setStatus('배경 지우는 중…', ratio);
    });
    if (id === photoId) {
      state.aiMask = mask;
      applyMask(mask);
      setStatus('누끼 완료 · 남은 배경이 있으면 “누끼 수정”을 누르세요', 1);
    }
  } catch (e) {
    console.error(e);
    if (id === photoId) {
      setStatus('자동 누끼에 실패했습니다. “누끼 수정”에서 직접 지우거나 다시 시도해 주세요.', null, true);
      // 실패해도 손으로 작업할 수 있게 원본 전체를 마스크로
      const full = document.createElement('canvas');
      full.width = src.width;
      full.height = src.height;
      const c = full.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, full.width, full.height);
      state.mask = state.aiMask = full;
    }
  } finally {
    setBusy(false);
    if (pending || id !== photoId) {
      pending = false;
      if (id !== photoId && state.src) runCutout();
    }
  }
}

function applyMask(mask) {
  if (!state.src || mask.width !== state.src.width || mask.height !== state.src.height) return;
  state.mask = mask;
  state.cut = composite(state.src, mask);
  state.bounds = alphaBounds(state.cut);
  if (!state.bounds) state.cut = null; // 전부 지워진 경우 원본 표시
  schedule();
}

// ---------- 누끼 수정 화면 ----------
const editorEl = $('#editor');
const editor = new MaskEditor(editorEl);

function openEditor() {
  if (!state.src || !state.mask || state.busy) return;
  editorEl.hidden = false;
  document.body.style.overflow = 'hidden';
  editor.open(state.src, state.mask, state.aiMask ?? state.mask);
  editor.setMode(editorEl.querySelector('.seg .on').dataset.mode);
  $('#ed-zoom').value = 1;
  requestAnimationFrame(() => editor.setZoom(1));
}

function closeEditor(apply) {
  if (apply) applyMask(editor.mask);
  editorEl.hidden = true;
  document.body.style.overflow = '';
}

editorEl.querySelectorAll('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    editorEl.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    editor.setMode(b.dataset.mode);
  }),
);
$('#ed-brush').addEventListener('input', (e) => editor.setBrushPct(+e.target.value));
$('#ed-zoom').addEventListener('input', (e) => {
  const st = editor.wrap;
  const cx = (st.scrollLeft + st.clientWidth / 2) / st.scrollWidth;
  const cy = (st.scrollTop + st.clientHeight / 2) / st.scrollHeight;
  editor.setZoom(+e.target.value);
  st.scrollLeft = cx * st.scrollWidth - st.clientWidth / 2;
  st.scrollTop = cy * st.scrollHeight - st.clientHeight / 2;
});
$('#ed-undo').addEventListener('click', () => editor.undo());
$('#ed-reset').addEventListener('click', () => editor.reset());
$('#ed-all').addEventListener('click', () => editor.fillAll());
$('#ed-done').addEventListener('click', () => closeEditor(true));
window.addEventListener('resize', () => { if (!editorEl.hidden) editor.setZoom(editor.zoom); });
document.addEventListener('keydown', (e) => {
  if (editorEl.hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); editor.undo(); }
  if (e.key === 'Escape') closeEditor(true);
});

// ---------- 저장 ----------
function fileName() {
  const t = $('#title').value.trim().replace(/[\\/:*?"<>|\n]+/g, ' ') || '수석';
  return `${t}.png`;
}

async function exportBlob() {
  await render();
  const out = document.createElement('canvas');
  renderPoster(out, {
    ...readFields(),
    template: state.template,
    photo: state.cut ?? state.src,
    bounds: state.cut ? state.bounds : null,
    showZones: false,
  });
  return new Promise((res) => out.toBlob(res, 'image/png'));
}

$('#btn-save').addEventListener('click', async () => {
  const blob = await exportBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

// 폰: 공유 시트 → "이미지 저장"으로 사진 앱에 바로 저장
if (navigator.canShare?.({ files: [new File([''], 'a.png', { type: 'image/png' })] })) {
  $('#btn-share').hidden = false;
  $('#btn-share').addEventListener('click', async () => {
    const blob = await exportBlob();
    const file = new File([blob], fileName(), { type: 'image/png' });
    try { await navigator.share({ files: [file] }); } catch { /* 사용자가 취소 */ }
  });
}

$('#btn-new').addEventListener('click', () => {
  fields.forEach((f) => ($('#' + f).value = ''));
  photoId++; // 진행 중인 누끼 결과는 버림
  state.src = state.mask = state.aiMask = state.cut = state.bounds = null;
  $('#file').value = '';
  $('#status').hidden = true;
  $('#cut-btns').hidden = true;
  if (!editorEl.hidden) closeEditor(false);
  autoGrow();
  schedule();
  $('#title').focus();
});

// ---------- 입력 ----------
fields.forEach((f) => $('#' + f).addEventListener('input', schedule));
$('#zones').addEventListener('change', schedule);
$('#file').addEventListener('change', (e) => handleFile(e.target.files[0]));
$('#btn-edit').addEventListener('click', openEditor);
$('#btn-recut').addEventListener('click', runCutout);

const drop = $('#drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) handleFile(f);
});

// 여러 줄 입력칸 높이 자동 조절
function autoGrow() {
  document.querySelectorAll('textarea').forEach((t) => {
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  });
}
document.querySelectorAll('textarea').forEach((t) => t.addEventListener('input', autoGrow));

// ---------- 시작 ----------
const tpl = new Image();
tpl.onload = () => { state.template = tpl; schedule(); };
tpl.src = templateUrl;
autoGrow();
schedule();
document.fonts.ready.then(schedule);

// ---------- 앱(홈 화면 설치) ----------
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// 오프라인 저장소(서비스 워커): 한 번 연 뒤에는 인터넷 없이도 열림 (배포판에서만)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('서비스 워커 등록 실패', e));
}
// AI 모델(약 100MB)을 브라우저가 임의로 지우지 않도록 요청
navigator.storage?.persist?.().catch(() => {});

// 아이폰: 앱 안에서는 '다운로드'가 불편하므로 '사진 앱에 저장'을 주 버튼으로
if (isIOS && !$('#btn-share').hidden) {
  $('#btn-share').classList.add('primary');
  $('#btn-save').classList.remove('primary');
  $('#btn-share').parentElement.prepend($('#btn-share'));
}

const installBox = $('#install');
const dismissed = (() => { try { return localStorage.getItem('installDismissed') === '1'; } catch { return false; } })();
$('#btn-install-close').addEventListener('click', () => {
  installBox.hidden = true;
  try { localStorage.setItem('installDismissed', '1'); } catch { /* 무시 */ }
});

if (!isStandalone && !dismissed) {
  if (isIOS) {
    // 아이폰/아이패드는 Safari의 공유 버튼으로만 설치 가능
    $('#install-msg').innerHTML =
      'Safari 아래쪽 <svg class="share-ico" width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 11V1M4.5 4.5 8 1l3.5 3.5M3 7H1.8v10h12.4V7H13"/></svg> <b>공유</b> 버튼 → <b>홈 화면에 추가</b>를 누르세요.';
    installBox.hidden = false;
  }
  // 안드로이드·PC 크롬/엣지: 설치 버튼 표시
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const prompt = e;
    $('#btn-install').hidden = false;
    installBox.hidden = false;
    $('#btn-install').onclick = async () => {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') installBox.hidden = true;
    };
  });
}
window.addEventListener('appinstalled', () => { installBox.hidden = true; });

// 테스트/자동화용
window.__suseok = { state, render, handleFile, applyMask };
