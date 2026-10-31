import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../backend/src/database.mjs';
import { createAccount, login, register } from '../backend/src/auth.mjs';

// PostgreSQL sees both the target and EXCLUDED rows in ON CONFLICT; an
// unqualified "count" in the right hand expression raises SQLSTATE 42702.
test('all authentication rate-limit upserts qualify the existing count column', () => {
  const sources = ['backend/src/auth.mjs', 'backend/src/recovery.mjs']
    .map((path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')).join('\n');
  const updates = [...sources.matchAll(/ON CONFLICT\(key\) DO UPDATE SET count=([^"'\n]+)/g)];
  assert.equal(updates.length, 3, 'login, registration and recovery must all be covered');
  for (const [, expression] of updates)
    assert.equal(expression.trim(), 'login_attempts.count+1');
});

test('failed and successful sign-in update attempt counters without SQL errors', async () => {
  const db = openDatabase(':memory:');
  try {
    await createAccount(db, 'counter@example.test', 'Counter', 'very-secure-password');
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        login(db, { email: 'counter@example.test', password: 'wrong-password' }, '203.0.113.3'),
        { status: 401 },
      );
    }
    assert.equal(db.raw.prepare('SELECT count FROM login_attempts WHERE key LIKE ?').all('email:%')[0].count, 2);
    const result = await login(db, { email: 'counter@example.test', password: 'very-secure-password' }, '203.0.113.3');
    assert.equal(result.user.email, 'counter@example.test');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  } finally { db.close(); }
});

test('registration increments rate limit counters on repeated valid requests', async () => {
  const db = openDatabase(':memory:');
  try {
    await register(db, { email: 'one@example.test', name: 'One', password: 'very-secure-password', confirmPassword: 'very-secure-password' }, '198.51.100.1');
    await register(db, { email: 'two@example.test', name: 'Two', password: 'very-secure-password', confirmPassword: 'very-secure-password' }, '198.51.100.1');
    assert.equal(db.raw.prepare('SELECT MAX(count) AS n FROM login_attempts').get().n, 2);
  } finally { db.close(); }
});
