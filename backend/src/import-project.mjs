import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { openDatabase } from "./database.mjs";
import { handleWorkspace } from "../dist/workspace.mjs";
import { normalizeEmail } from "./auth.mjs";
const [email, path] = process.argv.slice(2);
if (!email || !path)
  throw new Error("Укажите EMAIL владельца и путь к project.json");
const db = openDatabase();
try {
  const user = db.raw
    .prepare("SELECT id,email,name FROM accounts WHERE email=? AND disabled=0")
    .get(normalizeEmail(email));
  if (!user) throw new Error("Сначала создайте аккаунт владельца");
  const p = JSON.parse(readFileSync(path, "utf8"));
  p.id = randomUUID();
  p.revision = 0;
  p.audit = [];
  delete p.role;
  for (const c of p.cases || []) delete c.assigneeId;
  const origin = process.env.PUBLIC_ORIGIN || "http://localhost:8080";
  const r = await handleWorkspace(
    new Request(origin + "/workspace-api/projects/" + p.id, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "oai-authenticated-user-id": user.id,
        "oai-authenticated-user-email": user.email,
        "oai-authenticated-user-full-name": encodeURIComponent(user.name),
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      },
      body: JSON.stringify(p),
    }),
    db,
  );
  const result = await r.json();
  if (!r.ok) throw new Error(result.detail);
  console.log("Создана отдельная копия проекта:", result.name, result.id);
} finally {
  db.close();
}
