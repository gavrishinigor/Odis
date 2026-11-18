// Google Календарь на заглушке: никаких реальных запросов к Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, addTask, setDone, updateTask, removeTask, rollover, migrate } from '../js/core/store.js';
import { eventFromTask, planFor, syncAll, signature, calendarApi, normalizeGcal, looksLikeClientId, pendingCount, SCOPE, DONE_MARK } from '../js/core/gcal.js';

const NOW = new Date(2026, 10, 18, 9, 0);
const g = normalizeGcal({ enabled: true });
const TZ = 'Europe/Moscow';

// Заглушка Календаря: хранит события в памяти, умеет имитировать ошибки.
function fakeApi() {
  const events = new Map();
  let n = 0;
  const api = {
    events, calls: [], fail: null,
    async insert(body) { api.calls.push(['insert', body]); if (api.fail) throw api.fail; const id = `ev${++n}`; events.set(id, structuredClone(body)); return { id }; },
    async patch(id, body) { api.calls.push(['patch', id, body]); if (api.fail) throw api.fail; if (!events.has(id)) throw Object.assign(new Error('нет'), { status: 404 }); events.set(id, { ...events.get(id), ...structuredClone(body) }); return { id }; },
    async remove(id) { api.calls.push(['remove', id]); if (api.fail) throw api.fail; if (!events.has(id)) throw Object.assign(new Error('нет'), { status: 410 }); events.delete(id); return null; },
  };
  return api;
}

test('событие из задачи: со временем, на весь день, объект, напоминания', () => {
  const s = emptyState();
  const timed = addTask(s, { title: 'Позвонить прорабу', due: '2026-11-19', time: '23:45', object: 'Ленина 5' }, NOW);
  const e = eventFromTask(timed, g, TZ);
  assert.equal(e.summary, 'Позвонить прорабу — Ленина 5');
  assert.deepEqual(e.start, { dateTime: '2026-11-19T23:45:00', timeZone: TZ });
  assert.deepEqual(e.end, { dateTime: '2026-11-20T00:15:00', timeZone: TZ }); // через полночь
  assert.deepEqual(e.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
  assert.equal(e.extendedProperties.private.odisId, timed.id);

  const allDay = addTask(s, { title: 'Купить клей', due: '2026-12-31' }, NOW);
  const a = eventFromTask(allDay, g, TZ);
  assert.deepEqual(a.start, { date: '2026-12-31' });
  assert.deepEqual(a.end, { date: '2027-01-01' }); // конец не включается
  assert.deepEqual(a.reminders.overrides, [{ method: 'popup', minutes: 240 }]); // накануне в 20:00
  assert.deepEqual(eventFromTask(allDay, { ...g, allDayRemind: -1 }, TZ).reminders.overrides, []);
});

test('выполненная: галочка в названии, без напоминаний; новых событий для выполненных не создаём', () => {
  const s = emptyState();
  const t = addTask(s, { title: 'Замерить кухню', due: '2026-11-18', time: '10:00' }, NOW);
  setDone(s, t.id, true, NOW);
  assert.equal(planFor(t, g), null); // не было события — не создаём
  t.calendarEventId = 'ev1';
  const e = eventFromTask(t, g, TZ);
  assert.ok(e.summary.startsWith(DONE_MARK));
  assert.deepEqual(e.reminders.overrides, []);
  assert.equal(planFor(t, g), 'patch');
});

test('черновики и задачи без времени (если выключено) не отправляются', () => {
  const s = emptyState();
  const d = addTask(s, { title: 'Логан колодки', due: '2026-11-18', draft: true }, NOW);
  assert.equal(planFor(d, g), null);
  const noTime = addTask(s, { title: 'Купить клей', due: '2026-11-18' }, NOW);
  assert.equal(planFor(noTime, { ...g, syncAllDay: false }), null);
  assert.equal(planFor(noTime, g), 'insert');
});

test('полный цикл: создать → изменить → выполнить (✓, остаётся) → удалить задачу', async () => {
  const s = emptyState();
  const api = fakeApi();
  const t = addTask(s, { title: 'Купить затирку', due: '2026-11-19', time: '09:00' }, NOW);

  let r = await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(r.inserted, 1);
  assert.equal(t.calendarEventId, 'ev1');
  assert.equal(t.calSig, signature(t, g));
  assert.equal((await syncAll({ state: s, api, g, timeZone: TZ })).inserted, 0); // повтор ничего не шлёт

  updateTask(s, t.id, { time: '11:30' });
  r = await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(r.patched, 1);
  assert.equal(api.events.get('ev1').start.dateTime, '2026-11-19T11:30:00');

  setDone(s, t.id, true, NOW);
  await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(api.events.get('ev1').summary, '✓ Купить затирку');
  assert.deepEqual(api.events.get('ev1').reminders.overrides, []);
  assert.ok(api.events.has('ev1')); // остаётся в истории

  setDone(s, t.id, false, NOW);
  await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(api.events.get('ev1').summary, 'Купить затирку'); // вернули в работу — галочка снята

  removeTask(s, t.id);
  assert.deepEqual(s.calDeletes, ['ev1']);
  r = await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(r.deleted, 1);
  assert.equal(api.events.size, 0);
  assert.deepEqual(s.calDeletes, []);
});

test('автоперенос двигает событие на сегодня', async () => {
  const s = emptyState();
  const api = fakeApi();
  const t = addTask(s, { title: 'Позвонить электрику', due: '2026-11-16' }, NOW);
  await syncAll({ state: s, api, g, timeZone: TZ });
  rollover(s, '2026-11-18');
  assert.equal(planFor(t, g), 'patch');
  await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(api.events.get(t.calendarEventId).start.date, '2026-11-18');
});

test('событие удалили руками в Календаре — создаём заново; «Отменить» удаление — событие не удаляем', async () => {
  const s = emptyState();
  const api = fakeApi();
  const t = addTask(s, { title: 'А', due: '2026-11-18', time: '10:00' }, NOW);
  await syncAll({ state: s, api, g, timeZone: TZ });
  api.events.clear();
  updateTask(s, t.id, { title: 'Б' });
  await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(api.events.size, 1);
  assert.notEqual(t.calendarEventId, 'ev1');

  const snap = JSON.stringify(s.tasks);
  removeTask(s, t.id);
  s.tasks = JSON.parse(snap); // «Отменить»
  const r = await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(r.deleted, 0);
  assert.equal(api.events.size, 1);
});

test('истёк вход (401) — останавливаемся и просим войти; нет связи — изменения ждут', async () => {
  const s = emptyState();
  const api = fakeApi();
  addTask(s, { title: 'А', due: '2026-11-18' }, NOW);
  addTask(s, { title: 'Б', due: '2026-11-18' }, NOW);
  api.fail = Object.assign(new Error('auth'), { status: 401 });
  let r = await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(r.authNeeded, true);
  assert.equal(api.calls.length, 1);
  assert.equal(pendingCount(s, g), 2);
  api.fail = Object.assign(new Error('Нет связи с Google Календарём'), { status: 0 });
  r = await syncAll({ state: s, api, g, timeZone: TZ });
  assert.deepEqual(r.errors, ['Нет связи с Google Календарём']);
  api.fail = null;
  r = await syncAll({ state: s, api, g, timeZone: TZ });
  assert.equal(r.inserted, 2);
  assert.equal(pendingCount(s, g), 0);
});

test('REST: адреса, заголовки, понятные ошибки; без токена запроса нет', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '{"id":"x1"}' }; };
  const api = calendarApi({ getToken: () => 'tok', fetchImpl });
  assert.deepEqual(await api.insert({ summary: 'А' }), { id: 'x1' });
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  await api.patch('a/b', { summary: 'Б' });
  assert.equal(calls[1].url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events/a%2Fb');
  assert.equal(calls[1].init.method, 'PATCH');

  const noTok = calendarApi({ getToken: () => null, fetchImpl });
  await assert.rejects(noTok.insert({}), (e) => e.status === 401);
  assert.equal(calls.length, 2);

  const forbid = calendarApi({ getToken: () => 't', fetchImpl: async () => ({ ok: false, status: 403, text: async () => '{"error":{"message":"Calendar API has not been used"}}' }) });
  await assert.rejects(forbid.insert({}), /Calendar API включён/);
  const offline = calendarApi({ getToken: () => 't', fetchImpl: async () => { throw new TypeError('Load failed'); } });
  await assert.rejects(offline.insert({}), (e) => e.status === 0);
});

test('настройки Календаря: по умолчанию выключено, мусор чинится, Client ID проверяется', () => {
  const m = migrate({});
  assert.equal(m.settings.gcal.enabled, false);
  assert.equal(m.settings.gcal.remindMin, 10);
  assert.deepEqual(m.calDeletes, []);
  assert.equal(normalizeGcal({ remindMin: 7, allDayRemind: 'x', calendarId: '' }).remindMin, 10);
  assert.equal(normalizeGcal({ allDayRemind: 'x' }).allDayRemind, 240);
  assert.equal(looksLikeClientId('1234567890-abc123def456.apps.googleusercontent.com'), true);
  assert.equal(looksLikeClientId('AIzaSyFakeApiKey'), false);
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/calendar.events.owned');
});
