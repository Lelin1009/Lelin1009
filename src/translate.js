// 한국어 수석 이름 → 영어 / 중국어(간체) 제목
// engine: 'google' (무료, 설정 없음) | 'claude' (API 키 필요, 더 자연스러운 번역)

// ---------- 무료: Google 번역 ----------
const BUSY_MSG = '무료 번역 서버가 잠시 응답하지 않습니다. 잠시 뒤 “다시 번역”을 누르거나, 번역 설정에서 Claude 번역을 쓰거나, 직접 입력해 주세요.';

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

// ---------- 고급: Claude ----------
const SYSTEM = `You translate titles of suseok (Korean viewing stones, 수석) for museum exhibition labels at the Suncheon World Suseok Museum.
Each title names what the stone's shape or pattern evokes (a landscape, an animal, a figure, a season).

Return two titles:
- en: a natural English exhibition title in Title Case. Concise, evocative, faithful to the Korean imagery. No trailing period, no quotation marks.
- zh: a natural Simplified Chinese exhibition title, literary but plain, usually 4 to 10 characters. No trailing punctuation.

Keep the imagery of the original (for example, 첩첩산중 means layer upon layer of mountains, not just "mountains").
Do not add explanations.

Examples:
먹잇감을 찾는 독수리 → en: Eagle Hunting for Prey, zh: 觅食的雄鹰`;

const SCHEMA = {
  type: 'object',
  properties: {
    en: { type: 'string', description: 'English exhibition title in Title Case' },
    zh: { type: 'string', description: 'Simplified Chinese exhibition title' },
  },
  required: ['en', 'zh'],
  additionalProperties: false,
};

async function viaClaude(title, apiKey) {
  if (!apiKey) throw new Error('Claude 번역을 쓰려면 번역 설정에 API 키를 넣어 주세요.');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // 키는 이 기기 브라우저에만 저장되고, Anthropic 서버로만 전송됩니다.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: title }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API 키가 올바르지 않습니다. 번역 설정에서 키를 확인해 주세요.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('이 API 키로는 사용할 수 없습니다. 키 권한을 확인해 주세요.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('인터넷 연결을 확인해 주세요.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude 오류 (${e.status ?? '연결'}): ${e.message}`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude가 이 제목의 번역을 거절했습니다. 무료 번역으로 바꾸거나 직접 입력해 주세요.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = JSON.parse(text);
  return { en: String(data.en ?? '').trim().replace(/[.。]+$/u, ''), zh: String(data.zh ?? '').trim().replace(/[。．.！!]+$/u, '') };
}

export async function translateTitle(title, { engine = 'google', apiKey } = {}) {
  const t = title.trim();
  if (!t) return { en: '', zh: '' };
  return engine === 'claude' ? viaClaude(t, apiKey) : viaGoogle(t);
}
