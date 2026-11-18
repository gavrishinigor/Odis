// Вход в Google из браузера: Google Identity Services, модель токена (без сервера, без секрета клиента).
// Токен живёт около часа; новый можно получить только по нажатию (окно Google), поэтому
// изменения копятся и уходят после «Войти снова». Сверено по developers.google.com/identity/oauth2/web (2026-11-18).
import { SCOPE } from './core/gcal.js';

const GIS_URL = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'odis.gtoken.v1';

let scriptPromise = null;
let client = null;
let clientFor = '';
let pending = null; // {resolve, reject} текущего входа

export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google не загрузился')));
    s.onerror = () => { scriptPromise = null; reject(new Error('Не удалось загрузить вход Google — проверьте интернет')); };
    document.head.append(s);
  });
  return scriptPromise;
}

// Подготовить клиента заранее (загрузка скрипта асинхронная, а окно входа можно открыть только сразу по нажатию).
export async function prepare(clientId) {
  if (!clientId) return false;
  await loadGis();
  if (client && clientFor === clientId) return true;
  client = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    include_granted_scopes: false,
    callback: (resp) => {
      const p = pending; pending = null;
      if (!p) return;
      if (resp?.error) { p.reject(new Error(resp.error === 'access_denied' ? 'Доступ к Календарю не дан' : `Google: ${resp.error_description || resp.error}`)); return; }
      if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
        p.reject(new Error('Нужно разрешить доступ к событиям Календаря — отметьте галочку в окне Google'));
        return;
      }
      saveToken(resp.access_token, Number(resp.expires_in) || 3600);
      p.resolve(resp.access_token);
    },
    error_callback: (err) => {
      const p = pending; pending = null;
      if (!p) return;
      const t = err?.type;
      p.reject(new Error(t === 'popup_closed' ? 'Окно входа закрыто' : t === 'popup_failed_to_open' ? 'Окно входа не открылось — разрешите всплывающие окна для сайта' : 'Вход в Google не удался'));
    },
  });
  clientFor = clientId;
  return true;
}

export const ready = (clientId) => Boolean(client && clientFor === clientId);

// Вызывать ТОЛЬКО прямо из обработчика нажатия: иначе Safari заблокирует окно.
// prompt: '' — согласие спросят только в первый раз; 'consent' — спросить заново.
export function signIn(prompt = '') {
  if (!client) return Promise.reject(new Error('Вход Google ещё загружается — нажмите ещё раз через секунду'));
  if (pending) pending.reject(new Error('Повторный вход'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt });
  });
}

export function saveToken(token, expiresIn) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ t: token, exp: Date.now() + (expiresIn - 60) * 1000 })); } catch { /* приватный режим */ }
}

export function getToken() {
  try {
    const v = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    return v && v.t && v.exp > Date.now() ? v.t : null;
  } catch { return null; }
}

export function tokenExpiresAt() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')?.exp || 0; } catch { return 0; }
}

export function forgetToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ок */ }
}

export async function signOut() {
  const t = getToken();
  forgetToken();
  if (t && window.google?.accounts?.oauth2) {
    await new Promise((resolve) => window.google.accounts.oauth2.revoke(t, () => resolve()));
  }
}
