// ODIS — главный экран: «Сегодня», «Скоро», «Готово», шторка задачи, док-панель (ввод + микрофон).
import * as S from './core/store.js';
import { toISO, formatLong, formatRelative } from './core/dates.js';
import { interpret } from './core/assistant.js';
import { brainReady, REASON_TEXT } from './core/brain.js';
import { Recorder, transcribe, voiceSupported, micErrorText } from './voice.js';
import { h, svg, ICONS, confirmBox, snackbar, hideSnack, status, safeStorage, plural } from './ui.js';
import { openSettings } from './settings.js';
import { applyLook } from './theme.js';
import { loadBg, applyBg } from './bg.js';

const storage = safeStorage();
const UI_KEY = 'odis.ui.v1';
const $ = (id) => document.getElementById(id);

const app = {
  state: S.load(storage),
  secrets: S.loadSecrets(storage),
  view: 'today',
  storage,
  today: () => toISO(new Date()),
  persist() {
    if (!S.save(storage, app.state)) status('Не удалось сохранить на устройстве — память заполнена?', { error: true, ms: 6000 });
  },
  saveSecrets() { S.saveSecrets(storage, app.secrets); },
  render,
};
window.__odis = app; // для отладки в консоли

function uiPrefs() {
  try { return JSON.parse(storage.getItem(UI_KEY) || '{}'); } catch { return {}; }
}
function setUiPref(k, v) {
  const p = uiPrefs(); p[k] = v;
  try { storage.setItem(UI_KEY, JSON.stringify(p)); } catch { /* не критично */ }
}

// ---------- отмена ----------
const snapshot = () => JSON.stringify(app.state.tasks);
function restore(snap) {
  app.state.tasks = JSON.parse(snap);
  app.persist();
  render();
}

// ---------- автоперенос ----------
let midnightTimer = null;
function checkDay() {
  const t = app.today();
  const moved = S.rollover(app.state, t);
  app.persist();
  if (moved) snackbar(`Перенесено на сегодня: ${moved} ${plural(moved, 'задача', 'задачи', 'задач')}`);
  render();
  clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
  midnightTimer = setTimeout(checkDay, Math.min(next - now, 2 ** 31 - 1));
}

// ---------- отрисовка ----------
function render() {
  const t = app.today();
  const open = S.todayOpen(app.state, t);
  const doneToday = S.todayDone(app.state, t);
  const soon = S.upcoming(app.state, t);
  const soonCount = soon.reduce((n, g) => n + g.tasks.length, 0);

  const long = formatLong(t);
  $('topDate').textContent = long.charAt(0).toUpperCase() + long.slice(1);
  $('topTitle').textContent = { today: 'Сегодня', soon: 'Скоро', done: 'Готово' }[app.view];

  // плитки: «Сделано сегодня» и «Скоро»
  const total = open.length + doneToday.length;
  const carried = open.filter((x) => x.carried > 0).length;
  $('tileTodayN').textContent = `${doneToday.length}/${total}`;
  const rowT = $('tileTodayRow');
  rowT.textContent = carried ? `Перенос: ${carried}` : total && doneToday.length === total ? 'Всё сделано' : `Осталось: ${open.length}`;
  rowT.classList.toggle('warn', carried > 0);
  $('tileToday').setAttribute('aria-label', `Сделано сегодня ${doneToday.length} из ${total}. Открыть «Сегодня»`);
  $('tileSoonN').textContent = String(soonCount);
  $('tileSoonRow').textContent = soon.length ? `Ближайшая: ${formatRelative(soon[0].date, t).toLowerCase()}` : 'Ничего не запланировано';
  $('tileSoon').setAttribute('aria-label', `Скоро задач: ${soonCount}. Открыть «Скоро»`);
  for (const b of document.querySelectorAll('.nav-btn')) {
    if (b.dataset.nav === app.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }

  for (const tab of document.querySelectorAll('.tab')) {
    const v = tab.dataset.view;
    tab.setAttribute('aria-selected', String(v === app.view));
    const n = v === 'today' ? open.length : v === 'soon' ? soonCount : 0;
    tab.replaceChildren(tab.dataset.label || (tab.dataset.label = tab.textContent), n ? h('span.count', {}, n) : '');
  }
  const idx = ['today', 'soon', 'done'].indexOf(app.view);
  document.querySelector('.tab-pill').style.transform = `translateX(${idx * 100}%)`;

  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.dataset.view !== app.view;
  if (app.view === 'today') renderToday(open, doneToday, t);
  if (app.view === 'soon') renderSoon(soon, t);
  if (app.view === 'done') renderDone(doneToday, t);
}

function renderToday(open, doneToday, t) {
  const box = $('view-today');
  const parts = [];
  if (!isStandalone() && !uiPrefs().installHidden) {
    parts.push(h('div.banner.glass', {},
      h('p', {}, 'Добавьте ODIS на экран «Домой»: кнопка «Поделиться» в Safari → «На экран „Домой“». Так данные надёжнее хранятся и приложение открывается без адресной строки.'),
      h('button', { type: 'button', onclick: () => { setUiPref('installHidden', true); render(); } }, 'Скрыть')));
  }
  if (!open.length) {
    parts.push(emptyState(doneToday.length
      ? ['Всё сделано', 'На сегодня задач не осталось. Отличная работа.']
      : ['Пока пусто', 'Нажмите микрофон и скажите, например: «Завтра в 9 утра купить клей на объект Ленина 5».']));
  } else {
    parts.push(h('ul.list', { role: 'list' }, open.map((x) => card(x, t))));
  }
  if (doneToday.length) {
    parts.push(h('h2.group-title', {}, `Выполнено · ${doneToday.length}`));
    parts.push(h('ul.list', { role: 'list' }, doneToday.map((x) => card(x, t))));
  }
  box.replaceChildren(...parts);
}

function renderSoon(groups, t) {
  const box = $('view-soon');
  if (!groups.length) {
    box.replaceChildren(emptyState(['Будущих задач нет', 'Скажите «послезавтра», «в пятницу» или «25 ноября» — задача появится здесь.']));
    return;
  }
  box.replaceChildren(...groups.flatMap((g) => [
    h('h2.group-title', {}, formatRelative(g.date, t)),
    h('ul.list', { role: 'list' }, g.tasks.map((x) => card(x, t))),
  ]));
}

function renderDone(doneToday, t) {
  const box = $('view-done');
  const hist = S.history(app.state, t, 30);
  const groups = (doneToday.length ? [{ date: t, tasks: doneToday }] : []).concat(hist);
  if (!groups.length) {
    box.replaceChildren(emptyState(['История пуста', 'Здесь будут выполненные задачи за последние 30 дней.']));
    return;
  }
  box.replaceChildren(...groups.flatMap((g) => [
    h('h2.group-title', {}, formatRelative(g.date, t)),
    h('ul.list', { role: 'list' }, g.tasks.map((x) => card(x, t))),
  ]));
}

function emptyState([title, text]) {
  return h('div.empty.glass', {},
    h('div.empty-ico', { html: ICONS.check }),
    h('h3', {}, title),
    h('p', {}, text));
}

function chip(icon, text, cls = '') {
  const c = h(`span.chip${cls ? '.' + cls : ''}`, {});
  if (icon) c.append(svg(icon));
  c.append(text);
  return c;
}

function card(task, t) {
  const meta = [];
  if (task.time) meta.push(chip('clock', task.time));
  if (task.object) meta.push(chip('pin', task.object));
  if (!task.done && task.carried > 0) meta.push(chip('back', `перенесено ${task.carried} ${plural(task.carried, 'день', 'дня', 'дней')}`, 'warn'));
  if (task.draft) meta.push(chip('pen', 'черновик — проверьте', 'draft'));

  const li = h('li.card.glass', { dataset: { id: task.id } });
  if (task.done) li.classList.add('done');
  const check = h('button.check', {
    type: 'button',
    'aria-label': task.done ? `Вернуть в работу: ${task.title}` : `Выполнено: ${task.title}`,
    'aria-pressed': String(task.done),
    onclick: (e) => { e.stopPropagation(); toggleDone(task.id, li); },
  }, h('span.check-box', { html: ICONS.check }), h('span.check-burst'));
  const body = h('button.card-body', { type: 'button', onclick: () => openSheet(task.id), 'aria-label': `Изменить: ${task.title}` },
    h('p.card-title', {}, task.title),
    meta.length ? h('div.meta', {}, meta) : null);
  li.append(check, body);
  return li;
}

function toggleDone(id, li) {
  const task = app.state.tasks.find((x) => x.id === id);
  if (!task) return;
  const snap = snapshot();
  const willBeDone = !task.done;
  S.setDone(app.state, id, willBeDone);
  app.persist();
  li.classList.toggle('done', willBeDone);
  if (willBeDone) li.classList.add('just-done');
  snackbar(willBeDone ? `Выполнено: ${task.title}` : `Вернул в работу: ${task.title}`, () => restore(snap));
  // даём галочке доиграть, потом карточка уезжает вниз
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { li.classList.add('leaving'); setTimeout(render, reduce ? 0 : 220); }, reduce ? 0 : 420);
}

// ---------- шторка правки ----------
let sheetId = null;
function openSheet(id) {
  const task = app.state.tasks.find((x) => x.id === id);
  if (!task) return;
  sheetId = id;
  $('fTitle').value = task.title;
  $('fDue').value = task.due;
  $('fTime').value = task.time || '';
  $('fObject').value = task.object || '';
  const note = $('sheetNote');
  note.hidden = !task.draft;
  note.textContent = task.draft ? 'Черновик: фраза сохранена как есть. Поправьте название, дату и объект — и нажмите «Сохранить».' : '';
  $('sheet').hidden = false;
  $('sheetScrim').hidden = false;
  $('app').inert = true;
  $('sheet').classList.remove('closing');
  hideSnack();
}
function closeSheet() {
  const sheet = $('sheet');
  if (sheet.hidden) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  sheet.classList.add('closing');
  $('sheetScrim').hidden = true;
  $('app').inert = false;
  setTimeout(() => { sheet.hidden = true; sheet.classList.remove('closing'); }, reduce ? 0 : 240);
  sheetId = null;
}
$('sheetScrim').addEventListener('click', closeSheet);
$('sheetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('fTitle').value.trim();
  if (!title) { $('fTitle').focus(); return; }
  S.updateTask(app.state, sheetId, { title, due: $('fDue').value, time: $('fTime').value || null, object: $('fObject').value });
  app.persist();
  closeSheet();
  render();
});
$('sheetDelete').addEventListener('click', () => {
  const task = app.state.tasks.find((x) => x.id === sheetId);
  if (!task) return;
  const snap = snapshot();
  S.removeTask(app.state, sheetId);
  app.persist();
  closeSheet();
  render();
  snackbar(`Удалено: ${task.title}`, () => restore(snap));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ---------- вкладки, плитки, нижнее меню ----------
function go(view) { app.view = view; render(); window.scrollTo({ top: 0 }); }
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => go(tab.dataset.view));
for (const tile of document.querySelectorAll('.tile')) tile.addEventListener('click', () => go(tile.dataset.go));
for (const b of document.querySelectorAll('.nav-btn')) {
  if (b.dataset.nav !== 'settings') b.addEventListener('click', () => go(b.dataset.nav));
}

// ---------- ввод текста и голос ----------
const input = $('dockInput');
const dock = $('dock');
input.addEventListener('input', () => {
  const typing = input.value.trim().length > 0;
  dock.classList.toggle('typing', typing);
  $('sendBtn').hidden = !typing;
});
$('dockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.dispatchEvent(new Event('input'));
  await handleText(text, 'text');
});

let busy = false;
async function handleText(text, source) {
  busy = true;
  const willAsk = brainReady(app.state.settings, app.secrets).ok;
  if (willAsk) status('Разбираю…', { ms: 0 });
  try {
    const r = await interpret({ text, today: app.today(), settings: app.state.settings, secrets: app.secrets });
    const snap = snapshot();
    const res = S.applyCommands(app.state, r.commands.map((c) => ({ ...c, source })));
    app.persist();
    // новые задачи — на вкладке, где их видно
    if (res.added.length && res.added.every((x) => x.due > app.today())) app.view = 'soon';
    else if (res.added.length) app.view = 'today';
    render();
    const parts = [];
    if (res.added.length) parts.push(res.added.length === 1 ? `Добавлено: ${res.added[0].title}` : `Добавлено задач: ${res.added.length}`);
    if (res.done.length) parts.push(res.done.length === 1 ? `Выполнено: ${res.done[0].title}` : `Выполнено: ${res.done.length}`);
    if (res.notFound.length) parts.push(`Не нашёл: ${res.notFound.join(', ')}`);
    if (res.ambiguous.length) parts.push(`Уточните, какую: ${res.ambiguous.join(', ')}`);
    const changed = res.added.length || res.done.length;
    snackbar(parts.join(' · ') || 'Ничего не понял', changed ? () => restore(snap) : null, 6000);
    if (r.brainError && r.brainError.reason !== 'off') {
      status(`ИИ: ${r.brainError.message || REASON_TEXT[r.brainError.reason] || 'ошибка'}. Сохранил черновиком`, { error: true, ms: 7000 });
    } else {
      status('');
    }
  } catch (err) {
    status(`Ошибка: ${err?.message || err}`, { error: true, ms: 6000 });
  } finally {
    busy = false;
  }
}

const recorder = new Recorder();
const mic = $('micBtn');
let recTick = null;
let recLimit = null;
const MAX_REC_MS = 120000;

function setMic(state) {
  mic.dataset.state = state;
  mic.setAttribute('aria-label', state === 'rec' ? 'Закончить запись' : state === 'busy' ? 'Обрабатываю' : 'Надиктовать');
}

mic.addEventListener('click', async () => {
  if (busy && mic.dataset.state !== 'rec') return;
  if (mic.dataset.state === 'rec') { await finishRecording(); return; }
  const ready = brainReady(app.state.settings, app.secrets);
  if (!voiceSupported() || !ready.ok) { await keyboardFallback(ready); return; }
  try {
    await recorder.start();
  } catch (e) {
    status(micErrorText(e), { error: true, ms: 8000 });
    return;
  }
  setMic('rec');
  const started = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    status(`Слушаю… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} — нажмите ■, чтобы закончить`, { ms: 0 });
  };
  tick();
  recTick = setInterval(tick, 500);
  recLimit = setTimeout(finishRecording, MAX_REC_MS);
});

async function finishRecording() {
  clearInterval(recTick);
  clearTimeout(recLimit);
  if (mic.dataset.state !== 'rec') return;
  setMic('busy');
  status('Расшифровываю…', { ms: 0 });
  const rec = await recorder.stop();
  if (!rec || rec.ms < 700 || !rec.blob.size) {
    setMic('idle');
    status('Слишком коротко — нажмите и говорите', { error: true });
    return;
  }
  try {
    const text = await transcribe({ blob: rec.blob, settings: app.state.settings, secrets: app.secrets });
    status(`«${text.length > 80 ? text.slice(0, 80) + '…' : text}»`, { ms: 0 });
    await handleText(text, 'voice');
  } catch (e) {
    status(`${e.message}. Можно продиктовать клавиатурой: поле ввода → значок микрофона`, { error: true, ms: 9000 });
  } finally {
    setMic('idle');
  }
}

async function keyboardFallback(ready) {
  const why = !voiceSupported()
    ? 'Этот браузер не умеет записывать звук.'
    : ready.reason === 'no_key'
      ? 'Для расшифровки голоса нужен ключ ИИ-провайдера.'
      : 'Голос расшифровывает ИИ-провайдер, а «Мозг (ИИ)» сейчас выключен.';
  const go = await confirmBox({
    title: 'Голос пока не настроен',
    text: `${why}\nМожно диктовать клавиатурой iPhone: нажмите поле ввода и значок микрофона на клавиатуре — это работает без ключа.`,
    ok: 'Диктовать клавиатурой',
    cancel: 'Настройки ИИ',
  });
  if (go) input.focus();
  else openSettings(app, 'brain');
}

// ---------- настройки ----------
$('openSettings').addEventListener('click', () => openSettings(app));

// ---------- служебное ----------
function isStandalone() {
  return window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDay(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) checkDay(); });
window.addEventListener('storage', (e) => {
  if (e.key === S.STATE_KEY) { app.state = S.load(storage); render(); }
});

async function boot() {
  applyLook(app.state.settings.look);
  checkDay();
  if (app.state.settings.look.hasBg) applyBg(await loadBg());
  if (storage.volatile) status('Хранилище недоступно (приватный режим?) — задачи не сохранятся', { error: true, ms: 8000 });
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* не поддерживается */ }
  // на localhost кэш мешает разработке — включается только с ?sw=1
  const devHost = ['localhost', '127.0.0.1'].includes(location.hostname) && !location.search.includes('sw=1');
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !devHost) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-кэш не обязателен */ });
  }
}
boot();

