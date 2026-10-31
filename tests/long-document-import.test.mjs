import test from 'node:test';
import assert from 'node:assert/strict';
import {extractedRequirements} from '../backend/src/requirements-import.mjs';

const make = n => Array.from({length:n},(_,i)=>{
  const number=String(i+1).padStart(3,'0');
  return `[Страница ${i+1}]\nQA Atlas document header\nREQ-${number} — Проверка суммы №${i+1}\n`+
    `Сумма должна быть неотрицательной. Для проверки REQ-${number} ожидается корректный результат.\n`;
}).join('\n\n');

test('a 51 page document yields source REQ-001 through REQ-051',()=>{
  const result=extractedRequirements(make(51),'long.pdf');
  assert.equal(result.length,51);
  assert.deepEqual(result.map(r=>r.key),Array.from({length:51},(_,i)=>`REQ-${String(i+1).padStart(3,'0')}`));
  assert.match(result[24].text,/\[Страница 25\]/);
  assert.match(result[50].text,/REQ-051/);
  assert.equal(result[50].title,'Проверка суммы №51');
});

test('import respects existing keys without duplicate keys',()=>{
  const data=extractedRequirements(make(2),'other.pdf',['REQ-001']);
  assert.equal(new Set(data.map(r=>r.key)).size,2);
  assert.equal(data[0].title,'REQ-001 — Проверка суммы №1');
  assert.equal(data[1].key,'REQ-003');
});

test('page-aware fallback retains the final page instead of hiding it',()=>{
  const text=Array.from({length:51},(_,i)=>`[Страница ${i+1}]\nСтраница ${i+1}: правило`).join('\n');
  const r=extractedRequirements(text,'noids.pdf');
  assert.equal(r.length,51);
  assert.match(r[50].text,/Страница 51:/);
});

test('multiple explicit requirements within one page remain separate',()=>{
  const text='[Страница 1]\nREQ-001 — Первое\nЗначение 1\nREQ-002 — Второе\nЗначение 2';
  const r=extractedRequirements(text,'pair.pdf');
  assert.equal(r.length,2);
  assert.ok(!r[0].text.includes('Значение 2'));
});
