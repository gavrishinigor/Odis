// Фото фона: выбирается на телефоне, сжимается и хранится только на устройстве (IndexedDB).
// В репозиторий и в резервную копию не попадает.
import { fitSize } from './core/image.js';

const DB = 'odis-media';
const STORE = 'files';
const KEY = 'background';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Нет IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Отменено'));
    });
  } finally {
    db.close();
  }
}

export const loadBg = () => tx('readonly', (s) => s.get(KEY)).catch(() => null);
export const saveBg = (blob) => tx('readwrite', (s) => s.put(blob, KEY));
export const deleteBg = () => tx('readwrite', (s) => s.delete(KEY)).catch(() => null);

// Файл → сжатый JPEG (вписан в 1290×2796, качество 0.86).
export async function compressImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Это не картинка');
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    // запасной путь для старых Safari
    bmp = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не удалось открыть картинку (формат HEIC? Попробуйте JPEG/PNG)'));
      img.src = URL.createObjectURL(file);
    });
  }
  const { w, h } = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Не удалось сжать картинку');
  return blob;
}

let currentUrl = null;
// Показать фон (blob) или кофейный градиент по умолчанию (null).
export function applyBg(blob) {
  const el = document.getElementById('bg');
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = blob ? URL.createObjectURL(blob) : null;
  el.style.backgroundImage = currentUrl ? `url("${currentUrl}")` : '';
  el.classList.toggle('photo', Boolean(currentUrl));
}
