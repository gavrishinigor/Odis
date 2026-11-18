// Состояние приложения: задачи, настройки, автоперенос. Хранилище внедряется (localStorage или заглушка).
import { addDays, diffDays, isISO, isValidTime, toISO } from './dates.js';
import { findTask } from './rules.js';

export const STATE_KEY = 'odis.state.v1';
export const SECRET_KEY = 'odis.secrets.v1';

// Модели и адрес — по proxyapi.ru/docs (сверено 2026-11-18). Цены не храним: смотреть в кабинете.
export const DEFAULT_SETTINGS = {
  brain: {
    enabled: false, // ИИ выключен по умолчанию
    consent: false, // согласие на отправку текста/голоса провайдеру
    provider: 'proxyapi', // 'proxyapi' | 'custom'
    baseUrl: 'https://api.proxyapi.ru/v1',
    model: 'openai/gpt-5-mini',
    transcribeModel: 'openai/gpt-4o-mini-transcribe',
    chatModels: [], // список, полученный от провайдера (GET /models)
    transcribeModels: [],
    modelsFetchedAt: null,
  },
};

// Оформление: тема, цвет кнопок, стекло плашек, капли дождя. Фото фона хранится отдельно (IndexedDB).
export const ACCENTS = {
  cappuccino: { name: 'Капучино', dark: '#96623f', light: '#7a4f34' },
  espresso: { name: 'Эспрессо', dark: '#5b3826', light: '#4e3022' },
  mocha: { name: 'Мокко', dark: '#8a5638', light: '#6e4129' },
  latte: { name: 'Латте', dark: '#c9a07a', light: '#c9a07a' },
  caramel: { name: 'Карамель', dark: '#c4813f', light: '#9c5f24' },
};
export const THEMES = ['auto', 'light', 'dark'];
export const DEFAULT_LOOK = { theme: 'auto', accent: 'cappuccino', glass: 70, blur: 16, rain: true, hasBg: false };
DEFAULT_SETTINGS.look = { ...DEFAULT_LOOK };

const clampNum = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Math.round(+v))) : def);
export function normalizeLook(raw) {
  const l = { ...DEFAULT_LOOK, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!THEMES.includes(l.theme)) l.theme = DEFAULT_LOOK.theme;
  if (!(l.accent in ACCENTS)) l.accent = DEFAULT_LOOK.accent;
  l.glass = clampNum(l.glass, 20, 95, DEFAULT_LOOK.glass);
  l.blur = clampNum(l.blur, 0, 40, DEFAULT_LOOK.blur);
  l.rain = Boolean(l.rain);
  l.hasBg = Boolean(l.hasBg);
  return l;
}

// Адрес из черновика чата — по документации ProxyAPI не подтвердился.
const OLD_URLS = ['https://openai.api.proxyapi.ru/v1'];

export function emptyState() {
  return { v: 1, tasks: [], settings: structuredClone(DEFAULT_SETTINGS), lastDay: null };
}

let counter = 0;
export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  counter += 1;
  return `t${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}`;
}

// Мягкая миграция (schema v1): добавляем недостающие поля и чиним типы; незнакомые поля НЕ удаляем —
// их могла записать более новая версия приложения.
export function migrate(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  Object.assign(base, raw, { v: 1 });
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  base.tasks = tasks
    .filter((t) => t && typeof t.title === 'string' && t.title.trim())
    .map((t) => ({
      ...t,
      id: typeof t.id === 'string' && t.id ? t.id : newId(),
      title: t.title.trim(),
      due: isISO(t.due) ? t.due : toISO(new Date()),
      time: isValidTime(t.time) ? t.time : null,
      object: typeof t.object === 'string' && t.object.trim() ? t.object.trim() : null,
      done: Boolean(t.done),
      doneAt: t.done ? t.doneAt || null : null,
      doneDay: t.done ? t.doneDay || (t.doneAt ? String(t.doneAt).slice(0, 10) : null) : null,
      createdAt: t.createdAt || null,
      carried: Number.isFinite(t.carried) ? t.carried : 0,
      source: t.source || 'manual',
      draft: Boolean(t.draft),
      calendarEventId: t.calendarEventId || null,
      sheetRef: t.sheetRef || null,
    }));
  const seen = new Set();
  for (const t of base.tasks) { if (seen.has(t.id)) t.id = newId(); seen.add(t.id); }
  const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const b = rawSettings.brain && typeof rawSettings.brain === 'object' ? rawSettings.brain : {};
  const brain = { ...structuredClone(DEFAULT_SETTINGS.brain), ...b };
  if (OLD_URLS.includes(brain.baseUrl)) brain.baseUrl = DEFAULT_SETTINGS.brain.baseUrl;
  if (!['proxyapi', 'custom'].includes(brain.provider)) brain.provider = 'proxyapi';
  brain.enabled = Boolean(brain.enabled);
  brain.consent = Boolean(brain.consent);
  for (const k of ['chatModels', 'transcribeModels']) brain[k] = Array.isArray(brain[k]) ? brain[k].filter((x) => typeof x === 'string').slice(0, 500) : [];
  for (const k of ['baseUrl', 'model', 'transcribeModel']) if (typeof brain[k] !== 'string') brain[k] = DEFAULT_SETTINGS.brain[k];
  base.settings = { ...rawSettings, brain, look: normalizeLook(rawSettings.look) };
  base.lastDay = isISO(raw.lastDay) ? raw.lastDay : null;
  return base;
}

export function load(storage) {
  try {
    const raw = storage.getItem(STATE_KEY);
    return migrate(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyState();
  }
}

export function save(storage, state) {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadSecrets(storage) {
  try {
    const s = JSON.parse(storage.getItem(SECRET_KEY) || '{}');
    return { apiKey: typeof s.apiKey === 'string' ? s.apiKey : '' };
  } catch {
    return { apiKey: '' };
  }
}

export function saveSecrets(storage, secrets) {
  try {
    storage.setItem(SECRET_KEY, JSON.stringify({ apiKey: secrets.apiKey || '' }));
    return true;
  } catch {
    return false;
  }
}

// Автоперенос: всё невыполненное с прошлых дней переезжает на сегодня.
export function rollover(state, today) {
  let moved = 0;
  for (const t of state.tasks) {
    if (!t.done && t.due < today) {
      t.carried += diffDays(today, t.due);
      t.due = today;
      moved += 1;
    }
  }
  state.lastDay = today;
  return moved;
}

export function addTask(state, fields, now = new Date()) {
  const task = {
    id: newId(),
    title: String(fields.title).trim().slice(0, 200),
    due: isISO(fields.due) ? fields.due : toISO(now),
    time: isValidTime(fields.time) ? fields.time : null,
    object: fields.object ? String(fields.object).trim().slice(0, 80) : null,
    done: false,
    doneAt: null,
    doneDay: null,
    createdAt: now.toISOString(),
    carried: 0,
    source: fields.source || 'manual',
    draft: Boolean(fields.draft),
    calendarEventId: null,
    sheetRef: null,
  };
  state.tasks.push(task);
  return task;
}

export function setDone(state, id, done, now = new Date()) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return null;
  t.done = done;
  t.doneAt = done ? now.toISOString() : null;
  t.doneDay = done ? toISO(now) : null;
  return t;
}

export function updateTask(state, id, patch) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) t.title = patch.title.trim().slice(0, 200);
  if (isISO(patch.due)) t.due = patch.due;
  if ('time' in patch) t.time = isValidTime(patch.time) ? patch.time : null;
  if ('object' in patch) t.object = patch.object ? String(patch.object).trim().slice(0, 80) : null;
  t.draft = false;
  return t;
}

export function removeTask(state, id) {
  const i = state.tasks.findIndex((x) => x.id === id);
  if (i < 0) return false;
  state.tasks.splice(i, 1);
  return true;
}

const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || (a.createdAt || '').localeCompare(b.createdAt || '');

export function todayOpen(state, today) {
  return state.tasks.filter((t) => !t.done && t.due <= today).sort(byTime);
}

export function todayDone(state, today) {
  return state.tasks.filter((t) => t.done && t.doneDay === today).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
}

export function upcoming(state, today) {
  const groups = new Map();
  for (const t of state.tasks.filter((x) => !x.done && x.due > today).sort((a, b) => a.due.localeCompare(b.due) || byTime(a, b))) {
    if (!groups.has(t.due)) groups.set(t.due, []);
    groups.get(t.due).push(t);
  }
  return [...groups.entries()].map(([date, tasks]) => ({ date, tasks }));
}

export function history(state, today, days = 30) {
  const from = addDays(today, -days);
  const groups = new Map();
  for (const t of state.tasks.filter((x) => x.done && x.doneDay && x.doneDay < today && x.doneDay >= from).sort((a, b) => b.doneDay.localeCompare(a.doneDay) || (b.doneAt || '').localeCompare(a.doneAt || ''))) {
    if (!groups.has(t.doneDay)) groups.set(t.doneDay, []);
    groups.get(t.doneDay).push(t);
  }
  return [...groups.entries()].map(([date, tasks]) => ({ date, tasks }));
}

// Применить команды (из правил или ИИ). Возвращает человекочитаемый итог.
export function applyCommands(state, commands, now = new Date()) {
  const result = { added: [], done: [], notFound: [], ambiguous: [] };
  const today = toISO(now);
  for (const c of commands) {
    if (c.type === 'add') {
      result.added.push(addTask(state, { ...c, source: c.draft ? 'raw' : 'voice' }, now));
    } else if (c.type === 'done') {
      const open = todayOpen(state, today).concat(state.tasks.filter((t) => !t.done && t.due > today));
      const r = findTask(c.query, open);
      if (r.task) { setDone(state, r.task.id, true, now); result.done.push(r.task); }
      else if (r.ambiguous) result.ambiguous.push(c.query);
      else result.notFound.push(c.query);
    }
  }
  return result;
}

// ---------- резервная копия ----------
// Ключ API в копию НЕ входит: он лежит отдельно (SECRET_KEY).
export function exportBackup(state, now = new Date()) {
  return JSON.stringify({ app: 'odis', exportedAt: now.toISOString(), state }, null, 2);
}

// → {ok:true, state} | {ok:false, message}
export function importBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, message: 'Файл не похож на копию ODIS (не JSON)' }; }
  const st = raw?.app === 'odis' ? raw.state : raw;
  if (!st || typeof st !== 'object' || !Array.isArray(st.tasks)) return { ok: false, message: 'В файле нет списка задач ODIS' };
  return { ok: true, state: migrate(st) };
}
