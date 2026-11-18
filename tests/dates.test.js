import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, diffDays, formatLong, formatRelative, isISO, isValidTime } from '../js/core/dates.js';

test('даты', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-11-18', '2026-11-15'), 3);
  assert.equal(isISO('2026-02-30'), false);
  assert.equal(isISO('2026-11-18'), true);
  assert.equal(formatLong('2026-11-18'), 'среда, 18 ноября');
  assert.equal(formatRelative('2026-11-19', '2026-11-18'), 'Завтра');
  assert.equal(formatRelative('2026-11-17', '2026-11-18'), 'Вчера');
  assert.equal(formatRelative('2026-11-21', '2026-11-18'), 'сб, 21 ноября');
  assert.equal(isValidTime('09:30'), true);
  assert.equal(isValidTime('24:00'), false);
});
