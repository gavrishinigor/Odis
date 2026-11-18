// Настройки: «Мозг (ИИ)», резервная копия, хранилище, о приложении.
import * as S from './core/store.js';
import { PROVIDERS, MODEL_HINTS, TRANSCRIBE_HINTS, listModels, pingBrain } from './core/brain.js';
import { h, ICONS, confirmBox, snackbar } from './ui.js';
import { APP_VERSION } from './version.js';
import { howtoNodes } from './howto.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let page = 'main';
let modelsMsg = null; // {ok, text} — итог последней загрузки списка моделей

export function openSettings(app, startPage = 'main') {
  ctx = app;
  page = startPage;
  const panel = $('settings');
  panel.hidden = false;
  panel.classList.remove('closing');
  $('app').inert = true;
  document.body.classList.add('in-panel');
  draw();
  $('settingsBack').onclick = back;
}

function back() {
  if (page !== 'main') { page = 'main'; draw(); $('settings').scrollTo({ top: 0 }); return; }
  const panel = $('settings');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  panel.classList.add('closing');
  $('app').inert = false;
  document.body.classList.remove('in-panel');
  setTimeout(() => { panel.hidden = true; panel.classList.remove('closing'); }, reduce ? 0 : 240);
  ctx.render();
}

function draw() {
  $('settingsTitle').textContent = page === 'brain' ? 'Мозг (ИИ)' : 'Настройки';
  $('backLabel').textContent = page === 'brain' ? 'Настройки' : 'Готово';
  $('settingsBody').replaceChildren(...(page === 'brain' ? brainPage() : mainPage()));
}

const brain = () => ctx.state.settings.brain;
const save = () => ctx.persist();
const masked = (k) => (k ? `•••• ${k.slice(-4)}` : 'не задан');

// ---------- главная страница настроек ----------
function mainPage() {
  const b = brain();
  const brainState = !b.enabled ? 'Выкл' : !ctx.secrets.apiKey ? 'Вкл · нет ключа' : `Вкл · ${b.model}`;
  return [
    h('h3.sect-title', {}, 'Помощник'),
    h('div.group', {},
      h('button.row', { type: 'button', onclick: () => { page = 'brain'; draw(); } },
        h('span.grow', {}, 'Мозг (ИИ)', h('span.sub', {}, 'Разбор сложных фраз и расшифровка голоса')),
        h('span.val', {}, brainState),
        h('span', { html: ICONS.chev }))),
    h('p.note', {}, 'Простые фразы («завтра в 9 утра купить клей», «сделано клей») понимаются на телефоне, без интернета и бесплатно.'),

    h('h3.sect-title', {}, 'Резервная копия'),
    h('div.group', {},
      h('div.block', {},
        h('p.help', {}, `Задач на устройстве: ${ctx.state.tasks.length}. Копия — файл JSON с задачами и настройками. Ключ ИИ в копию не входит.`),
        h('div.btn-row', {},
          h('button.btn.small', { type: 'button', onclick: exportCopy }, 'Сохранить копию'),
          h('button.btn.small', { type: 'button', onclick: importCopy }, 'Загрузить копию')))),

    h('h3.sect-title', {}, 'Хранение'),
    h('div.group', {}, storageBlock()),

    h('h3.sect-title', {}, 'О приложении'),
    h('div.group', {},
      h('div.row', {}, h('span.grow', {}, 'Версия'), h('span.val', {}, APP_VERSION)),
      h('div.block', {}, h('p.help', {}, 'Задачи хранятся только на этом телефоне. Наружу уходит лишь то, что вы разрешили: текст и голос — провайдеру ИИ, если «Мозг» включён.'))),
  ];
}

function storageBlock() {
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const line = h('p.help', {}, standalone ? 'ODIS открыт с экрана «Домой».' : 'ODIS открыт в браузере. Добавьте на экран «Домой» (Поделиться → На экран «Домой»): iOS может очищать данные сайтов, которых нет на экране «Домой».');
  const persisted = h('p.help', {}, 'Проверяю защиту данных…');
  (async () => {
    try {
      const p = await navigator.storage?.persisted?.();
      persisted.textContent = p === true ? 'Браузер обещал не удалять данные автоматически.' : p === false ? 'Браузер не гарантирует хранение — делайте резервную копию время от времени.' : 'Браузер не сообщает о защите данных — делайте резервную копию время от времени.';
    } catch { persisted.textContent = 'Делайте резервную копию время от времени.'; }
  })();
  return h('div.block', {}, line, persisted);
}

async function exportCopy() {
  const text = S.exportBackup(ctx.state);
  const name = `odis-${ctx.today()}.json`;
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Копия ODIS' });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  snackbar('Копия сохранена');
}

function importCopy() {
  const inp = h('input', { type: 'file', accept: 'application/json,.json' });
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    const r = S.importBackup(await f.text());
    if (!r.ok) { await confirmBox({ title: 'Не получилось', text: r.message, cancel: null }); return; }
    const ok = await confirmBox({
      title: 'Заменить данные?',
      text: `Сейчас задач: ${ctx.state.tasks.length}. В копии: ${r.state.tasks.length}.\nТекущие задачи и настройки будут заменены копией. Ключ ИИ останется прежним.`,
      ok: 'Заменить', danger: true,
    });
    if (!ok) return;
    const before = JSON.stringify(ctx.state);
    ctx.state = r.state;
    S.rollover(ctx.state, ctx.today());
    save();
    draw();
    snackbar('Копия загружена', () => { ctx.state = S.migrate(JSON.parse(before)); save(); draw(); ctx.render(); });
  });
  inp.click();
}

// ---------- «Мозг (ИИ)» ----------
function brainPage() {
  const b = brain();
  const out = [];

  // 1) Включение и согласие
  const sw = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Включить ИИ', checked: b.enabled });
  sw.addEventListener('change', async () => {
    if (sw.checked && !b.consent) {
      const ok = await confirmBox({
        title: 'Отправлять текст провайдеру?',
        text: 'Когда ИИ включён, фразы, которые телефон не понял сам, и записи голоса уходят на сервер выбранного провайдера (ProxyAPI передаёт их дальше модели — OpenAI, Google и др.).\nВместе с ними отправляется только сегодняшняя дата. Список задач не отправляется.\nСогласие можно отозвать здесь же.',
        ok: 'Разрешить', cancel: 'Не сейчас',
      });
      if (!ok) { sw.checked = false; return; }
      b.consent = true;
    }
    b.enabled = sw.checked;
    save();
    draw();
  });
  out.push(h('div.group', {},
    h('label.row', {},
      h('span.grow', {}, 'Включить ИИ', h('span.sub', {}, b.enabled ? 'Включён' : 'Выключен — ничего никуда не отправляется')),
      h('span.switch', {}, sw, h('span.track'), h('span.knob'))),
    b.consent ? h('div.block', {},
      h('p.help', {}, 'Согласие на отправку текста и голоса дано.'),
      h('div.btn-row', {}, h('button.btn.small.danger', { type: 'button', onclick: () => { b.consent = false; b.enabled = false; save(); draw(); snackbar('Согласие отозвано, ИИ выключен'); } }, 'Отозвать согласие'))) : null));

  // 2) Ключ
  out.push(h('h3.sect-title', {}, 'API-ключ'));
  const keyInput = h('input.input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'sk-…', 'aria-label': 'API-ключ' });
  const showBtn = h('button.btn.small', { type: 'button', onclick: () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    showBtn.textContent = keyInput.type === 'password' ? 'Показать' : 'Скрыть';
  } }, 'Показать');
  const pasteBtn = h('button.btn.small', { type: 'button', onclick: async () => {
    try { keyInput.value = (await navigator.clipboard.readText()).trim(); }
    catch { snackbar('Вставка не разрешена — нажмите в поле и выберите «Вставить»'); keyInput.focus(); }
  } }, 'Вставить');
  const saveKeyBtn = h('button.btn.small.primary', { type: 'button', onclick: async () => {
    const k = keyInput.value.trim();
    if (!k) { keyInput.focus(); return; }
    ctx.secrets.apiKey = k;
    ctx.saveSecrets();
    keyInput.value = '';
    snackbar(`Ключ сохранён: ${masked(k)}`);
    await refreshModels({ quiet: false });
  } }, 'Сохранить');
  out.push(h('div.group', {},
    h('div.block', {},
      h('p.help', {}, `Сейчас: ${masked(ctx.secrets.apiKey)}. Ключ хранится только на этом телефоне и не попадает в резервную копию.`),
      keyInput,
      h('div.btn-row', {}, showBtn, pasteBtn, saveKeyBtn),
      ctx.secrets.apiKey ? h('div.btn-row', {}, h('button.btn.small.danger', { type: 'button', onclick: async () => {
        if (!(await confirmBox({ title: 'Удалить ключ?', text: 'ИИ перестанет работать, пока не вставите ключ снова.', ok: 'Удалить', danger: true }))) return;
        ctx.secrets.apiKey = ''; ctx.saveSecrets(); draw();
      } }, 'Удалить ключ')) : null)));

  // 3) Провайдер
  out.push(h('h3.sect-title', {}, 'Провайдер'));
  const provSel = h('select.input', { 'aria-label': 'Провайдер' },
    Object.entries(PROVIDERS).map(([id, p]) => h('option', { value: id, selected: b.provider === id }, p.name)));
  provSel.addEventListener('change', () => {
    b.provider = provSel.value;
    if (b.provider === 'proxyapi') b.baseUrl = PROVIDERS.proxyapi.baseUrl;
    b.chatModels = []; b.transcribeModels = []; b.modelsFetchedAt = null;
    save(); draw();
  });
  const urlInput = h('input.input', { type: 'url', value: b.baseUrl, placeholder: 'https://…/v1', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Адрес API', readOnly: b.provider === 'proxyapi' });
  urlInput.addEventListener('change', () => { b.baseUrl = urlInput.value.trim(); save(); });
  out.push(h('div.group', {}, h('div.block', {},
    provSel, urlInput,
    h('p.help', {}, b.provider === 'proxyapi' ? 'Адрес ProxyAPI подставлен (по документации proxyapi.ru).' : 'Любой OpenAI-совместимый адрес, обычно заканчивается на /v1.'))));

  // 4–5) Модели
  out.push(h('h3.sect-title', {}, 'Модели'));
  out.push(h('div.group', {},
    modelPicker('Модель для текста', 'model', b.chatModels, MODEL_HINTS,
      'По умолчанию openai/gpt-5-mini — в документации ProxyAPI названа недорогой и быстрой. Цены смотрите в кабинете.'),
    modelPicker('Модель для голоса (расшифровка)', 'transcribeModel', b.transcribeModels, TRANSCRIBE_HINTS,
      'Расшифровка у ProxyAPI есть (/audio/transcriptions). Если голос не заработает — диктуйте клавиатурой iPhone: поле ввода → значок микрофона.'),
    h('div.block', {},
      h('p.help', {}, b.modelsFetchedAt ? `Список получен от провайдера: ${b.chatModels.length} моделей для текста.` : 'Список моделей ещё не получен — можно ввести название вручную.'),
      modelsMsg ? h(`div.plate.${modelsMsg.ok === null ? 'info' : modelsMsg.ok ? 'ok' : 'bad'}`, {}, modelsMsg.text) : null,
      h('div.btn-row', {}, h('button.btn.small', { type: 'button', onclick: () => refreshModels({ quiet: false }) }, 'Обновить список')))));

  // 6) Проверка
  out.push(h('h3.sect-title', {}, 'Проверка'));
  const plate = h('div.plate.info', {}, 'Нажмите, чтобы отправить тестовый запрос «ок».');
  const pingBtn = h('button.btn.primary', { type: 'button', onclick: async () => {
    pingBtn.disabled = true;
    plate.className = 'plate info';
    plate.textContent = 'Проверяю…';
    const r = await pingBrain({ settings: ctx.state.settings, secrets: ctx.secrets });
    plate.className = `plate ${r.ok ? 'ok' : 'bad'}`;
    plate.textContent = r.ok ? `✓ ${r.message}` : r.message;
    pingBtn.disabled = false;
  } }, 'Проверить подключение');
  out.push(h('div.group', {}, h('div.block', {}, pingBtn, plate)));

  // 7) Инструкция
  out.push(h('h3.sect-title', {}, 'Помощь'));
  out.push(h('div.group', {},
    h('details.disclosure', {},
      h('summary.row', {}, h('span.grow', {}, 'Как подключить'), h('span', { html: ICONS.chev })),
      h('div.block.howto', {}, howtoNodes()))));
  out.push(h('p.note', {}, 'Дальше всё работает само: выбранная модель запоминается. Меню нужно только чтобы сменить модель.'));
  return out;
}

function modelPicker(label, key, list, hints, help) {
  const b = brain();
  const options = [...new Set([...(list.length ? list : hints), b[key]].filter(Boolean))];
  const sel = h('select.input', { 'aria-label': label },
    options.map((m) => h('option', { value: m, selected: m === b[key] }, m)),
    h('option', { value: '__manual' }, 'Ввести вручную…'));
  const manual = h('input.input', { type: 'text', placeholder: 'вендор/модель, например openai/gpt-5-mini', autocapitalize: 'off', spellcheck: 'false', hidden: true, 'aria-label': `${label} вручную` });
  sel.addEventListener('change', () => {
    if (sel.value === '__manual') { manual.hidden = false; manual.value = b[key]; manual.focus(); return; }
    manual.hidden = true;
    b[key] = sel.value;
    save();
  });
  manual.addEventListener('change', () => {
    const v = manual.value.trim();
    if (!v) return;
    b[key] = v;
    save();
    draw();
  });
  return h('div.block', {}, h('span.lbl', {}, label), sel, manual, h('p.help', {}, help));
}

async function refreshModels({ quiet }) {
  const b = brain();
  modelsMsg = { ok: null, text: 'Загружаю список моделей…' };
  if (page === 'brain') draw();
  const r = await listModels({ settings: ctx.state.settings, secrets: ctx.secrets });
  if (r.ok) {
    b.chatModels = r.chat;
    b.transcribeModels = r.transcribe;
    b.modelsFetchedAt = new Date().toISOString();
    if (r.chat.length && !r.chat.includes(b.model)) {
      b.model = r.chat.find((m) => /gpt-5-mini|gemini-2\.5-flash|haiku/i.test(m)) || b.model;
    }
    save();
    modelsMsg = { ok: true, text: `Моделей для текста: ${r.chat.length}, для голоса: ${r.transcribe.length}` };
  } else {
    modelsMsg = quiet ? null : { ok: false, text: `Список не получен: ${r.message}. Можно ввести модель вручную.` };
  }
  if (page === 'brain') draw();
}
