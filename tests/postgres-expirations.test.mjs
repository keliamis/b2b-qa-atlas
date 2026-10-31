import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradePostgresExpirations } from '../backend/src/database.mjs';

function database(columns) {
  const commands = [];
  return {
    commands,
    prepare(sql) {
      assert.match(sql, /information_schema\.columns/);
      return { all: () => columns };
    },
    exec(sql) { commands.push(sql); },
  };
}

test('upgrades legacy PostgreSQL auth expiry columns without dropping data', () => {
  const db = database([
    { table_name: 'sessions', data_type: 'integer' },
    { table_name: 'login_attempts', data_type: 'integer' },
    { table_name: 'account_tokens', data_type: 'integer' },
  ]);
  assert.equal(upgradePostgresExpirations(db), 3);
  assert.deepEqual(db.commands, [
    'BEGIN',
    'ALTER TABLE "sessions" ALTER COLUMN expires_at TYPE BIGINT',
    'ALTER TABLE "login_attempts" ALTER COLUMN expires_at TYPE BIGINT',
    'ALTER TABLE "account_tokens" ALTER COLUMN expires_at TYPE BIGINT',
    'COMMIT',
  ]);
});

test('already upgraded PostgreSQL auth tables remain unchanged', () => {
  const db = database([
    { table_name: 'sessions', data_type: 'bigint' },
    { table_name: 'login_attempts', data_type: 'bigint' },
    { table_name: 'account_tokens', data_type: 'bigint' },
  ]);
  assert.equal(upgradePostgresExpirations(db), 0);
  assert.deepEqual(db.commands, []);
});

test('rolls back partial upgrades if PostgreSQL fails', () => {
  const db = database([{ table_name: 'sessions', data_type: 'integer' }]);
  db.exec = (sql) => {
    db.commands.push(sql);
    if (sql.startsWith('ALTER')) throw new Error('PG error');
  };
  assert.throws(() => upgradePostgresExpirations(db), /PG error/);
  assert.deepEqual(db.commands, ['BEGIN', 'ALTER TABLE "sessions" ALTER COLUMN expires_at TYPE BIGINT', 'ROLLBACK']);
});
