import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { openDatabase } from "../backend/src/database.mjs";
import fs from "node:fs/promises";
const target = new URL("../.workspace-test.mjs", import.meta.url);
await build({
  entryPoints: ["backend/src/workspace.ts"],
  outfile: target.pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { handleWorkspace } = await import(target.href);
const db = openDatabase(":memory:");
const users = {
  anna: ["u-anna", "anna@example.test"],
  bob: ["u-bob", "bob@example.test"],
  stranger: ["u-stranger", "stranger@example.test"],
};
async function api(user, path, method = "GET", data, origin) {
  const headers = { "Content-Type": "application/json" };
  if (user) {
    headers["oai-authenticated-user-id"] = users[user][0];
    headers["oai-authenticated-user-email"] = users[user][1];
  }
  if (origin) headers.origin = origin;
  const res = await handleWorkspace(
    new Request("https://atlas.test/workspace-api" + path, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    db,
  );
  return { status: res.status, value: await res.json() };
}
const req = {
  id: "r1",
  key: "REQ-001",
  title: "Цена",
  text: "Скидка при сумме >= 100",
  priority: "critical",
  source: "spec.md",
};
const testcase = {
  id: "c1",
  key: "TC-001",
  title: "Граница 100",
  requirementIds: ["r1"],
  type: "boundary",
  priority: "critical",
  status: "approved",
  gherkin: "Given 100\nThen discount",
  code: "",
  framework: "pytest",
  assumptions: [],
  origin: "manual",
  updatedAt: new Date().toISOString(),
};
const initial = {
  id: "p1",
  name: "Проект",
  description: "",
  revision: 0,
  requirements: [req],
  cases: [testcase],
  sources: [],
  audit: [],
};
let p, invitation, token, run;
test("workspace security and team workflow against native SQLite", async (t) => {
  try {
    await t.test("anonymous and cross-origin writes are rejected", async () => {
      assert.equal((await api(null, "/session")).status, 401);
      assert.equal(
        (await api("anna", "/projects/p1", "PUT", initial, "https://evil.test"))
          .status,
        403,
      );
    });
    await t.test(
      "owner creates project; other accounts see no data",
      async () => {
        const r = await api("anna", "/projects/p1", "PUT", initial);
        assert.equal(r.status, 200);
        p = r.value;
        assert.equal(p.role, "owner");
        assert.deepEqual((await api("stranger", "/projects")).value, []);
        assert.equal((await api("stranger", "/projects/p1/team")).status, 404);
        assert.equal(
          (await api("stranger", "/projects/p1", "PUT", p)).status,
          404,
        );
      },
    );
    await t.test(
      "invitation is email-bound and stores only hashed secret",
      async () => {
        const r = await api("anna", "/projects/p1/team", "POST", {
          email: "bob@example.test",
          role: "viewer",
        });
        assert.equal(r.status, 200);
        invitation = r.value;
        token = new URL(r.value.url).searchParams.get("invite");
        assert.equal(
          (await api("stranger", "/invitations/accept", "POST", { token }))
            .status,
          403,
        );
        const row = await db
          .prepare("SELECT token_hash FROM invitations WHERE id=?")
          .bind(invitation.id)
          .first();
        assert.notEqual(row.token_hash, token);
        assert.equal(
          (await api("bob", "/invitations/accept", "POST", { token })).status,
          200,
        );
        assert.equal((await api("bob", "/projects")).value[0].role, "viewer");
      },
    );
    await t.test(
      "viewer cannot alter project, invite, comment or create runs",
      async () => {
        for (const [path, method, data] of [
          ["/projects/p1", "PUT", p],
          [
            "/projects/p1/team",
            "POST",
            { email: "x@example.test", role: "tester" },
          ],
          ["/projects/p1/comments", "POST", { caseId: "c1", body: "x" }],
          [
            "/projects/p1/runs",
            "POST",
            { name: "x", environment: "test", caseIds: ["c1"] },
          ],
        ])
          assert.equal((await api("bob", path, method, data)).status, 403);
      },
    );
    await t.test(
      "owner may promote teammate but cannot demote own ownership",
      async () => {
        assert.equal(
          (
            await api("anna", "/projects/p1/members/u-bob", "PATCH", {
              role: "tester",
            })
          ).status,
          200,
        );
        assert.equal(
          (await api("anna", "/projects/p1/members/u-anna", "DELETE")).status,
          400,
        );
      },
    );
    await t.test(
      "editing requirements invalidates approval and assigns trusted audit actor",
      async () => {
        const next = structuredClone(p);
        next.requirements[0].text = "Скидка при сумме >= 200";
        next.audit = [
          {
            id: "forged",
            at: "1990-01-01",
            action: "Изменено требование",
            target: "REQ-001",
            actor: "Someone else",
          },
        ];
        const r = await api("bob", "/projects/p1", "PUT", next);
        assert.equal(r.status, 200);
        assert.equal(r.value.cases[0].status, "draft");
        assert.equal(r.value.audit.at(-1).actor, "bob@example.test");
        assert.equal(r.value.audit.length, 2);
        p = r.value;
      },
    );
    await t.test("stale updates and invalid links are rejected", async () => {
      assert.equal(
        (await api("anna", "/projects/p1", "PUT", initial)).status,
        409,
      );
      const bad = structuredClone(p);
      bad.cases[0].requirementIds = ["missing"];
      assert.equal((await api("anna", "/projects/p1", "PUT", bad)).status, 400);
      bad.cases[0].requirementIds = ["r1"];
      bad.cases[0].status = "approved";
      bad.cases[0].assumptions = ["Вопрос"];
      assert.equal((await api("anna", "/projects/p1", "PUT", bad)).status, 400);
    });
    await t.test("assignment must refer to a project member", async () => {
      const bad = structuredClone(p);
      bad.cases[0].assigneeId = "u-stranger";
      assert.equal((await api("anna", "/projects/p1", "PUT", bad)).status, 400);
      bad.cases[0].assigneeId = "u-bob";
      const r = await api("anna", "/projects/p1", "PUT", bad);
      assert.equal(r.status, 200);
      p = r.value;
    });
    await t.test(
      "comments stay within project and require a real case",
      async () => {
        assert.equal(
          (
            await api("bob", "/projects/p1/comments", "POST", {
              caseId: "missing",
              body: "x",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api("bob", "/projects/p1/comments", "POST", {
              caseId: "c1",
              body: "Проверить границу",
            })
          ).status,
          200,
        );
        const r = await api("anna", "/projects/p1/comments");
        assert.equal(r.value[0].author, "bob@example.test");
        assert.equal(
          (await api("stranger", "/projects/p1/comments")).status,
          404,
        );
      },
    );
    await t.test(
      "manual run keeps immutable test snapshot and guarded result revision",
      async () => {
        const created = await api("bob", "/projects/p1/runs", "POST", {
          name: "Regression",
          environment: "Staging",
          caseIds: ["c1"],
        });
        assert.equal(created.status, 200);
        run = created.value;
        assert.equal(run.results[0].outcome, "untested");
        const next = structuredClone(p);
        next.cases[0].gherkin = "Changed later";
        p = (await api("anna", "/projects/p1", "PUT", next)).value;
        let r = await api("bob", `/projects/p1/runs/${run.id}`, "PATCH", {
          revision: 0,
          caseId: "c1",
          outcome: "failed",
          note: "Defect QA-1",
        });
        assert.equal(r.status, 200);
        assert.equal(r.value.results[0].gherkin, testcase.gherkin);
        assert.equal(r.value.results[0].by, "bob@example.test");
        assert.equal(
          (
            await api("anna", `/projects/p1/runs/${run.id}`, "PATCH", {
              revision: 0,
              caseId: "c1",
              outcome: "passed",
              note: "",
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "saved views are private to their account and project",
      async () => {
        const saved = await api("anna", "/projects/p1/views", "POST", {
          name: "Критичные",
          filters: { priority: "critical" },
        });
        assert.equal(saved.status, 200);
        assert.equal((await api("anna", "/projects/p1/views")).value.length, 1);
        assert.equal((await api("bob", "/projects/p1/views")).value.length, 0);
        await api("bob", `/projects/p1/views/${saved.value.id}`, "DELETE");
        assert.equal((await api("anna", "/projects/p1/views")).value.length, 1);
        assert.equal((await api("stranger", "/projects/p1/views")).status, 404);
      },
    );
    await t.test(
      "defects preserve trusted run evidence, deduplicate and protect updates",
      async () => {
        const input = {
          title: "Ошибка расчёта",
          severity: "critical",
          actual: "Не применена скидка",
          sourceRunId: run.id,
          caseId: "c1",
        };
        assert.equal(
          (await api("stranger", "/projects/p1/defects")).status,
          404,
        );
        assert.equal(
          (
            await api("bob", "/projects/p1/defects", "POST", {
              ...input,
              sourceRunId: "missing",
            })
          ).status,
          400,
        );
        const created = await api("bob", "/projects/p1/defects", "POST", {
          ...input,
          source: { gherkin: "forged" },
        });
        assert.equal(created.status, 200);
        const d = created.value;
        assert.equal(d.source.gherkin, testcase.gherkin);
        assert.equal(d.source.note, "Defect QA-1");
        assert.equal(d.source.runRevision, 1);
        assert.equal(d.author, "bob@example.test");
        assert.equal(
          (await api("anna", "/projects/p1/defects", "POST", input)).value.id,
          d.id,
        );
        assert.equal(
          (await api("anna", "/projects/p1/defects")).value.length,
          1,
        );
        const update = {
          revision: 0,
          status: "closed",
          severity: "high",
          assigneeId: "u-bob",
          resolution: "",
        };
        assert.equal(
          (await api("anna", `/projects/p1/defects/${d.id}`, "PATCH", update))
            .status,
          400,
        );
        update.resolution = "Перепроверено на Staging";
        assert.equal(
          (
            await api("anna", `/projects/p1/defects/${d.id}`, "PATCH", {
              ...update,
              assigneeId: "u-stranger",
            })
          ).status,
          400,
        );
        const closed = await api(
          "anna",
          `/projects/p1/defects/${d.id}`,
          "PATCH",
          update,
        );
        assert.equal(closed.status, 200);
        assert.equal(closed.value.history.length, 2);
        assert.equal(closed.value.revision, 1);
        assert.deepEqual(closed.value.source, d.source);
        assert.equal(
          (await api("bob", `/projects/p1/defects/${d.id}`, "PATCH", update))
            .status,
          409,
        );
        await api("anna", "/projects/p1/members/u-bob", "PATCH", {
          role: "viewer",
        });
        assert.equal((await api("bob", "/projects/p1/defects")).status, 200);
        assert.equal(
          (await api("bob", "/projects/p1/defects", "POST", input)).status,
          403,
        );
        assert.equal(
          (
            await api("bob", `/projects/p1/defects/${d.id}`, "PATCH", {
              ...update,
              revision: 1,
            })
          ).status,
          403,
        );
        await api("anna", "/projects/p1/members/u-bob", "PATCH", {
          role: "tester",
        });
      },
    );
    await t.test("revoked and expired invitations cannot be used", async () => {
      const r = await api("anna", "/projects/p1/team", "POST", {
        email: "stranger@example.test",
        role: "tester",
      });
      const tok = new URL(r.value.url).searchParams.get("invite");
      await api("anna", `/projects/p1/invitations/${r.value.id}`, "DELETE");
      assert.equal(
        (await api("stranger", "/invitations/accept", "POST", { token: tok }))
          .status,
        403,
      );
      const exp = await api("anna", "/projects/p1/team", "POST", {
        email: "stranger@example.test",
        role: "tester",
      });
      await db
        .prepare("UPDATE invitations SET expires_at=? WHERE id=?")
        .bind("2000-01-01", exp.value.id)
        .run();
      assert.equal(
        (
          await api("stranger", "/invitations/accept", "POST", {
            token: new URL(exp.value.url).searchParams.get("invite"),
          })
        ).status,
        403,
      );
    });
    await t.test(
      "removed teammate cannot read, write or reuse accepted invitation",
      async () => {
        assert.equal(
          (await api("anna", "/projects/p1/members/u-bob", "DELETE")).status,
          200,
        );
        assert.equal((await api("bob", "/projects/p1/team")).status, 404);
        assert.equal((await api("bob", "/projects/p1", "PUT", p)).status, 404);
        const cleaned = await api("anna", "/projects/p1", "PUT", p);
        assert.equal(cleaned.status, 200);
        assert.equal(cleaned.value.cases[0].assigneeId, undefined);
        assert.equal(
          (await api("bob", "/invitations/accept", "POST", { token })).status,
          403,
        );
      },
    );
    await t.test("owner deletes project and associated data, another project survives", async () => {
      const remaining = { ...initial, id: "p-keep", name: "Оставить проект", revision: 0 };
      assert.equal((await api("anna", "/projects/p-keep", "PUT", remaining)).status, 200);
      db.raw.prepare("INSERT INTO members(project_id,user_id,role) VALUES(?,?,?)").run("p1", "u-bob", "tester");
      assert.equal((await api("bob", "/projects/p1", "DELETE")).status, 403);
      assert.equal((await api("stranger", "/projects/p1", "DELETE")).status, 404);
      assert.equal((await api("anna", "/projects/p1", "DELETE", undefined, "https://evil.test")).status, 403);
      // Project removal also uses the ordinary project update path to delete all cases.
      const current = (await api("anna", "/projects")).value.find((x) => x.id === "p1");
      const cleared = { ...current, cases: [] };
      assert.equal((await api("anna", "/projects/p1", "PUT", cleared)).status, 200);
      assert.equal((await api("anna", "/projects")).value.find((x) => x.id === "p1").cases.length, 0);
      assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM comments WHERE project_id=?").get("p1").n, 0);
      db.raw.prepare("INSERT INTO jobs(id,project_id,author_id,kind,status,progress,payload,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run("job-to-cancel", "p1", "u-anna", "autorun", "running", "running", "{}", new Date().toISOString());
      assert.equal((await api("anna", "/projects/p1", "DELETE")).status, 409);
      db.raw.prepare("UPDATE jobs SET status='cancelled' WHERE id='job-to-cancel'").run();
      assert.equal((await api("anna", "/projects/p1", "DELETE")).status, 200);
      assert.deepEqual((await api("anna", "/projects")).value.map((x) => x.id), ["p-keep"]);
      assert.equal((await api("bob", "/projects/p1/team")).status, 404);
      assert.equal((await api("anna", "/projects/p1", "DELETE")).status, 404);
      for (const table of ["projects", "comments", "invitations", "members", "manual_runs", "defects", "saved_views", "jobs"]) {
        const row = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "projects" ? "id" : "project_id"}=?`).get("p1");
        assert.equal(row.n, 0, `stale rows in ${table}`);
      }
      assert.equal((await api("anna", "/projects")).value[0].cases.length, 1);
    });
  } finally {
    db.close();
    await fs.unlink(target);
  }
});
