// Фоновая синхронизация задач с Google Календарём: после изменений, при открытии и возврате в приложение.
import { syncAll, calendarApi, pendingCount } from './core/gcal.js';
import { getToken, prepare, signIn } from './google.js';

let app = null;
let timer = null;
let running = false;
let again = false;
const status = { authNeeded: false, lastError: '', lastSync: 0, last: null };
const listeners = new Set();

export const calStatus = () => ({ ...status, enabled: Boolean(app?.state.settings.gcal.enabled), pending: app ? pendingCount(app.state, app.state.settings.gcal) : 0 });
export const onCalChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn(calStatus()));
const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'; } catch { return 'Europe/Moscow'; } };

export function initCalSync(theApp) {
  app = theApp;
  const g = app.state.settings.gcal;
  if (g.enabled && g.clientId) prepare(g.clientId).catch(() => { /* без сети — попробуем позже */ });
  status.authNeeded = g.enabled && !getToken();
}

export function scheduleSync(delay = 1200) {
  if (!app?.state.settings.gcal.enabled) return;
  clearTimeout(timer);
  timer = setTimeout(runSync, delay);
}

export async function runSync() {
  const g = app?.state.settings.gcal;
  if (!g?.enabled) return null;
  if (running) { again = true; return null; }
  if (!getToken()) {
    status.authNeeded = pendingCount(app.state, g) > 0 || status.authNeeded;
    notify();
    return null;
  }
  running = true;
  try {
    const r = await syncAll({ state: app.state, api: calendarApi({ getToken, calendarId: g.calendarId }), g, timeZone: timeZone() });
    app.saveQuiet();
    status.authNeeded = r.authNeeded;
    status.lastError = r.errors[0] || '';
    status.lastSync = Date.now();
    status.last = r;
    if (r.inserted || r.patched || r.deleted) app.render();
    return r;
  } finally {
    running = false;
    notify();
    if (again) { again = false; scheduleSync(300); }
  }
}

// Войти снова — вызывать прямо из обработчика нажатия.
export async function reauth(prompt = '') {
  const g = app.state.settings.gcal;
  await signIn(prompt);
  status.authNeeded = false;
  if (!g.enabled) { g.enabled = true; app.saveQuiet(); }
  notify();
  return runSync();
}
