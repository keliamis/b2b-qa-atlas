import { backup } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDatabase } from "./database.mjs";
const path = resolve(
  process.argv[2] ||
    `./backups/qa-atlas-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
);
if (existsSync(path)) throw new Error("Копия с таким именем уже существует");
mkdirSync(dirname(path), { recursive: true });
const db = openDatabase();
try {
  await backup(db.raw, path);
  console.log(path);
} finally {
  db.close();
}
