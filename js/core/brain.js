// «Мозг» (ИИ): OpenAI-совместимый API (ProxyAPI или свой адрес).
// Вызывается ТОЛЬКО если включён, есть согласие и ключ. В ИИ уходит только текст фразы и сегодняшняя дата.
// ИИ возвращает вызовы функций, действие выполняет приложение.
// Сверено по proxyapi.ru/docs 2026-11-18: адрес https://api.proxyapi.ru/v1, модели «вендор/модель»,
// GET /models, POST /audio/transcriptions (multipart), ошибки 400/401/402/403/404/429/502/504.
import { WEEKDAYS, fromISO, isISO, isValidTime } from './dates.js';

export const PROVIDERS = {
  proxyapi: { name: 'ProxyAPI', baseUrl: 'https://api.proxyapi.ru/v1' },
  custom: { name: 'Свой адрес', baseUrl: '' },
};

// Подсказки, если список моделей не получен (названия из документации ProxyAPI, цены — в кабинете).
export const MODEL_HINTS = ['openai/gpt-5-mini', 'google/gemini-2.5-flash', 'anthropic/claude-haiku-4-5'];
export const TRANSCRIBE_HINTS = ['openai/gpt-4o-mini-transcribe', 'openai/gpt-4o-transcribe'];

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Создать задачу в списке дел.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Короткая формулировка задачи, глагол в начале.' },
          due: { type: 'string', description: 'Дата ГГГГ-ММ-ДД. Только если срок назван явно.' },
          time: { type: 'string', description: 'Время ЧЧ:ММ. Только если названо явно.' },
          object: { type: 'string', description: 'Объект/адрес/клиент, если назван.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Отметить задачу выполненной.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Слова из названия задачи.' } },
        required: ['query'],
      },
    },
  },
];

export function systemPrompt(today) {
  const wd = WEEKDAYS[fromISO(today).getDay()];
  return [
    'Ты разбираешь надиктованные заметки плиточника-отделочника и превращаешь их в вызовы функций.',
    `Сегодня ${today} (${wd}). Относительные даты считай от сегодня.`,
    'Одна заметка может содержать несколько задач — вызови create_task для каждой.',
    'Не выдумывай сроки, время, объекты, цифры и имена: если их нет в тексте, не передавай поле.',
    'Если человек говорит, что что-то сделано, вызови complete_task.',
  ].join('\n');
}

export function brainReady(settings, secrets) {
  const b = settings.brain;
  if (!b.enabled) return { ok: false, reason: 'off' };
  if (!b.consent) return { ok: false, reason: 'no_consent' };
  if (!secrets.apiKey) return { ok: false, reason: 'no_key' };
  if (!b.baseUrl) return { ok: false, reason: 'no_url' };
  return { ok: true };
}

export const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

export function validateCommands(calls) {
  const out = [];
  for (const c of calls) {
    const a = c.args || {};
    if (c.name === 'create_task') {
      const title = typeof a.title === 'string' ? a.title.trim().slice(0, 200) : '';
      if (!title) continue;
      out.push({
        type: 'add',
        title,
        due: isISO(a.due) ? a.due : null,
        time: isValidTime(a.time) ? a.time : null,
        object: typeof a.object === 'string' && a.object.trim() ? a.object.trim().slice(0, 80) : null,
        via: 'ai',
      });
    } else if (c.name === 'complete_task') {
      const q = typeof a.query === 'string' ? a.query.trim().slice(0, 200) : '';
      if (q) out.push({ type: 'done', query: q });
    }
  }
  return out;
}

export function extractToolCalls(json) {
  const calls = json?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.map((c) => {
    let args = {};
    try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* пусто */ }
    return { name: c.function?.name, args };
  });
}

// Понятная причина ошибки по коду ответа (коды — по proxyapi.ru/docs/errors).
export function describeHttp(status, json) {
  const detail = json?.detail || json?.error?.message || '';
  const tail = detail ? ` — ${String(detail).slice(0, 160)}` : '';
  if (status === 401) return `Ключ не принят (401). Проверьте, что он вставлен целиком${tail}`;
  if (status === 402) return `Не хватает баланса или исчерпан бюджет ключа (402). Пополните в кабинете${tail}`;
  if (status === 403) return `Эта модель или адрес запрещены для ключа (403). Проверьте ограничения ключа в кабинете${tail}`;
  if (status === 404) return `Модель не найдена (404). Выберите другую модель${tail}`;
  if (status === 429) return `Слишком много запросов (429). Попробуйте через минуту${tail}`;
  if (status === 400) return `Запрос не принят (400)${tail}`;
  if (status >= 500) return `Сервис провайдера недоступен (${status}). Попробуйте позже${tail}`;
  return `Ошибка ${status}${tail}`;
}

export const NETWORK_TEXT = 'Нет связи с провайдером. Если интернет есть — браузер мог запретить запрос (CORS), тогда нужен прокси';

async function request(fetchImpl, url, key, { method = 'POST', body, signal } = {}) {
  const headers = { Authorization: `Bearer ${key}` };
  if (body !== undefined && !(body instanceof FormDataCtor())) headers['Content-Type'] = 'application/json';
  const res = await fetchImpl(url, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormDataCtor() ? body : JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

// FormData есть в браузере и в node 18+; заглушка, чтобы instanceof не падал там, где его нет.
function FormDataCtor() {
  return typeof FormData === 'undefined' ? class NoFormData {} : FormData;
}

function withTimeout(ms) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  return { signal: ctl?.signal, done: () => timer && clearTimeout(timer) };
}

const failure = (e) =>
  e?.name === 'AbortError'
    ? { ok: false, reason: 'timeout', message: 'Провайдер не ответил вовремя' }
    : { ok: false, reason: 'network', message: NETWORK_TEXT };

// → {ok:true, commands} | {ok:false, reason, message?}
export async function askBrain({ settings, secrets, text, today, fetchImpl = globalThis.fetch, timeoutMs = 25000 }) {
  const ready = brainReady(settings, secrets);
  if (!ready.ok) return { ok: false, reason: ready.reason };
  const b = settings.brain;
  const url = `${trimUrl(b.baseUrl)}/chat/completions`;
  // temperature не передаём: часть моделей (рассуждающие) принимает только значение по умолчанию.
  const base = {
    model: b.model,
    messages: [
      { role: 'system', content: systemPrompt(today) },
      { role: 'user', content: String(text).slice(0, 4000) },
    ],
    tools: TOOLS,
  };
  const t = withTimeout(timeoutMs);
  try {
    let r = await request(fetchImpl, url, secrets.apiKey, { body: { ...base, tool_choice: 'required' }, signal: t.signal });
    if (r.status === 400) r = await request(fetchImpl, url, secrets.apiKey, { body: { ...base, tool_choice: 'auto' }, signal: t.signal });
    if (!r.ok) return { ok: false, reason: 'http', status: r.status, message: describeHttp(r.status, r.json) };
    const commands = validateCommands(extractToolCalls(r.json));
    if (!commands.length) return { ok: false, reason: 'empty', message: 'ИИ не нашёл в тексте задач' };
    return { ok: true, commands };
  } catch (e) {
    return failure(e);
  } finally {
    t.done();
  }
}

// Отделяем модели для текста от моделей для голоса; лишнее (картинки, эмбеддинги, озвучка) прячем.
const NOT_CHAT = /(embed|whisper|transcri|tts|speech|dall-e|image|imagen|moderation|realtime|rerank|sora|veo|search|audio|vision-preview|-diarize)/i;
const TRANSCRIBE = /(transcri|whisper)/i;

export function splitModels(ids) {
  const uniq = [...new Set(ids.filter((x) => typeof x === 'string' && x.trim()))].sort((a, b) => a.localeCompare(b));
  return {
    chat: uniq.filter((id) => !NOT_CHAT.test(id)),
    transcribe: uniq.filter((id) => TRANSCRIBE.test(id) && !/diarize/i.test(id)),
  };
}

// GET {адрес}/models → {ok, chat[], transcribe[]} | {ok:false, message}
export async function listModels({ settings, secrets, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!secrets.apiKey) return { ok: false, message: 'Сначала сохраните ключ' };
  if (!settings.brain.baseUrl) return { ok: false, message: 'Не указан адрес провайдера' };
  const t = withTimeout(timeoutMs);
  try {
    const r = await request(fetchImpl, `${trimUrl(settings.brain.baseUrl)}/models`, secrets.apiKey, { method: 'GET', signal: t.signal });
    if (!r.ok) return { ok: false, message: describeHttp(r.status, r.json) };
    const ids = Array.isArray(r.json?.data) ? r.json.data.map((m) => m?.id) : [];
    if (!ids.length) return { ok: false, message: 'Провайдер не вернул список моделей' };
    return { ok: true, ...splitModels(ids) };
  } catch (e) {
    return failure(e);
  } finally {
    t.done();
  }
}

// «Проверить подключение»: маленький запрос к выбранной модели.
export async function pingBrain({ settings, secrets, fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
  const b = settings.brain;
  if (!secrets.apiKey) return { ok: false, message: 'Нет ключа: вставьте его и нажмите «Сохранить»' };
  if (!b.baseUrl) return { ok: false, message: 'Не указан адрес провайдера' };
  if (!b.model) return { ok: false, message: 'Не выбрана модель для текста' };
  const t = withTimeout(timeoutMs);
  try {
    const r = await request(fetchImpl, `${trimUrl(b.baseUrl)}/chat/completions`, secrets.apiKey, {
      body: { model: b.model, messages: [{ role: 'user', content: 'Ответь одним словом: ок' }] },
      signal: t.signal,
    });
    if (r.ok) return { ok: true, message: `Работает: ${b.model}` };
    return { ok: false, message: describeHttp(r.status, r.json) };
  } catch (e) {
    return failure(e);
  } finally {
    t.done();
  }
}

export const REASON_TEXT = {
  off: 'ИИ выключен',
  no_consent: 'Нет согласия на отправку',
  no_key: 'Не указан ключ',
  no_url: 'Не указан адрес провайдера',
  http: 'Ошибка сервера ИИ',
  empty: 'ИИ не нашёл задач',
  timeout: 'ИИ не ответил вовремя',
  network: 'Нет связи с ИИ',
};
