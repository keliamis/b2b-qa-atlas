import { postgresRaw } from "./postgres.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// PostgreSQL deployments created before 0.7.3 used INTEGER for Unix
// millisecond expirations. They overflow on login/registration and password
// recovery. Schema migrations are already marked applied in those databases,
// so fixing the original CREATE TABLE statements does not upgrade them.
export function upgradePostgresExpirations(raw) {
  const columns = raw.prepare(
    "SELECT table_name, data_type FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='expires_at' AND table_name IN ('sessions','login_attempts','account_tokens')",
  ).all();
  const legacy = columns.filter(({ data_type }) => data_type === "integer" || data_type === "smallint");
  const unsupported = columns.filter(({ data_type }) => !["integer", "smallint", "bigint"].includes(data_type));
  if (unsupported.length) throw new Error("Unsupported PostgreSQL expiration column type");
  if (!legacy.length) return 0;
  raw.exec("BEGIN");
  try {
    for (const { table_name } of legacy) {
      // Names must come from the fixed allowlist, never from untrusted input.
      if (!["sessions", "login_attempts", "account_tokens"].includes(table_name))
        throw new Error("Unexpected expiration table");
      raw.exec(`ALTER TABLE "${table_name}" ALTER COLUMN expires_at TYPE BIGINT`);
    }
    raw.exec("COMMIT");
  } catch (e) {
    raw.exec("ROLLBACK");
    throw e;
  }
  return legacy.length;
}

export function openDatabase(
  filename = process.env.DB_PATH || "./data/qa-atlas.sqlite",
) {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required in production; SQLite is only for local tests/migration");
  if (filename !== ":memory:")
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  const isPostgres=!!process.env.DATABASE_URL && filename!==":memory:";
  const raw = isPostgres ? postgresRaw() : new DatabaseSync(filename);
  raw.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  raw.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      raw.prepare("SELECT name FROM schema_migrations WHERE name=?").get(name)
    )
      continue;
    raw.exec("BEGIN IMMEDIATE");
    try {
      raw.exec(readFileSync(resolve(dir, name), "utf8").replace(isPostgres ? /expires_at INTEGER/g : /(?!) /g,"expires_at BIGINT"));
      raw
        .prepare("INSERT INTO schema_migrations VALUES(?,?)")
        .run(name, new Date().toISOString());
      raw.exec("COMMIT");
    } catch (e) {
      raw.exec("ROLLBACK");
      throw e;
    }
  }
  if (isPostgres) {
    // Upgrade already-deployed PostgreSQL volumes as well as fresh installs.
    upgradePostgresExpirations(raw);
    raw.exec("CREATE EXTENSION IF NOT EXISTS vector");
    const semanticMigration = 'postgres/0001_semantic_vectors.sql';
    if (!raw.prepare('SELECT name FROM schema_migrations WHERE name=?').get(semanticMigration)) {
      raw.exec('BEGIN');
      try {
        raw.exec(readFileSync(resolve(dir, semanticMigration), 'utf8'));
        raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(semanticMigration, new Date().toISOString());
        raw.exec('COMMIT');
      } catch (e) { raw.exec('ROLLBACK'); throw e; }
    }

  }
  class Prepared {
    constructor(sql, args = []) {
      this.sql = sql;
      this.args = args;
    }
    bind(...args) {
      return new Prepared(this.sql, args);
    }
    first() {
      return raw.prepare(this.sql).get(...this.args) || null;
    }
    all() {
      return { results: raw.prepare(this.sql).all(...this.args) };
    }
    run() {
      const r = raw.prepare(this.sql).run(...this.args);
      return {
        success: true,
        meta: {
          changes: Number(r.changes),
          last_row_id: Number(r.lastInsertRowid),
        },
      };
    }
  }
  return {
    raw,
    dialect: isPostgres ? "postgres" : "sqlite",
    prepare: (sql) => new Prepared(sql),
    batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((s) => s.run());
        raw.exec("COMMIT");
        return results;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => raw.close(),
  };
}
