// Применение оформления: тема (авто/светлая/тёмная), цвет кнопок, стекло, капли дождя.
import { ACCENTS } from './core/store.js';
import { inkFor, glassAlpha } from './core/color.js';

const darkMq = matchMedia('(prefers-color-scheme: dark)');
const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
let current = null;

export const resolveTheme = (look) => (look.theme === 'auto' ? (darkMq.matches ? 'dark' : 'light') : look.theme);

export function applyLook(look) {
  current = look;
  const root = document.documentElement;
  const theme = resolveTheme(look);
  const acc = (ACCENTS[look.accent] || ACCENTS.cappuccino)[theme];
  root.dataset.theme = theme;
  root.style.setProperty('--acc', acc);
  root.style.setProperty('--acc-ink', inkFor(acc));
  root.style.setProperty('--glass-a', String(glassAlpha(look.glass, theme)));
  root.style.setProperty('--blur', `${look.blur}px`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1a120c' : '#e9dfd4');
  setRain(look.rain && !reduceMq.matches);
}

function setRain(on) {
  const box = document.getElementById('rain');
  if (!box) return;
  if (!on) { box.replaceChildren(); return; }
  if (box.childElementCount) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 36; i++) {
    const d = document.createElement('i');
    d.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    d.style.animationDuration = `${(0.8 + Math.random() * 0.9).toFixed(2)}s`;
    d.style.animationDelay = `${(-Math.random() * 2).toFixed(2)}s`;
    d.style.opacity = (0.2 + Math.random() * 0.45).toFixed(2);
    frag.append(d);
  }
  box.append(frag);
}

// «Авто»: тема меняется вместе с системой; капли выключаются при «Уменьшении движения».
darkMq.addEventListener?.('change', () => { if (current) applyLook(current); });
reduceMq.addEventListener?.('change', () => { if (current) applyLook(current); });
