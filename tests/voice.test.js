// Расшифровка голоса: правильный адрес, multipart с моделью и языком, понятные ошибки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribe } from '../js/voice.js';
import { DEFAULT_SETTINGS } from '../js/core/store.js';

const settings = { brain: { ...DEFAULT_SETTINGS.brain, enabled: true, consent: true } };
const secrets = { apiKey: 'sk-test' };
const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' });
const reply = (status, json) => async (url, init) => {
  reply.last = { url, init };
  return { ok: status < 400, status, text: async () => JSON.stringify(json) };
};

test('расшифровка: POST /audio/transcriptions, multipart, модель и язык', async () => {
  const text = await transcribe({ blob, settings, secrets, fetchImpl: reply(200, { text: ' Завтра купить клей ' }) });
  assert.equal(text, 'Завтра купить клей');
  assert.equal(reply.last.url, 'https://api.proxyapi.ru/v1/audio/transcriptions');
  assert.equal(reply.last.init.headers.Authorization, 'Bearer sk-test');
  assert.equal('Content-Type' in reply.last.init.headers, false); // границу multipart ставит сам браузер
  const form = reply.last.init.body;
  assert.equal(form.get('model'), 'openai/gpt-4o-mini-transcribe');
  assert.equal(form.get('language'), 'ru');
  assert.equal(form.get('file').name, 'voice.m4a');
});

test('расшифровка: ошибки понятны человеку', async () => {
  await assert.rejects(transcribe({ blob, settings, secrets, fetchImpl: reply(402, { detail: 'Insufficient balance to run this request.' }) }), /баланс/);
  await assert.rejects(transcribe({ blob, settings, secrets, fetchImpl: reply(200, { text: '' }) }), /Ничего не расслышал/);
  await assert.rejects(transcribe({ blob, settings, secrets, fetchImpl: async () => { throw new TypeError('Load failed'); } }), /Нет связи/);
});
