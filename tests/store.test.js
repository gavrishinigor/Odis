import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, addTask, setDone, rollover, todayOpen, todayDone, upcoming, history, migrate, load, save, applyCommands, removeTask, updateTask, exportBackup, importBackup, saveSecrets, loadSecrets } from '../js/core/store.js';

const NOW = new Date(2026, 10, 18, 9, 0); // 18 ноября 2026
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };

test('автоперенос: невыполненное уезжает на сегодня, выполненное остаётся', () => {
  const s = emptyState();
  const a = addTask(s, { title: 'Старая', due: '2026-11-15' }, NOW);
  const b = addTask(s, { title: 'Сделанная', due: '2026-11-15' }, NOW);
  setDone(s, b.id, true, new Date(2026, 10, 15, 12));
  const moved = rollover(s, '2026-11-18');
  assert.equal(moved, 1);
  assert.equal(a.due, '2026-11-18');
  assert.equal(a.carried, 3);
  assert.equal(b.due, '2026-11-15');
  assert.equal(rollover(s, '2026-11-18'), 0); // повтор безвреден
});

test('списки: сегодня / скоро / готово / история', () => {
  const s = emptyState();
  addTask(s, { title: 'А', due: '2026-11-18', time: '14:00' }, NOW);
  addTask(s, { title: 'Б', due: '2026-11-18', time: '09:00' }, NOW);
  addTask(s, { title: 'В', due: '2026-11-18' }, NOW);
  addTask(s, { title: 'Г', due: '2026-11-20' }, NOW);
  const d = addTask(s, { title: 'Д', due: '2026-11-18' }, NOW);
  setDone(s, d.id, true, NOW);
  const e = addTask(s, { title: 'Е', due: '2026-11-17' }, NOW);
  setDone(s, e.id, true, new Date(2026, 10, 17, 18));
  assert.deepEqual(todayOpen(s, '2026-11-18').map((t) => t.title), ['Б', 'А', 'В']);
  assert.deepEqual(todayDone(s, '2026-11-18').map((t) => t.title), ['Д']);
  assert.deepEqual(upcoming(s, '2026-11-18').map((g) => [g.date, g.tasks.length]), [['2026-11-20', 1]]);
  assert.deepEqual(history(s, '2026-11-18').map((g) => g.date), ['2026-11-17']);
});

test('отмена галочки', () => {
  const s = emptyState();
  const t = addTask(s, { title: 'X', due: '2026-11-18' }, NOW);
  setDone(s, t.id, true, NOW);
  setDone(s, t.id, false, NOW);
  assert.equal(t.done, false);
  assert.equal(t.doneDay, null);
});

test('сохранение/загрузка и миграция не ломаются на мусоре', () => {
  const st = mem();
  const s = emptyState();
  addTask(s, { title: 'Купить клей', due: '2026-11-19', object: 'Ленина 5' }, NOW);
  save(st, s);
  const l = load(st);
  assert.equal(l.tasks[0].title, 'Купить клей');
  assert.equal(l.settings.brain.enabled, false);
  st.setItem('odis.state.v1', '{мусор');
  assert.equal(load(st).tasks.length, 0);
  assert.equal(migrate({ tasks: [{ title: '  ' }, null, { title: 'ок', due: 'плохая' }] }).tasks.length, 1);
});

test('миграция: ИИ выключен по умолчанию, незнакомые поля не удаляются, старый адрес чинится', () => {
  const m = migrate({ future: 1, settings: { brain: { enabled: 1, extra: 'x', baseUrl: 'https://openai.api.proxyapi.ru/v1' }, theme: 'dark' }, tasks: [{ id: 'a', title: 'Т', due: '2026-11-18', newField: 5 }] });
  assert.equal(m.settings.brain.enabled, true);
  assert.equal(m.settings.brain.consent, false);
  assert.equal(m.settings.brain.extra, 'x');
  assert.equal(m.settings.theme, 'dark');
  assert.equal(m.future, 1);
  assert.equal(m.tasks[0].newField, 5);
  assert.equal(m.settings.brain.baseUrl, 'https://api.proxyapi.ru/v1');
  assert.equal(migrate(null).settings.brain.enabled, false);
  assert.equal(migrate({}).settings.brain.model, 'openai/gpt-5-mini');
});

test('дубли id при импорте получают новые id', () => {
  const m = migrate({ tasks: [{ id: 'x', title: 'А' }, { id: 'x', title: 'Б' }] });
  assert.notEqual(m.tasks[0].id, m.tasks[1].id);
});

test('резервная копия: без ключа, импорт проверяет файл', () => {
  const st = mem();
  saveSecrets(st, { apiKey: 'sk-secret' });
  const s = emptyState();
  addTask(s, { title: 'Купить клей', due: '2026-11-19' }, NOW);
  const text = exportBackup(s, NOW);
  assert.equal(text.includes('sk-secret'), false);
  const r = importBackup(text);
  assert.equal(r.ok, true);
  assert.equal(r.state.tasks[0].title, 'Купить клей');
  assert.equal(importBackup('не json').ok, false);
  assert.equal(importBackup('{"a":1}').ok, false);
  assert.equal(loadSecrets(st).apiKey, 'sk-secret');
});

test('applyCommands: добавить, закрыть, не найдено', () => {
  const s = emptyState();
  addTask(s, { title: 'Заказать клей', due: '2026-11-18' }, NOW);
  const r = applyCommands(s, [
    { type: 'add', title: 'Позвонить Петрову', due: '2026-11-19', time: null, object: null },
    { type: 'done', query: 'клей' },
    { type: 'done', query: 'машина' },
  ], NOW);
  assert.equal(r.added.length, 1);
  assert.equal(r.done.length, 1);
  assert.deepEqual(r.notFound, ['машина']);
});

test('изменение и удаление', () => {
  const s = emptyState();
  const t = addTask(s, { title: 'X', due: '2026-11-18', draft: true }, NOW);
  updateTask(s, t.id, { title: 'Y', due: '2026-11-21', time: '10:30', object: ' Дом ' });
  assert.equal(t.title, 'Y'); assert.equal(t.due, '2026-11-21'); assert.equal(t.time, '10:30'); assert.equal(t.object, 'Дом'); assert.equal(t.draft, false);
  assert.equal(removeTask(s, t.id), true);
  assert.equal(s.tasks.length, 0);
});
