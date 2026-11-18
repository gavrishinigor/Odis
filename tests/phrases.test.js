// Реальные по смыслу фразы Игоря (плиточник/отделочник), как их выдаёт диктовка iPhone:
// с «ё», без запятых, с заглавными буквами и без, длинные — из нескольких задач.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../js/core/assistant.js';
import { DEFAULT_SETTINGS } from '../js/core/store.js';

const TODAY = '2026-11-18'; // среда
const OFF = { brain: { ...DEFAULT_SETTINGS.brain } }; // ИИ выключен
const noNet = () => { throw new Error('сеть вызывать нельзя'); };

async function run(text) {
  const r = await interpret({ text, today: TODAY, settings: OFF, secrets: { apiKey: 'sk-x' }, fetchImpl: noNet });
  assert.equal(r.usedBrain, false);
  return r.commands;
}

const CASES = [
  ['Завтра в 9 утра заехать на объект Ленина 5 забрать ключи', [{ title: 'Заехать забрать ключи', due: '2026-11-19', time: '09:00', object: 'Ленина 5' }]],
  ['надо купить затирку Церезит серую 5 кг до пятницы', [{ title: 'Купить затирку Церезит серую 5 кг', due: '2026-11-20' }]],
  ['Напомни позвонить Сергею насчёт плитки в 18:30', [{ title: 'Позвонить Сергею насчет плитки', due: TODAY, time: '18:30' }]],
  ['Добавь задачу отправить смету по объекту Садовая 12а в понедельник', [{ title: 'Отправить смету', due: '2026-11-23', object: 'Садовая 12а' }]],
  ['нужно заказать клей для плитки послезавтра', [{ title: 'Заказать клей для плитки', due: '2026-11-20' }]],
  ['Не забыть забрать уголки на объекте Дом Петрова', [{ title: 'Забрать уголки', due: TODAY, object: 'Дом Петрова' }]],
  ['запиши через 2 дня проверить стяжку в ванной', [{ title: 'Проверить стяжку в ванной', due: '2026-11-20' }]],
  ['Надо выставить счёт Ивановым 25 ноября в 10 утра', [{ title: 'Выставить счет Ивановым', due: '2026-11-25', time: '10:00' }]],
  ['ЗАВТРА ВЕЧЕРОМ НАДО ПОЗВОНИТЬ ЭЛЕКТРИКУ', [{ title: 'Позвонить электрику', due: '2026-11-19' }]],
  ['В субботу в 8 утра на объект Гагарина 7 положить плитку в санузле', [{ title: 'Положить плитку в санузле', due: '2026-11-21', time: '08:00', object: 'Гагарина 7' }]],
  // длинная диктовка из нескольких задач — с точками
  ['Надо купить клей завтра. Позвонить Петрову в пятницу. Замерить кухню на объекте Ленина 5 послезавтра.', [
    { title: 'Купить клей', due: '2026-11-19' },
    { title: 'Позвонить Петрову', due: '2026-11-20' },
    { title: 'Замерить кухню', due: '2026-11-20', object: 'Ленина 5' },
  ]],
  // длинная диктовка без знаков препинания
  ['надо завтра купить грунтовку потом отвезти профиль на объект Садовая 12а и ещё позвонить прорабу в 17:00', [
    { title: 'Купить грунтовку', due: '2026-11-19' },
    { title: 'Отвезти профиль', due: TODAY, object: 'Садовая 12а' },
    { title: 'Позвонить прорабу', due: TODAY, time: '17:00' },
  ]],
  ['сделано купить клей', [{ type: 'done', query: 'Купить клей' }]],
  ['отметь позвонить Петрову выполненной', [{ type: 'done', query: 'Позвонить Петрову' }]],
  ['замер кухни готово', [{ type: 'done', query: 'Замер кухни' }]],
];

for (const [text, expected] of CASES) {
  test(`фраза: ${text}`, async () => {
    const got = await run(text);
    assert.equal(got.length, expected.length, `команд: ${JSON.stringify(got)}`);
    expected.forEach((exp, i) => {
      const c = got[i];
      assert.equal(c.type, exp.type || 'add', JSON.stringify(c));
      if (exp.query) { assert.equal(c.query, exp.query); return; }
      assert.equal(c.draft, undefined, `не должно быть черновиком: ${JSON.stringify(c)}`);
      assert.equal(c.title, exp.title);
      assert.equal(c.due, exp.due);
      assert.equal(c.time, exp.time ?? null);
      assert.equal(c.object, exp.object ?? null);
    });
  });
}

test('непонятная фраза при выключенном ИИ — черновик с сырым текстом, сеть не трогаем', async () => {
  const got = await run('Церезит СЕ 40 антрацит две пачки');
  assert.equal(got.length, 1);
  assert.equal(got[0].draft, true);
  assert.equal(got[0].title, 'Церезит СЕ 40 антрацит две пачки');
});
