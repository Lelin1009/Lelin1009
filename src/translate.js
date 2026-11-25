// 한국어 수석 이름 → 영어 / 중국어(간체) 제목
// engine: 'google' (무료, 설정 없음) | 'gemini' (무료 키 필요, 더 자연스러운 AI 번역)

// ---------- 무료: Google 번역 ----------
const BUSY_MSG = '무료 번역 서버가 잠시 응답하지 않습니다. 잠시 뒤 “다시 번역”을 누르거나, 번역 설정에서 Gemini 번역을 쓰거나, 직접 입력해 주세요.';

async function googleOnce(text, tl) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.search = new URLSearchParams({ client: 'gtx', sl: 'ko', tl, dt: 't', q: text });
  const res = await fetch(url);
  if (!res.ok) throw new Error(BUSY_MSG);
  const data = await res.json();
  const out = (data?.[0] ?? []).map((s) => s?.[0] ?? '').join('').trim();
  if (!out) throw new Error(BUSY_MSG);
  return out;
}

// 무료 서버는 요청이 몰리면 잠깐 막히므로 한 번 더 시도
async function googleOne(text, tl) {
  try {
    return await googleOnce(text, tl);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await googleOnce(text, tl);
    } catch {
      throw new Error(BUSY_MSG);
    }
  }
}

// 제목 표기: 주요 단어 첫 글자 대문자 (Eagle Hunting for Prey)
const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'of', 'in', 'on', 'at', 'to', 'by', 'with', 'from', 'as', 'into', 'over']);
export function titleCase(s) {
  const words = s.trim().replace(/[.。]+$/u, '').split(/(\s+)/);
  let idx = 0;
  const count = words.filter((w) => w.trim()).length;
  return words
    .map((w) => {
      if (!w.trim()) return w;
      const i = idx++;
      const lower = w.toLowerCase();
      if (i !== 0 && i !== count - 1 && SMALL.has(lower)) return lower;
      // 이미 대문자 약어(USA 등)는 유지
      if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
      return lower.replace(/^(\p{L})/u, (c) => c.toUpperCase()).replace(/-(\p{L})/gu, (m, c) => `-${c.toUpperCase()}`);
    })
    .join('');
}

async function viaGoogle(title) {
  const [en, zh] = await Promise.all([googleOne(title, 'en'), googleOne(title, 'zh-CN')]);
  return { en: titleCase(en), zh: zh.replace(/[。．.！!]+$/u, '') };
}

// ---------- AI: Google Gemini (무료 키) ----------
const SYSTEM = `You translate titles of suseok (Korean viewing stones, 수석) for museum exhibition labels at the Suncheon World Suseok Museum.
Each title names what the stone's shape or pattern evokes (a landscape, an animal, a figure, a season).

Return two titles as JSON:
- en: a natural English exhibition title in Title Case. Concise, evocative, faithful to the Korean imagery. No trailing period, no quotation marks.
- zh: a natural Simplified Chinese exhibition title, literary but plain, usually 4 to 10 characters. No trailing punctuation.

Keep the imagery of the original (for example, 첩첩산중 means layer upon layer of mountains, not just "mountains").
Do not add explanations.

Example:
Korean: 먹잇감을 찾는 독수리
{"en": "Eagle Hunting for Prey", "zh": "觅食的雄鹰"}`;

const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_KEY = 'geminiModel';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 무시 */ } },
};

class GeminiError extends Error {}

async function geminiFetch(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new GeminiError('인터넷 연결을 확인해 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const err = data?.error ?? {};
  const reason = (err.details ?? []).map((d) => d?.reason).find(Boolean);
  const e = new GeminiError(
    reason === 'API_KEY_INVALID' || /API key not valid/i.test(err.message ?? '')
      ? 'Gemini 키가 올바르지 않습니다. 번역 설정에서 키를 끝까지 복사해 넣었는지 확인해 주세요.'
      : res.status === 429
        ? '오늘 Gemini 무료 사용량을 다 썼거나 너무 빨리 요청했습니다. 잠시 뒤 다시 시도하거나 무료 번역으로 바꿔 주세요.'
        : res.status === 403
          ? '이 키로는 Gemini를 쓸 수 없습니다. Google AI Studio에서 키를 새로 만들어 주세요.'
          : `Gemini 오류 (${res.status}): ${err.message ?? '알 수 없는 오류'}`,
  );
  e.status = res.status;
  e.reason = reason;
  throw e;
}

// 키로 쓸 수 있는 모델 중 빠른 'Flash' 모델을 자동으로 고름 (모델 이름이 바뀌어도 계속 동작)
export function pickModel(models) {
  const usable = models.filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent') && /^models\/gemini-/.test(m.name));
  const names = usable.map((m) => m.name);
  if (names.includes('models/gemini-flash-latest')) return 'models/gemini-flash-latest';
  const skip = /(lite|image|tts|audio|live|vision|embedding|exp|preview|thinking|-\d{3,})/;
  const ver = (n) => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0');
  const flash = names.filter((n) => /flash/.test(n) && !skip.test(n)).sort((a, b) => ver(b) - ver(a));
  if (flash.length) return flash[0];
  const anyFlash = names.filter((n) => /flash/.test(n) && !/(image|tts|audio|live|embedding)/.test(n)).sort((a, b) => ver(b) - ver(a));
  return anyFlash[0] ?? names[0] ?? null;
}

async function getModel(apiKey, { refresh = false } = {}) {
  const cached = store.get(MODEL_KEY);
  if (cached && !refresh) return cached;
  const data = await geminiFetch(`${API}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
  const model = pickModel(data.models ?? []);
  if (!model) throw new GeminiError('이 키로 쓸 수 있는 Gemini 모델을 찾지 못했습니다.');
  store.set(MODEL_KEY, model);
  return model;
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* 아래에서 다시 시도 */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new GeminiError('Gemini 응답을 읽지 못했습니다. 다시 번역을 눌러 주세요.');
}

async function generate(apiKey, model, title, withSchema) {
  const generationConfig = { responseMimeType: 'application/json' };
  if (withSchema) {
    generationConfig.responseSchema = {
      type: 'OBJECT',
      properties: { en: { type: 'STRING' }, zh: { type: 'STRING' } },
      required: ['en', 'zh'],
    };
  }
  const data = await geminiFetch(`${API}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: `Korean: ${title}` }] }],
      generationConfig,
    }),
  });
  if (data.promptFeedback?.blockReason) throw new GeminiError('Gemini가 이 제목의 번역을 거절했습니다. 무료 번역으로 바꾸거나 직접 입력해 주세요.');
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text) {
    if (cand?.finishReason === 'SAFETY') throw new GeminiError('Gemini가 이 제목의 번역을 거절했습니다. 무료 번역으로 바꾸거나 직접 입력해 주세요.');
    throw new GeminiError('Gemini가 빈 응답을 보냈습니다. 다시 번역을 눌러 주세요.');
  }
  return parseJson(text);
}

async function viaGemini(title, apiKey) {
  if (!apiKey) throw new Error('Gemini 번역을 쓰려면 번역 설정에 무료 키를 넣어 주세요.');
  let model = await getModel(apiKey);
  let data;
  try {
    data = await generate(apiKey, model, title, true);
  } catch (e) {
    if (!(e instanceof GeminiError)) throw e;
    if (e.status === 404) {
      // 저장해 둔 모델이 없어진 경우 → 새로 골라서 재시도
      model = await getModel(apiKey, { refresh: true });
      data = await generate(apiKey, model, title, true);
    } else if (e.status === 400 && e.reason !== 'API_KEY_INVALID') {
      // 모델이 형식 지정(schema)을 지원하지 않는 경우 → 형식 없이 재시도
      data = await generate(apiKey, model, title, false);
    } else throw e;
  }
  const en = String(data.en ?? '').trim().replace(/^["“]|["”]$/g, '').replace(/[.。]+$/u, '');
  const zh = String(data.zh ?? '').trim().replace(/^["“「]|["”」]$/g, '').replace(/[。．.！!]+$/u, '');
  if (!en && !zh) throw new GeminiError('Gemini 응답을 읽지 못했습니다. 다시 번역을 눌러 주세요.');
  return { en, zh };
}

export function forgetGeminiModel() {
  store.set(MODEL_KEY, null);
}

export async function translateTitle(title, { engine = 'google', apiKey } = {}) {
  const t = title.trim();
  if (!t) return { en: '', zh: '' };
  return engine === 'gemini' ? viaGemini(t, apiKey) : viaGoogle(t);
}
