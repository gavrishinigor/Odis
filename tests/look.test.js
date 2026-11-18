// Оформление: читаемость текста на кнопках всех палитр, стекло, размер фона.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCENTS } from '../js/core/store.js';
import { inkFor, contrast, glassAlpha, INK_LIGHT, INK_DARK } from '../js/core/color.js';
import { fitSize } from '../js/core/image.js';

test('кофейные палитры: текст на кнопке читается (контраст ≥ 4.5:1) в обеих темах', () => {
  for (const [id, a] of Object.entries(ACCENTS)) {
    for (const theme of ['dark', 'light']) {
      const c = contrast(a[theme], inkFor(a[theme]));
      assert.ok(c >= 4.5, `${id}/${theme}: контраст ${c.toFixed(2)}`);
    }
  }
  assert.equal(inkFor('#4e3022'), INK_LIGHT);
  assert.equal(inkFor('#f3e3cf'), INK_DARK);
});

test('стекло: «Прозрачность 70%» → 0.30 ночью, плотнее днём, в пределах', () => {
  assert.equal(glassAlpha(70, 'dark'), 0.3);
  assert.equal(glassAlpha(70, 'light'), 0.48);
  assert.equal(glassAlpha(95, 'dark'), 0.05);
  assert.equal(glassAlpha(0, 'light'), 0.92);
});

test('фон: вписывается в 1290×2796 без увеличения', () => {
  assert.deepEqual(fitSize(4032, 3024), { w: 1290, h: 967 });
  assert.deepEqual(fitSize(1290, 2796), { w: 1290, h: 2796 });
  assert.deepEqual(fitSize(3000, 9000), { w: 932, h: 2796 });
  assert.deepEqual(fitSize(464, 780), { w: 464, h: 780 });
  assert.deepEqual(fitSize(0, 10), { w: 0, h: 0 });
});
