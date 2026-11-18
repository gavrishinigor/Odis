// Локальные правила разбора русской речи: мгновенно, бесплатно, офлайн.
// То, что правила не поняли, уходит в ИИ (если он включён).
import { addDays, fromISO, toISO, weekday, pad } from './dates.js';

// \b не работает с кириллицей, поэтому свои границы слов.
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const re = (src, flags = 'iu') => new RegExp(src, flags);

const MONTHS = { января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5, июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11 };
const WD_STEMS = [['воскресень', 0], ['понедельник', 1], ['вторник', 2], ['сред', 3], ['четверг', 4], ['пятниц', 5], ['суббот', 6]];

export function normalize(text) {
  let s = String(text || '').replace(/ё/gi, (m) => (m === 'Ё' ? 'Е' : 'е')).replace(/[ \t]+/g, ' ').trim();
  // ВСЁ ЗАГЛАВНЫМИ (включённый Caps Lock / крик диктовки) → строчными
  if (/\p{Lu}{4}/u.test(s) && !/\p{Ll}/u.test(s)) s = s.toLowerCase();
  return s;
}

function cut(s, match) {
  return (s.slice(0, match.index) + ' ' + s.slice(match.index + match[0].length)).replace(/\s+/g, ' ').trim();
}

// ---------- время ----------
export function extractTime(s) {
  let m = s.match(re(`${B}(?:в|к|до|около)\\s+(\\d{1,2})[:.](\\d{2})${E}`));
  if (m) {
    const h = +m[1], min = +m[2];
    if (h <= 23 && min <= 59) return { time: `${pad(h)}:${pad(min)}`, rest: cut(s, m) };
  }
  m = s.match(re(`${B}(?:в|к)\\s+(\\d{1,2})\\s*(?:час(?:а|ов)?\\s*)?(утра|дня|вечера|ночи)${E}`));
  if (m) {
    let h = +m[1];
    const part = m[2].toLowerCase();
    if (h >= 1 && h <= 12) {
      if (part === 'утра') h = h === 12 ? 0 : h;
      else if (part === 'дня') h = h < 12 ? h + 12 : h;
      else if (part === 'вечера') h = h < 12 ? h + 12 : h;
      else if (part === 'ночи') h = h === 12 ? 0 : h >= 10 ? h + 12 : h;
      return { time: `${pad(h)}:00`, rest: cut(s, m) };
    }
  }
  m = s.match(re(`${B}(?:в|к)\\s+(\\d{1,2})\\s+час(?:а|ов)?${E}`));
  if (m && +m[1] <= 23) return { time: `${pad(+m[1])}:00`, rest: cut(s, m) };
  // «утром / днём / вечером» без часа: из названия убираем, время не выдумываем
  m = s.match(re(`${B}(?:с\\s+)?(?:утром|днем|вечером|ночью|с\\s+утра)${E}`));
  if (m) return { time: null, rest: cut(s, m) };
  return { time: null, rest: s };
}

// ---------- дата ----------
export function extractDate(s, today) {
  const pre = '(?:(?:на|к|до|в|во)\\s+)?';
  let m;
  if ((m = s.match(re(`${B}${pre}послезавтра${E}`)))) return { due: addDays(today, 2), rest: cut(s, m) };
  if ((m = s.match(re(`${B}${pre}завтра(?:шн(?:ий|юю|его))?${E}`)))) return { due: addDays(today, 1), rest: cut(s, m) };
  if ((m = s.match(re(`${B}${pre}сегодня(?:шн(?:ий|юю|его))?${E}`)))) return { due: today, rest: cut(s, m) };
  if ((m = s.match(re(`${B}через\\s+(\\d{1,3})\\s+(?:дн(?:я|ей)|день)${E}`)))) return { due: addDays(today, +m[1]), rest: cut(s, m) };
  if ((m = s.match(re(`${B}через\\s+(\\d{1,2})\\s+недел(?:ю|и|ь)${E}`)))) return { due: addDays(today, 7 * +m[1]), rest: cut(s, m) };
  if ((m = s.match(re(`${B}через\\s+неделю${E}`)))) return { due: addDays(today, 7), rest: cut(s, m) };

  const months = Object.keys(MONTHS).join('|');
  if ((m = s.match(re(`${B}${pre}(\\d{1,2})\\s+(${months})${E}`)))) {
    const day = +m[1], mon = MONTHS[m[2].toLowerCase()];
    const t = fromISO(today);
    let y = t.getFullYear();
    let cand = new Date(y, mon, day);
    if (cand.getMonth() === mon && cand.getDate() === day) {
      if (toISO(cand) < today) cand = new Date(y + 1, mon, day);
      return { due: toISO(cand), rest: cut(s, m) };
    }
  }

  const wdRe = re(`${B}(?:(?:в|во|на|к|до)\\s+)?(понедельник[ау]?|вторник[ау]?|сред[уаые]|четверг[ау]?|пятниц[уаые]|суббот[уаые]|воскресень[еяю])${E}`);
  if ((m = s.match(wdRe))) {
    const word = m[1].toLowerCase();
    const target = WD_STEMS.find(([stem]) => word.startsWith(stem))[1];
    let delta = (target - weekday(today) + 7) % 7;
    if (delta === 0) delta = 7;
    return { due: addDays(today, delta), rest: cut(s, m) };
  }
  return { due: null, rest: s };
}

// ---------- объект ----------
// Название объекта: первое слово любое, дальше — слова с заглавной буквы, номера («5», «12а», «5/2»)
// и служебные слова адреса. Глагол со строчной («забрать») название обрывает.
const OBJ_STOP = new Set(['насчет', 'про', 'чтобы', 'и', 'потом', 'где', 'там', 'что', 'надо', 'нужно', 'а', 'но']);
const OBJ_GLUE = new Set(['дом', 'д', 'улица', 'ул', 'кв', 'квартира', 'корпус', 'корп', 'стр', 'строение', 'офис', 'на', 'у']);
const isName = (t) => /^[\p{Lu}\d]/u.test(t);
export function extractObject(s) {
  const m = s.match(re(`${B}(?:(?:по|на|для|у|к|до|в|с)\\s+)?объект(?:е|у|а|ом)?\\s+([^,.;]+)`));
  if (!m) return { object: null, rest: s };
  const tokens = m[1].trim().split(/\s+/);
  const taken = [];
  for (const t of tokens) {
    const low = t.toLowerCase().replace(/\.$/, '');
    if (OBJ_STOP.has(low) || taken.length >= 4) break;
    if (taken.length && !isName(t) && !OBJ_GLUE.has(low)) break;
    taken.push(t);
  }
  while (taken.length && OBJ_GLUE.has(taken[taken.length - 1].toLowerCase().replace(/\.$/, '')) && taken.length > 1) taken.pop();
  if (!taken.length) return { object: null, rest: s };
  const full = m[0].slice(0, m[0].length - m[1].length) + m[1].trim().split(/\s+/).slice(0, taken.length).join(' ');
  const idx = m.index;
  const rest = (s.slice(0, idx) + ' ' + s.slice(idx + full.length)).replace(/\s+/g, ' ').trim();
  return { object: taken.join(' '), rest };
}

// ---------- команды ----------
const ADD_TRIGGER = re(
  '^(?:пожалуйста[, ]*)?(?:' +
    `(?:добавь|создай|запиши|поставь|внеси|занеси)${E}\\s*(?:мне\\s+)?(?:новую\\s+)?(?:(?:задачу|задачи|дело|напоминание)${E})?\\s*[:,\\-–—]?\\s*` +
    '|' +
    `напомни(?:ть)?${E}\\s*(?:мне\\s+)?(?:про\\s+|о\\s+|об\\s+)?` +
    '|' +
    `(?:мне\\s+)?(?:надо|нужно|необходимо|не\\s+забыть|не\\s+забудь)${E}\\s*[:,\\-–—]?\\s*` +
    '|' +
    `(?:задача|дело)${E}\\s*[:,\\-–—]?\\s*` +
    ')',
);

const DONE_PREFIX = re(
  `^(?:(?:отметь|отметить)\\s+(?:галочку\\s+)?(?:у\\s+|на\\s+)?|поставь\\s+галочку\\s+(?:у\\s+|на\\s+)?|(?:выполнен\\p{L}*|сделан\\p{L}*|готов[оаы]?|закрой|закрыть|сделал[аи]?|выполнил[аи]?|завершил[аи]?)${E}\\s*)[:,\\-–—]?\\s*(.+)$`,
);
const DONE_SUFFIX = re(
  `^(.+?)\\s+(?:сделано|сделан[аы]?|готово|выполнено|выполнен[аы]?|закрыт[оаы]?|сделал[аи]?|выполнил[аи]?)${E}[.!]?$`,
);
const DONE_MARK = re(`^отметь\\s+(.+?)\\s+(?:как\\s+)?(?:выполненн\\p{L}*|сделанн\\p{L}*)${E}[.!]?$`);

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function cleanTitle(s) {
  return capitalize(
    s
      .replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, '')
      .replace(re(`^(?:что|чтобы)${E}\\s*`), '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

// parse(text, today) → {type:'add'|'done'|'unknown', ...}
export function parse(text, today, { assumeTask = false } = {}) {
  let s = normalize(text);
  if (!s) return { type: 'unknown', text: '' };
  s = s.replace(/[.!?]+$/, '').trim();

  // 1) «готово / сделано …»
  let m = s.match(DONE_MARK) || s.match(DONE_PREFIX) || s.match(DONE_SUFFIX);
  if (m) {
    const query = cleanTitle(m[1]);
    if (query) return { type: 'done', query };
  }

  // 2) добавление
  const trig = s.match(ADD_TRIGGER);
  let body = trig ? s.slice(trig[0].length) : s;
  const t = extractTime(body);
  const d = extractDate(t.rest, today);
  const o = extractObject(d.rest);
  // «завтра вечером надо …»: команда может стоять после даты/времени
  let rest = o.rest;
  const late = trig ? null : rest.match(ADD_TRIGGER);
  if (late) rest = rest.slice(late[0].length);
  const title = cleanTitle(rest);
  const hasHint = assumeTask || Boolean(trig || late) || d.due !== null || t.time !== null;
  if (!hasHint || !title) return { type: 'unknown', text: s };
  return { type: 'add', title, due: d.due || today, time: t.time, object: o.object, via: 'rules' };
}

// Разбить длинную диктовку на фразы: по знакам препинания, переводам строк
// и по словам-связкам («потом», «ещё», «а также», «и надо …»), если пунктуации нет.
const TRIGGER_WORDS = '(?:надо|нужно|необходимо|напомни|добавь|запиши|создай|не\\s+забыть|не\\s+забудь)';
const JOINERS = re(`\\s+(?:(?:и|а)\\s+)?(?:потом|затем|ещ[её]|а\\s+также|также|плюс)${E}\\s*(?:${TRIGGER_WORDS}${E}\\s*)?|\\s+(?:и|а)\\s+(?=${TRIGGER_WORDS}${E})|\\s+(?=${TRIGGER_WORDS}${E})`, 'giu');

export function splitUtterance(text) {
  return String(text || '')
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((p) => p.trim())
    .filter(Boolean);
}

// → [{text, assumeTask}] — куски одной фразы, разрезанной по связкам, считаются задачами,
// если в фразе была команда добавления («надо», «добавь», «напомни»…).
export function splitDictation(text) {
  const out = [];
  for (const sentence of splitUtterance(text)) {
    const norm = normalize(sentence);
    const pieces = norm.split(JOINERS).map((p) => p && p.trim()).filter((p) => p && /[\p{L}\d]/u.test(p));
    if (pieces.length <= 1) { out.push({ text: sentence, assumeTask: false }); continue; }
    const hadTrigger = ADD_TRIGGER.test(pieces[0]) || pieces.some((p, i) => i > 0 && re(`^${TRIGGER_WORDS}${E}`).test(p)) || re(`${B}${TRIGGER_WORDS}${E}`).test(norm);
    // кусок только из даты/времени («завтра вечером») приклеиваем к следующему
    const merged = [];
    for (let i = 0; i < pieces.length; i++) {
      const onlyWhen = !extractDate(extractTime(pieces[i]).rest, '2000-01-01').rest.replace(/[^\p{L}\d]/gu, '');
      if (onlyWhen && i < pieces.length - 1) pieces[i + 1] = `${pieces[i]} ${pieces[i + 1]}`;
      else merged.push(pieces[i]);
    }
    if (merged.length <= 1) { out.push({ text: merged[0] || sentence, assumeTask: false }); continue; }
    merged.forEach((p, i) => out.push({ text: p, assumeTask: hadTrigger && i > 0 }));
  }
  return out;
}

// ---------- поиск задачи по словам ----------
const stems = (s) =>
  normalize(s)
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 5));

// Возвращает {task} | {ambiguous:true} | {task:null}
export function findTask(query, tasks) {
  const q = stems(query);
  if (!q.length) return { task: null };
  let best = [];
  let bestScore = 0;
  for (const task of tasks) {
    const ts = new Set(stems(task.title + ' ' + (task.object || '')));
    const hit = q.filter((w) => ts.has(w)).length;
    const score = hit / q.length;
    if (score > bestScore) { bestScore = score; best = [task]; }
    else if (score === bestScore && score > 0) best.push(task);
  }
  if (bestScore < 0.6 || !best.length) return { task: null };
  if (best.length > 1) return { task: null, ambiguous: true, candidates: best };
  return { task: best[0] };
}
