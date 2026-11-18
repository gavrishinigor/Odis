// Google Календарь: задача ODIS → событие. Без DOM — тестируется в node с заглушкой API.
// Сверено по developers.google.com (Calendar API v3, 2026-11-18): events.insert/patch/delete,
// start/end.date — весь день (end не включается), start/end.dateTime + timeZone, reminders.useDefault=false +
// overrides [{method:'popup', minutes 0..40320}, максимум 5]. Доступ: calendar.events.owned.
import { addDays, isISO, isValidTime } from './dates.js';

export const SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const API = 'https://www.googleapis.com/calendar/v3';
export const DONE_MARK = '✓ ';
export const TIMED_MINUTES = 30; // длительность события с временем

export const DEFAULT_GCAL = {
  enabled: false,          // синхронизация включена (после первого входа)
  clientId: '',            // OAuth Client ID «Веб-приложение» — вводит Игорь, в код не вписываем
  calendarId: 'primary',
  remindMin: 10,           // напоминание для задач со временем, минут до начала
  allDayRemind: 240,       // задачи без времени: минут до полуночи дня задачи (240 = накануне в 20:00), -1 — без напоминания
  syncAllDay: true,        // отправлять и задачи без времени (событие на весь день)
};

export const REMIND_OPTIONS = [[0, 'В момент начала'], [5, 'За 5 минут'], [10, 'За 10 минут'], [15, 'За 15 минут'], [30, 'За 30 минут'], [60, 'За 1 час'], [120, 'За 2 часа']];
export const ALLDAY_OPTIONS = [[-1, 'Без напоминания'], [360, 'Накануне в 18:00'], [240, 'Накануне в 20:00'], [0, 'В полночь']];

export function normalizeGcal(raw) {
  const g = { ...DEFAULT_GCAL, ...(raw && typeof raw === 'object' ? raw : {}) };
  g.enabled = Boolean(g.enabled);
  g.clientId = typeof g.clientId === 'string' ? g.clientId.trim() : '';
  g.calendarId = typeof g.calendarId === 'string' && g.calendarId ? g.calendarId : 'primary';
  g.remindMin = REMIND_OPTIONS.some(([m]) => m === g.remindMin) ? g.remindMin : DEFAULT_GCAL.remindMin;
  g.allDayRemind = ALLDAY_OPTIONS.some(([m]) => m === g.allDayRemind) ? g.allDayRemind : DEFAULT_GCAL.allDayRemind;
  g.syncAllDay = g.syncAllDay !== false;
  return g;
}

// Похоже ли на OAuth Client ID веб-приложения Google («…apps.googleusercontent.com»).
export const looksLikeClientId = (s) => /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(String(s || '').trim());

const pad = (n) => String(n).padStart(2, '0');
function plusMinutes(date, time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / 1440);
  const rest = ((total % 1440) + 1440) % 1440;
  return { date: addDays(date, dayShift), time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` };
}

// Нужна ли задаче запись в Календаре.
export function wantsEvent(task, g) {
  if (!task || task.draft || !isISO(task.due)) return false;
  if (task.done) return Boolean(task.calendarEventId); // выполненные не создаём, только помечаем уже созданные
  if (!task.time && !g.syncAllDay) return false;
  return true;
}

export function eventFromTask(task, g, timeZone = 'Europe/Moscow') {
  const title = task.object ? `${task.title} — ${task.object}` : task.title;
  const body = {
    summary: (task.done ? DONE_MARK : '') + title,
    description: 'Задача из ODIS',
    extendedProperties: { private: { odisId: String(task.id) } },
  };
  if (task.time && isValidTime(task.time)) {
    const end = plusMinutes(task.due, task.time, TIMED_MINUTES);
    body.start = { dateTime: `${task.due}T${task.time}:00`, timeZone };
    body.end = { dateTime: `${end.date}T${end.time}:00`, timeZone };
  } else {
    body.start = { date: task.due };
    body.end = { date: addDays(task.due, 1) }; // конец не включается
  }
  // У выполненной — без напоминаний. Иначе — своё напоминание (не «как в календаре»).
  const minutes = task.time ? g.remindMin : g.allDayRemind;
  body.reminders = { useDefault: false, overrides: !task.done && minutes >= 0 ? [{ method: 'popup', minutes }] : [] };
  return body;
}

// Подпись того, что ушло в Календарь: если поменялась — событие надо обновить.
export function signature(task, g) {
  return JSON.stringify([task.title, task.object || '', task.due, task.time || '', Boolean(task.done), task.time ? g.remindMin : g.allDayRemind]);
}

// Что сделать с задачей: 'insert' | 'patch' | 'delete' | null
export function planFor(task, g) {
  const want = wantsEvent(task, g);
  if (!task.calendarEventId) return want ? 'insert' : null;
  if (!want) return 'delete';
  return task.calSig === signature(task, g) ? null : 'patch';
}

// ---------- REST через fetch (токен передаётся снаружи) ----------
export class CalendarError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function describeGoogle(status, json) {
  const msg = json?.error?.message ? ` — ${String(json.error.message).slice(0, 140)}` : '';
  if (status === 401) return 'Вход в Google истёк — нажмите «Войти снова»';
  if (status === 403) return `Google не дал доступ (403). Проверьте, что Calendar API включён и вы в списке тестовых пользователей${msg}`;
  if (status === 404 || status === 410) return 'Событие не найдено в Календаре';
  if (status === 429) return 'Слишком много запросов к Календарю — повторю позже';
  if (status >= 500) return `Календарь Google недоступен (${status}) — повторю позже`;
  return `Ошибка Календаря ${status}${msg}`;
}

export function calendarApi({ getToken, calendarId = 'primary', fetchImpl = globalThis.fetch }) {
  const base = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
  async function call(method, url, body) {
    const token = getToken();
    if (!token) throw new CalendarError(401, describeGoogle(401));
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new CalendarError(0, 'Нет связи с Google Календарём');
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
    if (!res.ok) throw new CalendarError(res.status, describeGoogle(res.status, json));
    return json;
  }
  return {
    insert: (body) => call('POST', base, body),
    patch: (id, body) => call('PATCH', `${base}/${encodeURIComponent(id)}`, body),
    remove: (id) => call('DELETE', `${base}/${encodeURIComponent(id)}`),
  };
}

// ---------- синхронизация ----------
// Проходит по задачам и очереди удалений, меняет state (calendarEventId, calSig, calDeletes).
// → {inserted, patched, deleted, errors[], authNeeded}
export async function syncAll({ state, api, g, timeZone, limit = 50 }) {
  const out = { inserted: 0, patched: 0, deleted: 0, errors: [], authNeeded: false };
  if (!Array.isArray(state.calDeletes)) state.calDeletes = [];
  // события, которые снова принадлежат задаче (после «Отменить»), не удаляем
  const owned = new Set(state.tasks.map((t) => t.calendarEventId).filter(Boolean));
  state.calDeletes = state.calDeletes.filter((id) => !owned.has(id));

  const stop = (e) => {
    if (e.status === 401) { out.authNeeded = true; return true; }
    out.errors.push(e.message);
    return e.status === 0 || e.status === 429 || e.status >= 500; // нет связи / перегрузка — остановиться до следующего раза
  };

  let budget = limit;
  for (const id of [...state.calDeletes]) {
    if (budget-- <= 0) return out;
    try {
      await api.remove(id);
      out.deleted += 1;
    } catch (e) {
      if (e.status !== 404 && e.status !== 410 && stop(e)) return out;
      if (e.status !== 404 && e.status !== 410) continue;
    }
    state.calDeletes = state.calDeletes.filter((x) => x !== id);
  }

  for (const task of state.tasks) {
    const op = planFor(task, g);
    if (!op) continue;
    if (budget-- <= 0) return out;
    try {
      if (op === 'insert') {
        const ev = await api.insert(eventFromTask(task, g, timeZone));
        task.calendarEventId = ev?.id || null;
        task.calSig = signature(task, g);
        out.inserted += 1;
      } else if (op === 'patch') {
        try {
          await api.patch(task.calendarEventId, eventFromTask(task, g, timeZone));
          out.patched += 1;
        } catch (e) {
          if (e.status !== 404 && e.status !== 410) throw e;
          // событие удалили в Календаре руками — создаём заново (выполненную — не создаём)
          task.calendarEventId = null;
          if (!task.done) {
            const ev = await api.insert(eventFromTask(task, g, timeZone));
            task.calendarEventId = ev?.id || null;
            out.inserted += 1;
          }
        }
        task.calSig = signature(task, g);
      } else if (op === 'delete') {
        try { await api.remove(task.calendarEventId); out.deleted += 1; } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
        task.calendarEventId = null;
        task.calSig = null;
      }
    } catch (e) {
      if (stop(e)) return out;
    }
  }
  return out;
}

// Сколько изменений ждут отправки.
export function pendingCount(state, g) {
  return (state.calDeletes?.length || 0) + state.tasks.filter((t) => planFor(t, g)).length;
}
