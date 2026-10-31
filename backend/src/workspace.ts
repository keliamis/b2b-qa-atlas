import { viewSchema, defectCreateSchema, defectUpdateSchema } from "./quality";
import { z } from "zod";
import {
  projectSchema,
  canEdit,
  invalidateReviews,
  runResultSchema,
} from "./validation";
type DB = any;
const now = () => new Date().toISOString();
const fail = (status: number, message: string) => {
  throw Object.assign(new Error(message), { status });
};
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
async function hash(s: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function body(req: Request) {
  const s = await req.text();
  if (s.length > 8_000_000) fail(413, "Размер проекта превышает 8 МБ");
  try {
    return JSON.parse(s);
  } catch {
    fail(400, "Некорректный JSON");
  }
}
export async function handleWorkspace(req: Request, db: DB | undefined) {
  try {
    if (!db) fail(503, "Хранилище ещё не подключено");
    const database = db!;
    const uid = req.headers.get("oai-authenticated-user-id");
    const email = req.headers
      .get("oai-authenticated-user-email")
      ?.trim()
      .toLowerCase();
    if (!uid || !email) fail(401, "Войдите в аккаунт QA Atlas");
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.get("origin");
      if (origin && origin !== new URL(req.url).origin)
        fail(403, "Запрос с другого сайта запрещён");
    }
    let name = req.headers.get("oai-authenticated-user-full-name") || email!;
    if (
      req.headers.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
    ) {
      try {
        name = decodeURIComponent(name);
      } catch {
        name = email!;
      }
    }
    await database
      .prepare(
        "INSERT INTO profiles(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name",
      )
      .bind(uid, email, name, now())
      .run();
    const path = new URL(req.url).pathname
      .replace(/^\/workspace-api\/?/, "")
      .split("/")
      .filter(Boolean);
    const method = req.method;
    const membership = async (pid: string, write = false, owner = false) => {
      const m = await database
        .prepare("SELECT role FROM members WHERE project_id=? AND user_id=?")
        .bind(pid, uid)
        .first<{ role: string }>();
      if (!m) fail(404, "Проект не найден или доступ закрыт");
      if ((owner && m!.role !== "owner") || (write && !canEdit(m!.role)))
        fail(403, "Недостаточно прав");
      if (write) {
        const project = await database.prepare("SELECT data FROM projects WHERE id=?").bind(pid).first<any>();
        if (project && JSON.parse(project.data).archived) fail(409, "Проект в архиве. Сначала восстановите его");
      }
      return m!.role;
    };
    const getProject = async (pid: string) => {
      const row = await database
        .prepare("SELECT * FROM projects WHERE id=?")
        .bind(pid)
        .first<any>();
      if (!row) fail(404, "Проект не найден");
      return row;
    };
    if (path[0] === "session" && method === "GET")
      return json({ id: uid, email, name, auth: "password" });
    if (
      path[0] === "invitations" &&
      path[1] === "accept" &&
      method === "POST"
    ) {
      const { token } = z
        .object({ token: z.string().min(32).max(200) })
        .parse(await body(req));
      const tokenHash = await hash(token);
      const inv = await database
        .prepare(
          "SELECT * FROM invitations WHERE token_hash=? AND revoked=0 AND expires_at>?",
        )
        .bind(tokenHash, now())
        .first<any>();
      if (
        !inv ||
        inv.email !== email ||
        (inv.accepted_by && inv.accepted_by !== uid)
      )
        fail(
          403,
          "Приглашение недействительно, истекло или предназначено другой почте",
        );
      await database.batch([
        database
          .prepare(
            "INSERT INTO members(project_id,user_id,role) SELECT project_id,?,role FROM invitations WHERE id=? AND revoked=0 AND expires_at>? AND email=? AND (accepted_by IS NULL OR accepted_by=?) ON CONFLICT(project_id,user_id) DO NOTHING",
          )
          .bind(uid, inv.id, now(), email, uid),
        database
          .prepare(
            "UPDATE invitations SET accepted_by=? WHERE id=? AND revoked=0 AND email=? AND (accepted_by IS NULL OR accepted_by=?)",
          )
          .bind(uid, inv.id, email, uid),
      ]);
      await membership(inv.project_id);
      return json({ projectId: inv.project_id });
    }
    if (path[0] !== "projects") fail(404, "Маршрут не найден");
    if (path.length === 1 && method === "GET") {
      const rows = await database
        .prepare(
          "SELECT p.data,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.updated_at DESC",
        )
        .bind(uid)
        .all<any>();
      return json(
        rows.results.map((r) => ({ ...JSON.parse(r.data), role: r.role })),
      );
    }
    const pid = path[1];
    if (!pid) fail(404, "Не указан проект");
    if (path.length === 2 && method === "PUT") {
      let p = projectSchema.parse(await body(req));
      if (p.id !== pid) fail(400, "ID проекта не совпадает");
      const row = await database
        .prepare("SELECT * FROM projects WHERE id=?")
        .bind(pid)
        .first<any>();
      let role = "owner";
      if (row) {
        role = await membership(pid, true);
        if (row.revision !== p.revision)
          fail(409, "Проект изменился. Обновите данные перед сохранением.");
        p = invalidateReviews(p, JSON.parse(row.data));
      } else if (p.revision !== 0)
        fail(409, "Создание проекта требует версии 0");
      const prev = row ? JSON.parse(row.data) : null;
      if (Boolean(p.archived) !== Boolean(prev?.archived)) fail(400, "Используйте действие архивации проекта");
      const assignees = p.cases.map((c) => c.assigneeId).filter(Boolean);
      if (assignees.length) {
        const ms = await database
          .prepare(
            "SELECT user_id FROM members WHERE project_id=? AND role IN ('owner','tester')",
          )
          .bind(pid)
          .all<any>();
        for (const c of p.cases) {
          if (
            c.assigneeId &&
            !ms.results.some((m) => m.user_id === c.assigneeId)
          ) {
            const old = prev?.cases.find((v: any) => v.id === c.id);
            if (old?.assigneeId === c.assigneeId) delete c.assigneeId;
            else
              fail(
                400,
                "Ответственный должен быть участником проекта с правом редактирования",
              );
          }
        }
      }
      const last = p.audit.at(-1);
      p.audit = [
        ...(prev?.audit || []).slice(-999),
        {
          id: crypto.randomUUID(),
          at: now(),
          action: last?.action || "Сохранён проект",
          target: last?.target || p.name,
          actor: name,
        },
      ];
      p.revision++;
      if (row) {
        const result = await database
          .prepare(
            "UPDATE projects SET data=?,revision=?,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM members WHERE project_id=? AND user_id=? AND role IN ('owner','tester'))",
          )
          .bind(
            JSON.stringify(p),
            p.revision,
            now(),
            pid,
            row.revision,
            pid,
            uid,
          )
          .run();
        if (!result.meta.changes)
          fail(409, "Проект или ваши права изменились. Обновите данные.");
        // Comments belong to live cases; historical run and defect snapshots remain intact.
        const currentIds = new Set(p.cases.map((c) => c.id));
        const removedIds = prev.cases.filter((c: any) => !currentIds.has(c.id)).map((c: any) => c.id);
        if (removedIds.length) {
          await database.prepare(`DELETE FROM comments WHERE project_id=? AND case_id IN (${removedIds.map(() => "?").join(",")})`).bind(pid, ...removedIds).run();
        }
      } else
        await database.batch([
          database
            .prepare(
              "INSERT INTO projects(id,owner_id,data,revision,updated_at) VALUES(?,?,?,?,?)",
            )
            .bind(pid, uid, JSON.stringify(p), p.revision, now()),
          database
            .prepare(
              "INSERT INTO members(project_id,user_id,role) VALUES(?,?,?)",
            )
            .bind(pid, uid, "owner"),
        ]);
      return json({ ...p, role });
    }
    if (path.length === 2 && method === "DELETE") {
      await membership(pid, false, true);
      const running = await database.prepare(
        "SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','running') LIMIT 1",
      ).bind(pid).first<any>();
      if (running) fail(409, "Сначала завершите или отмените активный прогон либо генерацию");
      // No database rows from the deleted project are visible to other users.
      // Do not remove accounts: membership in other projects must be preserved.
      await database.batch([
        ...["comments", "invitations", "members", "manual_runs", "defects", "saved_views", "jobs"].map(
          (table) => database.prepare(`DELETE FROM ${table} WHERE project_id=?`).bind(pid),
        ),
        database.prepare("DELETE FROM projects WHERE id=? AND owner_id=?").bind(pid, uid),
      ]);
      return json({ ok: true });
    }
    await membership(pid);
    if (path[2] === "views") {
      if (method === "GET") {
        const rows = await database
          .prepare(
            "SELECT data FROM saved_views WHERE project_id=? AND user_id=? ORDER BY created_at",
          )
          .bind(pid, uid)
          .all<any>();
        return json(rows.results.map((r) => JSON.parse(r.data)));
      }
      if (method === "POST") {
        const v = viewSchema.parse(await body(req));
        const count = await database
          .prepare(
            "SELECT COUNT(*) AS n FROM saved_views WHERE project_id=? AND user_id=?",
          )
          .bind(pid, uid)
          .first<any>();
        if (count.n >= 30)
          fail(400, "В проекте можно сохранить до 30 личных представлений");
        const saved = { id: crypto.randomUUID(), ...v };
        await database
          .prepare(
            "INSERT INTO saved_views(id,project_id,user_id,data,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(saved.id, pid, uid, JSON.stringify(saved), now())
          .run();
        return json(saved);
      }
      if (method === "DELETE" && path[3]) {
        await database
          .prepare(
            "DELETE FROM saved_views WHERE id=? AND project_id=? AND user_id=?",
          )
          .bind(path[3], pid, uid)
          .run();
        return json({ ok: true });
      }
    }
    if (path[2] === "defects") {
      if (method === "GET") {
        const rows = await database
          .prepare(
            "SELECT data FROM defects WHERE project_id=? ORDER BY updated_at DESC LIMIT 500",
          )
          .bind(pid)
          .all<any>();
        return json(rows.results.map((r) => JSON.parse(r.data)));
      }
      if (method === "POST") {
        await membership(pid, true);
        const v = defectCreateSchema.parse(await body(req));
        const p = JSON.parse((await getProject(pid)).data);
        let snapshot = null;
        if (v.sourceRunId) {
          const row = await database
            .prepare("SELECT data FROM manual_runs WHERE id=? AND project_id=?")
            .bind(v.sourceRunId, pid)
            .first<any>();
          if (!row) fail(400, "Прогон не найден в этом проекте");
          const run = JSON.parse(row.data);
          const result = run.results.find((r: any) => r.caseId === v.caseId);
          if (!result || !["failed", "blocked"].includes(result.outcome))
            fail(400, "Дефект создаётся из сохранённой ошибки или блокировки");
          snapshot = {
            runId: run.id,
            runName: run.name,
            runRevision: run.revision,
            caseId: result.caseId,
            caseKey: result.key,
            caseTitle: result.title,
            gherkin: result.gherkin,
            outcome: result.outcome,
            note: result.note,
            environment: run.environment,
            at: result.at,
            by: result.by,
          };
          const existing = await database
            .prepare(
              "SELECT data FROM defects WHERE project_id=? AND source_run_id=? AND source_case_id=?",
            )
            .bind(pid, v.sourceRunId, v.caseId!)
            .first<any>();
          if (existing) return json(JSON.parse(existing.data));
        } else if (v.caseId && !p.cases.some((c: any) => c.id === v.caseId))
          fail(400, "Тест не найден в проекте");
        const id = crypto.randomUUID();
        const d = {
          id,
          key: "BUG-" + id.slice(0, 6).toUpperCase(),
          ...v,
          status: "open",
          assigneeId: null,
          resolution: "",
          revision: 0,
          createdAt: now(),
          updatedAt: now(),
          author: name,
          source: snapshot,
          history: [
            {
              at: now(),
              author: name,
              status: "open",
              message: "Дефект зарегистрирован",
            },
          ],
        };
        try {
          await database
            .prepare(
              "INSERT INTO defects(id,project_id,data,revision,source_run_id,source_case_id,updated_at) VALUES(?,?,?,?,?,?,?)",
            )
            .bind(
              id,
              pid,
              JSON.stringify(d),
              0,
              v.sourceRunId || null,
              v.sourceRunId ? v.caseId! : null,
              now(),
            )
            .run();
        } catch (e) {
          if (v.sourceRunId) {
            const existing = await database
              .prepare(
                "SELECT data FROM defects WHERE project_id=? AND source_run_id=? AND source_case_id=?",
              )
              .bind(pid, v.sourceRunId, v.caseId!)
              .first<any>();
            if (existing) return json(JSON.parse(existing.data));
          }
          throw e;
        }
        return json(d);
      }
      if (method === "PATCH" && path[3]) {
        await membership(pid, true);
        const v = defectUpdateSchema.parse(await body(req));
        const row = await database
          .prepare("SELECT * FROM defects WHERE id=? AND project_id=?")
          .bind(path[3], pid)
          .first<any>();
        if (!row) fail(404, "Дефект не найден");
        if (row.revision !== v.revision)
          fail(409, "Дефект изменён другим участником. Обновите данные.");
        if (v.assigneeId) {
          const member = await database
            .prepare(
              "SELECT role FROM members WHERE project_id=? AND user_id=? AND role IN ('owner','tester')",
            )
            .bind(pid, v.assigneeId)
            .first();
          if (!member)
            fail(400, "Ответственный должен иметь право редактирования");
        }
        const d = JSON.parse(row.data);
        Object.assign(d, v, { revision: v.revision + 1, updatedAt: now() });
        d.history = [
          ...d.history.slice(-99),
          {
            at: now(),
            author: name,
            status: v.status,
            message: v.resolution || "Обновлены параметры дефекта",
          },
        ];
        const saved = await database
          .prepare(
            "UPDATE defects SET data=?,revision=?,updated_at=? WHERE id=? AND project_id=? AND revision=? AND EXISTS(SELECT 1 FROM members WHERE project_id=? AND user_id=? AND role IN ('owner','tester'))",
          )
          .bind(
            JSON.stringify(d),
            d.revision,
            now(),
            d.id,
            pid,
            v.revision,
            pid,
            uid,
          )
          .run();
        if (!saved.meta.changes)
          fail(409, "Дефект или права доступа изменились");
        return json(d);
      }
    }
    if (path[2] === "team") {
      if (method === "GET") {
        const ms = await database
          .prepare(
            "SELECT p.id,p.name,p.email,m.role FROM members m JOIN profiles p ON p.id=m.user_id WHERE m.project_id=?",
          )
          .bind(pid)
          .all();
        const role = await membership(pid);
        const invites =
          role === "owner"
            ? await database
                .prepare(
                  "SELECT id,email,role,expires_at,accepted_by,revoked FROM invitations WHERE project_id=? ORDER BY expires_at DESC LIMIT 100",
                )
                .bind(pid)
                .all()
            : { results: [] };
        return json({
          members: ms.results,
          invitations: invites.results,
          role,
        });
      }
      if (method === "POST") {
        await membership(pid, false, true);
        const v = z
          .object({
            email: z.string().trim().email().max(254),
            role: z.enum(["tester", "viewer"]),
          })
          .parse(await body(req));
        if (v.email.toLowerCase() === email)
          fail(400, "Вы уже владелец проекта");
        const token = crypto.randomUUID() + crypto.randomUUID();
        const id = crypto.randomUUID();
        await database
          .prepare(
            "INSERT INTO invitations(id,project_id,email,role,token_hash,expires_at,created_by,revoked) VALUES(?,?,?,?,?,?,?,0)",
          )
          .bind(
            id,
            pid,
            v.email.toLowerCase(),
            v.role,
            await hash(token),
            new Date(Date.now() + 7 * 86400000).toISOString(),
            uid,
          )
          .run();
        return json({
          id,
          url: new URL("/?invite=" + encodeURIComponent(token), req.url).href,
        });
      }
    }
    if (path[2] === "invitations" && path[3] && method === "DELETE") {
      await membership(pid, false, true);
      await database
        .prepare("UPDATE invitations SET revoked=1 WHERE id=? AND project_id=?")
        .bind(path[3], pid)
        .run();
      return json({ ok: true });
    }
    if (
      path[2] === "members" &&
      path[3] &&
      ["PATCH", "DELETE"].includes(method)
    ) {
      await membership(pid, false, true);
      if (path[3] === uid) fail(400, "Владельца нельзя удалить или изменить");
      if (method === "DELETE") {
        await database
          .prepare(
            "DELETE FROM members WHERE project_id=? AND user_id=? AND role!=?",
          )
          .bind(pid, path[3], "owner")
          .run();
        await database
          .prepare(
            "UPDATE invitations SET revoked=1 WHERE project_id=? AND (accepted_by=? OR email=(SELECT email FROM profiles WHERE id=?))",
          )
          .bind(pid, path[3], path[3])
          .run();
      } else {
        const { role } = z
          .object({ role: z.enum(["tester", "viewer"]) })
          .parse(await body(req));
        await database
          .prepare(
            "UPDATE members SET role=? WHERE project_id=? AND user_id=? AND role!=?",
          )
          .bind(role, pid, path[3], "owner")
          .run();
      }
      return json({ ok: true });
    }
    if (path[2] === "comments") {
      if (method === "GET") {
        const rows = await database
          .prepare(
            "SELECT c.*,p.name AS author FROM comments c JOIN profiles p ON p.id=c.user_id WHERE c.project_id=? ORDER BY c.created_at ASC LIMIT 1000",
          )
          .bind(pid)
          .all();
        return json(rows.results);
      }
      if (method === "POST") {
        await membership(pid, true);
        const v = z
          .object({
            caseId: z.string().max(100),
            body: z.string().trim().min(1).max(5000),
          })
          .parse(await body(req));
        const p = JSON.parse((await getProject(pid)).data);
        if (!p.cases.some((c: any) => c.id === v.caseId))
          fail(400, "Тест не найден");
        await database
          .prepare(
            "INSERT INTO comments(id,project_id,case_id,user_id,body,created_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(crypto.randomUUID(), pid, v.caseId, uid, v.body, now())
          .run();
        return json({ ok: true });
      }
    }
    if (path[2] === "runs") {
      if (method === "GET") {
        const rows = await database
          .prepare(
            "SELECT data FROM manual_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 100",
          )
          .bind(pid)
          .all<any>();
        return json(rows.results.map((r) => JSON.parse(r.data)));
      }
      if (method === "POST") {
        await membership(pid, true);
        const v = z
          .object({
            name: z.string().trim().min(1).max(160),
            environment: z.string().trim().min(1).max(200),
            caseIds: z.array(z.string()).min(1).max(500),
          })
          .parse(await body(req));
        const p = JSON.parse((await getProject(pid)).data);
        const cases = v.caseIds.map((id) =>
          p.cases.find((c: any) => c.id === id),
        );
        if (
          cases.some((c) => !c) ||
          new Set(v.caseIds).size !== v.caseIds.length
        )
          fail(400, "Проверьте список тестов");
        const run = {
          id: crypto.randomUUID(),
          name: v.name,
          environment: v.environment,
          createdAt: now(),
          author: name,
          revision: 0,
          projectRevision: p.revision,
          results: cases.map((c) => ({
            caseId: c.id,
            key: c.key,
            title: c.title,
            gherkin: c.gherkin,
            outcome: "untested",
            note: "",
            by: null,
            at: null,
          })),
        };
        await database
          .prepare(
            "INSERT INTO manual_runs(id,project_id,user_id,data,revision,created_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(run.id, pid, uid, JSON.stringify(run), 0, now())
          .run();
        return json(run);
      }
      if (path[3] && method === "PATCH") {
        await membership(pid, true);
        const v = runResultSchema.parse(await body(req));
        const row = await database
          .prepare("SELECT * FROM manual_runs WHERE id=? AND project_id=?")
          .bind(path[3], pid)
          .first<any>();
        if (!row) fail(404, "Прогон не найден");
        if (row.revision !== v.revision)
          fail(409, "Прогон изменился. Обновите результаты");
        const run = JSON.parse(row.data);
        const result = run.results.find((r: any) => r.caseId === v.caseId);
        if (!result) fail(400, "Тест не входит в прогон");
        Object.assign(result, {
          outcome: v.outcome,
          note: v.note,
          by: name,
          at: now(),
        });
        run.revision++;
        const saved = await database
          .prepare(
            "UPDATE manual_runs SET data=?,revision=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM members WHERE project_id=? AND user_id=? AND role IN ('owner','tester'))",
          )
          .bind(JSON.stringify(run), run.revision, run.id, v.revision, pid, uid)
          .run();
        if (!saved.meta.changes)
          fail(409, "Результаты или ваши права изменились");
        return json(run);
      }
    }
    fail(404, "Маршрут не найден");
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return json({ detail: e.issues.map((x) => x.message).join("; ") }, 400);
    if (e.status) return json({ detail: e.message }, e.status);
    return json(
      { detail: "Не удалось выполнить запрос. Повторите позже." },
      500,
    );
  }
}
