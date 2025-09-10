const { test } = require('node:test');
const assert = require('node:assert');
const { parseQuickWhen } = require('../parseQuickWhen');

function isoDate(date){
  return date.toISOString().slice(0,10);
}

test('tomorrow at 5pm', () => {
  const now = new Date();
  const expected = new Date(now); expected.setDate(now.getDate()+1);
  const res = parseQuickWhen('tomorrow at 5pm');
  assert.strictEqual(res.date, isoDate(expected));
  assert.strictEqual(res.time, '17:00');
});

test('DD/MM/YYYY format', () => {
  const res = parseQuickWhen('14/09/2025 16:00');
  assert.strictEqual(res.date, '2025-09-14');
  assert.strictEqual(res.time, '16:00');
});

test('MM/DD/YYYY with pm', () => {
  const res = parseQuickWhen('09/14/2025 4pm');
  assert.strictEqual(res.date, '2025-09-14');
  assert.strictEqual(res.time, '16:00');
});

test('Spanish mañana', () => {
  const now = new Date();
  const expected = new Date(now); expected.setDate(now.getDate()+1);
  const res = parseQuickWhen('mañana 8:30');
  assert.strictEqual(res.date, isoDate(expected));
  assert.strictEqual(res.time, '08:30');
});

test('French demain', () => {
  const now = new Date();
  const expected = new Date(now); expected.setDate(now.getDate()+1);
  const res = parseQuickWhen('demain 20h');
  assert.strictEqual(res.date, isoDate(expected));
  assert.strictEqual(res.time, '20:00');
});

test('next week', () => {
  const now = new Date();
  const expected = new Date(now); expected.setDate(now.getDate()+7);
  const res = parseQuickWhen('next week 7:00');
  assert.strictEqual(res.date, isoDate(expected));
  assert.strictEqual(res.time, '07:00');
});
