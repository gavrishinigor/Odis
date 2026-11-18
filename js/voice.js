// Запись голоса (MediaRecorder; в Safari — audio/mp4) и расшифровка через OpenAI-совместимый /audio/transcriptions.
import { describeHttp, NETWORK_TEXT, trimUrl } from './core/brain.js';

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

export const voiceSupported = () =>
  typeof MediaRecorder !== 'undefined' && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);

const EXT = (mime) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm');

export class Recorder {
  constructor() { this.stream = null; this.rec = null; this.chunks = []; this.mime = ''; this.startedAt = 0; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = pickMime() || '';
    this.rec = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
    this.mime = this.rec.mimeType || mime || 'audio/mp4';
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.startedAt = Date.now();
  }

  get active() { return this.rec?.state === 'recording'; }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(null);
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime });
        const ms = Date.now() - this.startedAt;
        this.release();
        resolve({ blob, ms });
      };
      this.rec.stop();
    });
  }

  cancel() {
    try { if (this.rec && this.rec.state !== 'inactive') { this.rec.onstop = null; this.rec.stop(); } } catch { /* уже остановлено */ }
    this.release();
  }

  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// Понятный текст для ошибок getUserMedia.
export function micErrorText(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Нет доступа к микрофону. Разрешите его: Настройки iPhone → Safari → Микрофон (или в адресной строке «аА»)';
  if (n === 'NotFoundError') return 'Микрофон не найден';
  if (n === 'NotReadableError') return 'Микрофон занят другим приложением';
  return 'Не удалось включить микрофон';
}

// → текст | throw Error(понятное сообщение)
export async function transcribe({ blob, settings, secrets, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
  const b = settings.brain;
  const form = new FormData();
  form.append('file', blob, `voice.${EXT(blob.type || 'audio/mp4')}`);
  form.append('model', b.transcribeModel);
  form.append('language', 'ru');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${trimUrl(b.baseUrl)}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secrets.apiKey}` },
      body: form,
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? 'Расшифровка не ответила вовремя' : NETWORK_TEXT);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  if (!res.ok) throw new Error(describeHttp(res.status, json));
  const out = String(json?.text ?? '').trim();
  if (!out) throw new Error('Ничего не расслышал — попробуйте ещё раз');
  return out;
}
