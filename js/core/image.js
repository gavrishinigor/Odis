// Размер фона: вписать в рамку, не увеличивая (iPhone: до 1290×2796 точек хватает с запасом).
export const BG_MAX = { w: 1290, h: 2796 };

export function fitSize(w, h, maxW = BG_MAX.w, maxH = BG_MAX.h) {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, maxW / w, maxH / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
