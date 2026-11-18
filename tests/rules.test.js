import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, findTask, splitUtterance } from '../js/core/rules.js';

const TODAY = '2026-11-18'; // среда

const add = (text) => {
  const r = parse(text, TODAY);
  assert.equal(r.type, 'add', `ожидалось add для «${text}», получено ${JSON.stringify(r)}`);
  return r;
};

test('добавь задачу: завтра + время', () => {
  const r = add('Добавь задачу купить плитку завтра в 15:00');
  assert.equal(r.title, 'Купить плитку');
  assert.equal(r.due, '2026-11-19');
  assert.equal(r.time, '15:00');
});

test('напомни мне: день недели', () => {
  const r = add('напомни мне позвонить Петрову в пятницу');
  assert.equal(r.title, 'Позвонить Петрову');
  assert.equal(r.due, '2026-11-20');
});

test('тот же день недели → через неделю', () => {
  assert.equal(add('надо купить клей в среду').due, '2026-11-25');
});

test('объект и послезавтра', () => {
  const r = add('надо замерить ванную на объекте Ленина 5 послезавтра');
  assert.equal(r.object, 'Ленина 5');
  assert.equal(r.due, '2026-11-20');
  assert.equal(r.title, 'Замерить ванную');
});

test('объект до запятой', () => {
  const r = add('создай задачу по объекту Дом Петрова, заказать плитку 60х60');
  assert.equal(r.object, 'Дом Петрова');
  assert.equal(r.title, 'Заказать плитку 60х60');
});

test('дата числом и месяцем, следующий год', () => {
  assert.equal(add('запиши вывезти мусор 25 ноября').due, '2026-11-25');
  assert.equal(add('запиши вывезти мусор 5 ноября').due, '2027-11-05');
});

test('через N дней / неделю', () => {
  assert.equal(add('через 3 дня заказать клей').due, '2026-11-21');
  assert.equal(add('через неделю проверить стяжку').due, '2026-11-25');
});

test('время: утра, вечера, часов', () => {
  assert.equal(add('в 9 утра созвониться с Алексеем').time, '09:00');
  assert.equal(add('завтра в 8 вечера отправить смету').time, '20:00');
  assert.equal(add('надо приехать в 10 часов').time, '10:00');
});

test('ё и регистр', () => {
  assert.equal(add('ДОБАВЬ ЗАДАЧУ Купить затирку Завтра').due, '2026-11-19');
});

test('без срока, но с «надо» → на сегодня', () => {
  const r = add('нужно забрать ключи');
  assert.equal(r.due, TODAY);
  assert.equal(r.time, null);
});

test('непонятная фраза → unknown (уйдёт в ИИ)', () => {
  assert.equal(parse('Логан колодки передние', TODAY).type, 'unknown');
  assert.equal(parse('добавь задачу', TODAY).type, 'unknown');
  assert.equal(parse('', TODAY).type, 'unknown');
});

test('команды «сделано»', () => {
  assert.deepEqual(parse('сделано: замерить ванную', TODAY), { type: 'done', query: 'Замерить ванную' });
  assert.equal(parse('замерить ванную готово', TODAY).type, 'done');
  assert.equal(parse('отметь позвонить Петрову выполненным', TODAY).query, 'Позвонить Петрову');
  assert.equal(parse('я выполнил заказать клей', TODAY).type, 'unknown'); // осознанно: без явной команды не гадаем
});

test('splitUtterance', () => {
  assert.deepEqual(splitUtterance('Купить клей. Позвонить Петрову!\nЗамерить ванную'), ['Купить клей.', 'Позвонить Петрову!', 'Замерить ванную']);
});

test('findTask: однозначно, неоднозначно, не найдено', () => {
  const tasks = [
    { id: '1', title: 'Замерить ванную', object: 'Ленина 5' },
    { id: '2', title: 'Заказать клей', object: null },
    { id: '3', title: 'Заказать плитку', object: null },
  ];
  assert.equal(findTask('замерить ванную', tasks).task.id, '1');
  assert.equal(findTask('клей', tasks).task.id, '2');
  assert.equal(findTask('заказать', tasks).ambiguous, true);
  assert.equal(findTask('машина', tasks).task, null);
});
