// Настройки: «Мозг (ИИ)», резервная копия, хранилище, о приложении.
import * as S from './core/store.js';
import { ACCENTS } from './core/store.js';
import { PROVIDERS, MODEL_HINTS, TRANSCRIBE_HINTS, listModels, pingBrain } from './core/brain.js';
import { h, ICONS, confirmBox, snackbar } from './ui.js';
import { APP_VERSION } from './version.js';
import { howtoNodes } from './howto.js';
import { applyLook } from './theme.js';
import { saveBg, deleteBg, loadBg, compressImage, applyBg } from './bg.js';

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

const PAGES = {
  main: { title: 'Настройки', back: 'Готово', build: () => mainPage() },
  brain: { title: 'Мозг (ИИ)', back: 'Назад', build: () => brainPage() },
  look: { title: 'Оформление', back: 'Назад', build: () => lookPage() },
};
function draw() {
  const p = PAGES[page] || PAGES.main;
  $('settingsTitle').textContent = p.title;
  $('backLabel').textContent = p.back;
  $('settingsBody').replaceChildren(...p.build());
}

const brain = () => ctx.state.settings.brain;
const save = () => ctx.persist();
const masked = (k) => (k ? `•••• ${k.slice(-4)}` : 'не задан');

// ---------- главная страница настроек ----------
function mainPage() {
  const b = brain();
  const brainState = !b.enabled ? 'Выкл' : !ctx.secrets.apiKey ? 'Вкл · нет ключа' : `Вкл · ${b.model}`;
  const look = ctx.state.settings.look;
  const themeName = { auto: 'Авто', light: 'Светлая', dark: 'Тёмная' }[look.theme];
  return [
    h('h3.sect-title', {}, 'Вид'),
    h('div.group.glass', {},
      h('button.row', { type: 'button', onclick: () => { page = 'look'; draw(); } },
        h('span.grow', {}, 'Оформление', h('span.sub', {}, 'Тема, цвет кнопок, плашки, фон')),
        h('span.val', {}, `${themeName} · ${ACCENTS[look.accent].name}`),
        h('span', { html: ICONS.chev }))),

    h('h3.sect-title', {}, 'Помощник'),
    h('div.group.glass', {},
      h('button.row', { type: 'button', onclick: () => { page = 'brain'; draw(); } },
        h('span.grow', {}, 'Мозг (ИИ)', h('span.sub', {}, 'Разбор сложных фраз и расшифровка голоса')),
        h('span.val', {}, brainState),
        h('span', { html: ICONS.chev }))),
    h('p.note', {}, 'Простые фразы («завтра в 9 утра купить клей», «сделано клей») понимаются на телефоне, без интернета и бесплатно.'),

    h('h3.sect-title', {}, 'Резервная копия'),
    h('div.group.glass', {},
      h('div.block', {},
        h('p.help', {}, `Задач на устройстве: ${ctx.state.tasks.length}. Копия — файл JSON с задачами и настройками. Ключ ИИ в копию не входит.`),
        h('div.btn-row', {},
          h('button.btn.small', { type: 'button', onclick: exportCopy }, 'Сохранить копию'),
          h('button.btn.small', { type: 'button', onclick: importCopy }, 'Загрузить копию')))),

    h('h3.sect-title', {}, 'Хранение'),
    h('div.group.glass', {}, storageBlock()),

    h('h3.sect-title', {}, 'О приложении'),
    h('div.group.glass', {},
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
    ctx.state.settings.look.hasBg = before.includes('"hasBg":true'); // фото фона в копию не входит — остаётся своё
    S.rollover(ctx.state, ctx.today());
    save();
    applyLook(ctx.state.settings.look);
    draw();
    snackbar('Копия загружена', () => { ctx.state = S.migrate(JSON.parse(before)); save(); applyLook(ctx.state.settings.look); draw(); ctx.render(); });
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
  out.push(h('div.group.glass', {},
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
  out.push(h('div.group.glass', {},
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
  out.push(h('div.group.glass', {}, h('div.block', {},
    provSel, urlInput,
    h('p.help', {}, b.provider === 'proxyapi' ? 'Адрес ProxyAPI подставлен (по документации proxyapi.ru).' : 'Любой OpenAI-совместимый адрес, обычно заканчивается на /v1.'))));

  // 4–5) Модели
  out.push(h('h3.sect-title', {}, 'Модели'));
  out.push(h('div.group.glass', {},
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
  out.push(h('div.group.glass', {}, h('div.block', {}, pingBtn, plate)));

  // 7) Инструкция
  out.push(h('h3.sect-title', {}, 'Помощь'));
  out.push(h('div.group.glass', {},
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

// ---------- «Оформление» ----------
function lookPage() {
  const look = ctx.state.settings.look;
  const set = (patch) => { Object.assign(look, patch); save(); applyLook(look); };
  const out = [];

  // Тема
  const themes = [['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']];
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Тема' },
    themes.map(([id, name]) => h('button', { type: 'button', 'aria-pressed': String(look.theme === id), onclick: () => { set({ theme: id }); draw(); } }, name)));
  out.push(h('h3.sect-title', {}, 'Тема'));
  out.push(h('div.group.glass', {}, h('div.block', {}, seg,
    h('p.help', {}, '«Авто» — как на iPhone: днём светлая, ночью тёмная. Фон остаётся тем же, меняются плашки и текст.'))));

  // Цвет кнопок
  out.push(h('h3.sect-title', {}, 'Цвет кнопок'));
  out.push(h('div.group.glass', {}, h('div.block', {},
    h('div.swatches', { role: 'group', 'aria-label': 'Цвет кнопок' },
      Object.entries(ACCENTS).map(([id, a]) => h('button.swatch', {
        type: 'button', 'aria-pressed': String(look.accent === id), 'aria-label': a.name,
        onclick: () => { set({ accent: id }); draw(); },
      }, h('b', { style: `background:${document.documentElement.dataset.theme === 'light' ? a.light : a.dark}` }), a.name))))));

  // Плашки
  out.push(h('h3.sect-title', {}, 'Плашки'));
  out.push(h('div.group.glass', {},
    h('div.block', {},
      range('Прозрачность', look.glass, 20, 95, 1, (v) => `${v}%`, (v) => set({ glass: v })),
      range('Размытие фона', look.blur, 0, 40, 1, (v) => String(v), (v) => set({ blur: v })),
      h('p.help', {}, 'Если текст плохо читается на вашем фото — убавьте прозрачность или добавьте размытие.')),
    h('label.row', {},
      h('span.grow', {}, 'Капли дождя', h('span.sub', {}, 'Отключаются сами при «Уменьшении движения»')),
      switchEl(look.rain, (v) => set({ rain: v })))));

  // Фон
  out.push(h('h3.sect-title', {}, 'Фон'));
  const preview = h('div.bg-preview', {});
  if (look.hasBg) loadBg().then((b) => { if (b) preview.style.backgroundImage = `url("${URL.createObjectURL(b)}")`; });
  else preview.classList.add('bg-default');
  const pick = h('button.btn.primary', { type: 'button', onclick: () => pickBg(pick) }, 'Выбрать фото');
  out.push(h('div.group.glass', {}, h('div.block', {},
    look.hasBg ? preview : h('p.help', {}, 'Сейчас фон по умолчанию — «вечер в кофейне». Можно поставить своё фото.'),
    pick,
    look.hasBg ? h('button.btn.danger', { type: 'button', onclick: async () => {
      await deleteBg(); set({ hasBg: false }); applyBg(null); draw(); snackbar('Вернул фон по умолчанию');
    } }, 'Убрать фото') : null,
    h('p.help', {}, 'Фото хранится только на этом телефоне: не уходит в интернет и не попадает в резервную копию. Лучше вертикальное, спокойное сверху.'))));
  return out;
}

function range(label, value, min, max, step, fmt, onChange) {
  const val = h('span', {}, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value: String(value), 'aria-label': label });
  const paint = () => inp.style.setProperty('--p', `${((inp.value - min) / (max - min)) * 100}%`);
  paint();
  inp.addEventListener('input', () => { val.textContent = fmt(+inp.value); paint(); onChange(+inp.value); });
  return h('div.range', {}, h('div.top', {}, h('span', {}, label), val), inp);
}

function switchEl(checked, onChange) {
  const inp = h('input', { type: 'checkbox', role: 'switch', checked });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('span.switch', {}, inp, h('span.track'), h('span.knob'));
}

function pickBg(btn) {
  const inp = h('input', { type: 'file', accept: 'image/*' });
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    btn.disabled = true;
    btn.textContent = 'Обрабатываю…';
    try {
      const blob = await compressImage(f);
      await saveBg(blob);
      const look = ctx.state.settings.look;
      look.hasBg = true;
      save();
      applyBg(blob);
      snackbar('Фон установлен');
    } catch (e) {
      await confirmBox({ title: 'Не получилось', text: e?.message || 'Не удалось сохранить фото', cancel: null });
    } finally {
      draw();
    }
  });
  inp.click();
}
