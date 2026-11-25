// 붙여넣은 글 → { title, origin, size, en, zh }
// 지원하는 형태 (줄바꿈이 있어도, 한 줄로 이어 써도 됨):
//   안개낀 첩첩산중
//   산지:한국
//   규격:380*370*140
//   안개낀 첩첩산중 산지:한국 규격:380x370x140

const KEYS = {
  title: ['제목', '이름', '명칭', '작품명', '석명'],
  origin: ['산지', '원산지', '산출지', '출처'],
  size: ['규격', '크기', '사이즈', '치수'],
  en: ['영어', '영문', '영문명', '영어제목', 'English', 'EN'],
  zh: ['중국어', '중문', '중문명', '중국어제목', 'Chinese', '中文', 'ZH'],
};

const ALL = Object.entries(KEYS).flatMap(([field, words]) => words.map((w) => [w, field]));
// 긴 단어부터 맞춰야 '영문명'이 '영문'으로 잘리지 않음
ALL.sort((a, b) => b[0].length - a[0].length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEY_RE = new RegExp(`(${ALL.map(([w]) => esc(w)).join('|')})\\s*[:：]`, 'giu');
// 산지·규격은 콜론 없이 "산지 한국"처럼 써도 인식 (줄 맨 앞일 때만)
const LOOSE_RE = /^(산지|원산지|규격|크기)\s+(.+)$/u;

const fieldOf = (word) => ALL.find(([w]) => w.toLowerCase() === word.toLowerCase())?.[1];

export function normalizeSize(s) {
  const t = s.trim().replace(/[，,。.]+$/u, '');
  // 380 x 370 x 140 / 380×370×140 / 380＊370＊140 (mm, cm 단위 허용) → 380*370*140
  const m = t.match(/^(\d+(?:\.\d+)?(?:\s*[xX×✕＊*]\s*\d+(?:\.\d+)?)+)\s*(mm|cm|㎜|㎝)?$/u);
  if (!m) return t;
  return m[1].split(/\s*[xX×✕＊*]\s*/u).join('*') + (m[2] ?? '');
}

const clean = (s) => s.trim().replace(/^[\s,，/|·:：-]+|[\s,，/|·-]+$/gu, '').trim();

export function parseQuick(text) {
  const out = {};
  if (!text?.trim()) return out;
  // "키:" 앞에서 줄을 나눠 한 줄 입력도 처리
  const lines = text
    .replace(/\r/g, '')
    .replace(KEY_RE, '\n$1:')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const free = [];
  for (const line of lines) {
    const m = line.match(/^([^:：]+?)\s*[:：]\s*(.*)$/u);
    const f = m && fieldOf(m[1].trim());
    if (f) {
      const v = clean(m[2]);
      if (v) out[f] = out[f] ? `${out[f]} ${v}` : v;
      continue;
    }
    const loose = line.match(LOOSE_RE);
    if (loose && free.length) {
      out[fieldOf(loose[1])] = clean(loose[2]);
      continue;
    }
    free.push(clean(line));
  }
  // 키가 없는 첫 줄 = 한국어 제목
  if (!out.title && free.length) out.title = free.shift();
  if (out.size) out.size = normalizeSize(out.size);
  return out;
}
