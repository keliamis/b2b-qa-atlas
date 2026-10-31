import { DatabaseSync } from "node:sqlite";
import { existsSync, copyFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
const source = process.argv[2],
  target = resolve(process.env.DB_PATH || "./data/qa-atlas.sqlite");
if (!source)
  throw new Error(
    "Укажите путь к резервной копии. Перед восстановлением остановите backend",
  );
if (resolve(source) === target)
  throw new Error("Источник и текущая база совпадают");
for (const suffix of ["-wal", "-shm"])
  if (existsSync(target + suffix))
    throw new Error(
      "База ещё открыта или остались WAL-файлы. Остановите backend и проверьте его завершение; не удаляйте WAL вручную",
    );
const check = new DatabaseSync(resolve(source), { readOnly: true });
try {
  if (check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("Копия не прошла проверку целостности");
  for (const table of ["accounts", "projects", "schema_migrations"])
    check.prepare(`SELECT count(*) FROM ${table}`).get();
} finally {
  check.close();
}
mkdirSync(dirname(target), { recursive: true });
const temp = target + ".restoring";
copyFileSync(resolve(source), temp);
if (existsSync(target))
  renameSync(target, target + ".before-restore-" + Date.now());
renameSync(temp, target);
console.log("База восстановлена. Запустите backend и проверьте вход и проекты");
