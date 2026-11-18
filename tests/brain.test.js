import test from 'node:test';
import assert from 'node:assert/strict';
import { askBrain, brainReady, validateCommands, extractToolCalls, pingBrain, listModels, describeHttp } from '../js/core/brain.js';
import { interpret } from '../js/core/assistant.js';
import { DEFAULT_SETTINGS } from '../js/core/store.js';

const TODAY = '2026-11-18';
const settings = (over = {}) => ({ brain: { ...DEFAULT_SETTINGS.brain, ...over } });
const KEY = { apiKey: 'sk-test' };

const spyFetch = (reply) => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: reply.status === undefined || reply.status < 400, status: reply.status ?? 200, text: async () => JSON.stringify(reply.json ?? {}) };
  };
  f.calls = calls;
  return f;
};
const toolReply = (...calls) => ({ json: { choices: [{ message: { tool_calls: calls.map((c) => ({ function: { name: c[0], arguments: JSON.stringify(c[1]) } })) } }] } });

test('режим выключен / нет согласия / нет ключа → запроса в сеть НЕТ', async () => {
  for (const [s, k, reason] of [
    [settings({ enabled: false, consent: true }), KEY, 'off'],
    [settings({ enabled: true, consent: false }), KEY, 'no_consent'],
    [settings({ enabled: true, consent: true }), { apiKey: '' }, 'no_key'],
  ]) {
    const f = spyFetch(toolReply());
    const r = await askBrain({ settings: s, secrets: k, text: 'что-то', today: TODAY, fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
    assert.equal(f.calls.length, 0);
  }
});

test('успешный разбор: несколько задач, мусор отбрасывается', async () => {
  const f = spyFetch(toolReply(
    ['create_task', { title: 'Заказать плитку', due: '2026-11-21', object: 'Ленина 5' }],
    ['create_task', { title: 'Позвонить', due: 'послезавтра', time: '25:99' }],
    ['create_task', { title: '   ' }],
    ['complete_task', { query: 'клей' }],
    ['unknown_fn', {}],
  ));
  const r = await askBrain({ settings: settings({ enabled: true, consent: true }), secrets: KEY, text: 'длинная диктовка', today: TODAY, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.commands.length, 3);
  assert.equal(r.commands[1].due, null);
  assert.equal(r.commands[1].time, null);
  assert.equal(f.calls[0].url, 'https://api.proxyapi.ru/v1/chat/completions');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer sk-test');
  assert.equal(f.calls[0].body.tool_choice, 'required');
  // в ИИ уходит только текст и дата — никаких задач и списков
  assert.deepEqual(f.calls[0].body.messages.map((m) => m.role), ['system', 'user']);
});

test('HTTP-ошибка и пустой ответ', async () => {
  const on = settings({ enabled: true, consent: true });
  const r1 = await askBrain({ settings: on, secrets: KEY, text: 'x', today: TODAY, fetchImpl: spyFetch({ status: 401, json: { error: { message: 'bad key' } } }) });
  assert.equal(r1.reason, 'http');
  assert.match(r1.message, /401/);
  assert.match(r1.message, /Ключ не принят/);
  const r2 = await askBrain({ settings: on, secrets: KEY, text: 'x', today: TODAY, fetchImpl: spyFetch({ json: { choices: [{ message: {} }] } }) });
  assert.equal(r2.reason, 'empty');
});

test('сетевая ошибка не роняет', async () => {
  const on = settings({ enabled: true, consent: true });
  const r = await askBrain({ settings: on, secrets: KEY, text: 'x', today: TODAY, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'network');
});

test('interpret: правила понимают сами — ИИ не вызывается', async () => {
  const f = spyFetch(toolReply());
  const r = await interpret({ text: 'Добавь задачу купить плитку завтра. Позвонить Петрову в пятницу.', today: TODAY, settings: settings({ enabled: true, consent: true }), secrets: KEY, fetchImpl: f });
  assert.equal(r.commands.length, 2);
  assert.equal(r.usedBrain, false);
  assert.equal(f.calls.length, 0);
});

test('interpret: непонятное уходит в ИИ только если он готов', async () => {
  const f = spyFetch(toolReply(['create_task', { title: 'Колодки на Логан', due: '2026-11-20' }]));
  const r = await interpret({ text: 'Логан колодки передние и клей', today: TODAY, settings: settings({ enabled: true, consent: true }), secrets: KEY, fetchImpl: f });
  assert.equal(r.usedBrain, true);
  assert.equal(r.commands[0].title, 'Колодки на Логан');
  assert.equal(f.calls.length, 1);
});

test('interpret: ИИ выключен → черновик с сырым текстом, без сети', async () => {
  const f = spyFetch(toolReply());
  const r = await interpret({ text: 'Логан колодки передние', today: TODAY, settings: settings(), secrets: KEY, fetchImpl: f });
  assert.equal(f.calls.length, 0);
  assert.equal(r.commands[0].draft, true);
  assert.equal(r.commands[0].title, 'Логан колодки передние');
});

test('interpret: ошибка ИИ → черновик + причина', async () => {
  const f = spyFetch({ status: 500, json: {} });
  const r = await interpret({ text: 'Логан колодки', today: TODAY, settings: settings({ enabled: true, consent: true }), secrets: KEY, fetchImpl: f });
  assert.equal(r.commands[0].draft, true);
  assert.equal(r.brainError.reason, 'http');
});

test('pingBrain и разбор tool_calls', async () => {
  assert.equal((await pingBrain({ settings: settings(), secrets: { apiKey: '' } })).ok, false);
  assert.equal((await pingBrain({ settings: settings(), secrets: KEY, fetchImpl: spyFetch({ json: {} }) })).ok, true);
  assert.deepEqual(extractToolCalls({}), []);
  assert.deepEqual(validateCommands([{ name: 'create_task', args: { title: 'А' } }])[0].type, 'add');
  assert.equal(brainReady(settings({ enabled: true, consent: true }), KEY).ok, true);
});

test('список моделей: GET /models, текст отдельно от голоса', async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ object: 'list', data: [
      { id: 'openai/gpt-5-mini' }, { id: 'openai/text-embedding-3-small' }, { id: 'openai/gpt-4o-mini-transcribe' },
      { id: 'openai/gpt-4o-transcribe-diarize' }, { id: 'openai/dall-e-3' }, { id: 'google/gemini-2.5-flash' }, { id: 'openai/tts-1' },
    ] }) };
  };
  const r = await listModels({ settings: settings(), secrets: KEY, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.deepEqual(r.chat, ['google/gemini-2.5-flash', 'openai/gpt-5-mini']);
  assert.deepEqual(r.transcribe, ['openai/gpt-4o-mini-transcribe']);
  assert.equal(calls[0].url, 'https://api.proxyapi.ru/v1/models');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal((await listModels({ settings: settings(), secrets: { apiKey: '' }, fetchImpl: f })).ok, false);
  assert.equal(calls.length, 1); // без ключа запроса нет
});

test('понятные причины ошибок', async () => {
  assert.match(describeHttp(402, { detail: 'Insufficient balance to run this request.' }), /баланс/);
  assert.match(describeHttp(404, {}), /Модель не найдена/);
  assert.match(describeHttp(403, {}), /запрещены/);
  assert.match(describeHttp(502, {}), /недоступен/);
  const net = await pingBrain({ settings: settings(), secrets: KEY, fetchImpl: async () => { throw new TypeError('Load failed'); } });
  assert.equal(net.ok, false);
  assert.match(net.message, /CORS/);
});

test('в запросе к ИИ нет temperature и есть tools', async () => {
  const f = spyFetch(toolReply(['create_task', { title: 'А' }]));
  await askBrain({ settings: settings({ enabled: true, consent: true }), secrets: KEY, text: 'x', today: TODAY, fetchImpl: f });
  assert.equal('temperature' in f.calls[0].body, false);
  assert.equal(f.calls[0].body.model, 'openai/gpt-4o-mini');
  assert.equal(f.calls[0].body.tools.length, 2);
});
