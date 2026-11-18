// Мелкие помощники интерфейса: создание элементов, окно подтверждения, снекбар, строка статуса.

// h('div.card', {onclick}, child1, 'текст') — текст всегда через textContent (без innerHTML для данных).
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v; // только для своих статичных SVG/разметки
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.7M4 4v4.7h4.7"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
};

export function svg(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstChild;
}

// ---------- окно подтверждения ----------
// confirmBox({title, text|nodes, ok, cancel}) → Promise<boolean>; cancel:null — одна кнопка.
export function confirmBox({ title, text = '', nodes = null, ok = 'ОК', cancel = 'Отмена', danger = false }) {
  const modal = document.getElementById('modal');
  const scrim = document.getElementById('modalScrim');
  const okBtn = document.getElementById('modalOk');
  const cancelBtn = document.getElementById('modalCancel');
  document.getElementById('modalTitle').textContent = title;
  const body = document.getElementById('modalText');
  body.replaceChildren(...(nodes || String(text).split('\n').filter(Boolean).map((p) => h('p', {}, p))));
  okBtn.textContent = ok;
  okBtn.classList.toggle('danger', danger);
  okBtn.classList.toggle('primary', !danger);
  cancelBtn.hidden = cancel === null;
  cancelBtn.textContent = cancel || '';
  const prevFocus = document.activeElement;
  modal.hidden = false;
  scrim.hidden = false;
  okBtn.focus({ preventScroll: true });
  return new Promise((resolve) => {
    const close = (v) => {
      modal.hidden = true;
      scrim.hidden = true;
      okBtn.onclick = cancelBtn.onclick = scrim.onclick = null;
      document.removeEventListener('keydown', onKey);
      prevFocus?.focus?.({ preventScroll: true });
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    okBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    scrim.onclick = () => close(false);
    document.addEventListener('keydown', onKey);
  });
}

// ---------- снекбар «Отменить» ----------
let snackTimer = null;
export function snackbar(text, onUndo = null, ms = 5000) {
  const bar = document.getElementById('snackbar');
  const btn = document.getElementById('snackUndo');
  document.getElementById('snackText').textContent = text;
  btn.hidden = !onUndo;
  btn.onclick = onUndo ? () => { hideSnack(); onUndo(); } : null;
  bar.hidden = false;
  // перезапуск анимации появления
  bar.style.animation = 'none';
  void bar.offsetWidth;
  bar.style.animation = '';
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnack, ms);
}
export function hideSnack() {
  clearTimeout(snackTimer);
  document.getElementById('snackbar').hidden = true;
}

// ---------- строка статуса над док-панелью ----------
let statusTimer = null;
export function status(text, { error = false, ms = 4000 } = {}) {
  const el = document.getElementById('dockStatus');
  clearTimeout(statusTimer);
  if (!text) { el.classList.remove('show'); return; }
  el.textContent = text;
  el.classList.toggle('err', error);
  el.classList.add('show');
  if (ms) statusTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Безопасный доступ к localStorage (в приватном режиме может бросать исключение).
export function safeStorage() {
  try {
    const k = '__odis_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), volatile: true };
  }
}

export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
