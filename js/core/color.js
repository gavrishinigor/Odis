// Цвет текста на кнопке: светлый или тёмный — что контрастнее (WCAG, относительная яркость).
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const INK_LIGHT = '#fff7ee';
export const INK_DARK = '#2a1a0e';

export function inkFor(bg) {
  return contrast(bg, INK_LIGHT) >= contrast(bg, INK_DARK) ? INK_LIGHT : INK_DARK;
}

// Непрозрачность стекла из ползунка «Прозрачность» (в %): в светлой теме стекло чуть плотнее,
// чтобы тёмный текст читался поверх фото.
export function glassAlpha(transparency, theme) {
  const base = (100 - transparency) / 100;
  const a = theme === 'light' ? base + 0.18 : base;
  return Math.round(Math.min(0.92, Math.max(0.05, a)) * 100) / 100;
}
