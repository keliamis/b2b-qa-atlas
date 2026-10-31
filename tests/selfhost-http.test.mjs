import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
import { openDatabase } from "../backend/src/database.mjs";
import { createAccount } from "../backend/src/auth.mjs";
import { createServer } from "../backend/src/index.mjs";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
test("self-hosted HTTP, sessions, job pipeline and persistence", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-"));
  let hold = false,
    release = null,
    received = false;
  const ml = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-ml-token");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const input = JSON.parse(Buffer.concat(chunks));
    received = true;
    if (hold) await new Promise((r) => (release = r));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/parse"
          ? { requirements: [{ title: "Требование", text: "Требование из файла", extraction: "review" }] }
          : {
              cases: [
                {
                  title: "Проверка входа",
                  requirementIds: [input.requirements[0].id],
                  type: "positive",
                  priority: "high",
                  gherkin: "Given user\nWhen login\nThen dashboard",
                  code: "",
                  assumptions: [],
                },
              ],
              questions: [],
              model: "test-model",
              usage: {},
            },
      ),
    );
  });
  ml.listen(0, "127.0.0.1");
  await once(ml, "listening");
  const db = openDatabase(join(dir, "db.sqlite")),
    anna = await createAccount(
      db,
      "anna@example.test",
      "Анна",
      "strong-test-password",
    ),
    bob = await createAccount(
      db,
      "bob@example.test",
      "Боб",
      "other-test-password",
    );
  const app = createServer({
    db,
    origin: "http://localhost:8080",
    mlUrl: `http://127.0.0.1:${ml.address().port}`,
    mlToken: "test-ml-token",
    model: "test-model",
    apiKeyConfigured: true,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let aCookie, bCookie, project;
  async function api(path, method = "GET", data, cookie, extra = {}) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: "http://localhost:8080",
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const v = (r.headers.get("content-type") || "").includes("json")
      ? await r.json()
      : await r.text();
    return { status: r.status, value: v, headers: r.headers };
  }
  async function untilDone(id) {
    for (let i = 0; i < 100; i++) {
      const r = await api("/api/projects/p1/jobs", "GET", null, aCookie);
      const j = r.value.find((j) => j.id === id);
      if (["succeeded", "failed", "cancelled"].includes(j.status)) return j;
      await pause(20);
    }
    throw new Error("job timeout");
  }
  try {
    await t.test(
      "unauthenticated and forged identity cannot access workspace",
      async () => {
        assert.equal((await api("/workspace-api/projects")).status, 401);
        const page = await fetch(base + "/login");
        assert.equal(page.status, 200);
        assert.match(await page.text(), /<div id="root"><\/div>/);
        assert.equal((await fetch(base + "/missing.js")).status, 404);
        assert.equal(
          (
            await api("/workspace-api/projects", "GET", null, null, {
              "oai-authenticated-user-id": anna.id,
              "oai-authenticated-user-email": anna.email,
            })
          ).status,
          401,
        );
      },
    );
    await t.test("public registration creates persistent account and valid session", async () => {
      const form = { email: "new.user@example.test", name: "Новый тестировщик", password: "long-unique-password", confirmPassword: "long-unique-password" };
      assert.equal((await api("/auth/register", "POST", {...form,confirmPassword:"different"})).status,400);
      assert.equal((await api("/auth/register", "POST", form, null, {Origin:"https://evil.test"})).status,403);
      const registered = await api("/auth/register", "POST", form);
      assert.equal(registered.status,201);
      assert.equal(registered.value.email, form.email);
      assert.equal(registered.value.password_hash,undefined);
      assert.match(registered.headers.get("set-cookie"), /HttpOnly/);
      const registeredCookie = registered.headers.get("set-cookie").split(";")[0];
      assert.equal((await api("/workspace-api/session", "GET", null,registeredCookie)).value.name,form.name);
      assert.deepEqual((await api("/api/projects", "GET", null,registeredCookie)).value,[]);
      assert.equal((await api("/auth/register", "POST", form)).status,409);
      assert.equal((await api("/auth/login", "POST", {email:form.email,password:form.password})).status,200);
      const row=db.raw.prepare("SELECT password_hash FROM accounts WHERE email=?").get(form.email);
      assert.ok(row && !row.password_hash.includes(form.password));
    });
    await t.test(
      "login sets HttpOnly session; secrets are hashed; CSRF rejected",
      async () => {
        assert.equal(
          (
            await api("/auth/login", "POST", {
              email: anna.email,
              password: "wrong",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await api(
              "/auth/login",
              "POST",
              { email: anna.email, password: "strong-test-password" },
              null,
              { Origin: "https://evil.test" },
            )
          ).status,
          403,
        );
        let r = await api("/auth/login", "POST", {
          email: anna.email,
          password: "strong-test-password",
        });
        assert.equal(r.status, 200);
        assert.match(r.headers.get("set-cookie"), /HttpOnly/);
        assert.match(r.headers.get("set-cookie"), /SameSite=Lax/);
        aCookie = r.headers.get("set-cookie").split(";")[0];
        r = await api("/auth/login", "POST", {
          email: bob.email,
          password: "other-test-password",
        });
        bCookie = r.headers.get("set-cookie").split(";")[0];
        assert.notEqual(
          db.raw
            .prepare("SELECT password_hash FROM accounts WHERE id=?")
            .get(anna.id).password_hash,
          "strong-test-password",
        );
        assert.notEqual(
          db.raw
            .prepare("SELECT token_hash FROM sessions WHERE user_id=?")
            .get(anna.id).token_hash,
          aCookie.split("=")[1],
        );
        assert.equal(
          (await api("/workspace-api/session", "GET", null, aCookie)).value
            .auth,
          "password",
        );
      },
    );
    await t.test(
      "project persistence and ownership are preserved through the HTTP adapter",
      async () => {
        const input = {
          id: "p1",
          revision: 0,
          name: "Серверный проект",
          description: "",
          requirements: [
            {
              id: "r1",
              key: "REQ-001",
              title: "Вход",
              text: "После входа видна панель",
              priority: "high",
              source: "",
            },
          ],
          cases: [],
          sources: [],
          audit: [],
        };
        const r = await api("/api/projects/p1", "PUT", input, aCookie);
        assert.equal(r.status, 200);
        project = r.value;
        assert.deepEqual(
          (await api("/api/projects", "GET", null, bCookie)).value,
          [],
        );
        assert.equal(
          (await api("/api/projects/p1", "PUT", project, bCookie)).status,
          404,
        );
      },
    );
    await t.test(
      "generation saves drafts into the same project and permits export",
      async () => {
        const r = await api(
          "/api/projects/p1/generate",
          "POST",
          {
            requirement_ids: ["r1"],
            framework: "pytest",
            count: 1,
            include_code: false,
          },
          aCookie,
        );
        assert.equal(r.status, 202);
        assert.equal((await untilDone(r.value.id)).status, "succeeded");
        project = (await api("/api/projects", "GET", null, aCookie)).value[0];
        assert.equal(project.cases.length, 1);
        assert.equal(project.cases[0].status, "draft");
        assert.equal(project.cases[0].origin, "ai");
        const exported = await fetch(base + "/api/projects/p1/export", {
          headers: { Cookie: aCookie },
        });
        assert.equal(exported.status, 200);
        const zip = await JSZip.loadAsync(await exported.arrayBuffer());
        assert.equal(
          JSON.parse(await zip.file("project.json").async("string")).cases
            .length,
          1,
        );
      },
    );
    await t.test(
      "changes during processing reject stale generation instead of overwriting work",
      async () => {
        hold = true;
        received = false;
        const r = await api(
          "/api/projects/p1/generate",
          "POST",
          {
            requirement_ids: ["r1"],
            framework: "pytest",
            count: 1,
            include_code: false,
          },
          aCookie,
        );
        for (let i = 0; i < 100 && !received; i++) await pause(10);
        assert.ok(received);
        project.name = "Изменено командой";
        assert.equal(
          (await api("/api/projects/p1", "PUT", project, aCookie)).status,
          200,
        );
        hold = false;
        release();
        assert.equal((await untilDone(r.value.id)).status, "failed");
        project = (await api("/api/projects", "GET", null, aCookie)).value[0];
        assert.equal(project.name, "Изменено командой");
        assert.equal(project.cases.length, 1);
      },
    );
    await t.test(
      "document upload uses private processor and commits real extracted text",
      async () => {
        const form = new FormData();
        form.set(
          "file",
          new Blob(["Исходный текст"], { type: "text/plain" }),
          "requirements.txt",
        );
        const r = await fetch(base + "/api/projects/p1/documents", {
          method: "POST",
          headers: { Cookie: aCookie, Origin: "http://localhost:8080" },
          body: form,
        });
        assert.equal(r.status, 202);
        const job = await r.json();
        assert.equal((await untilDone(job.id)).status, "succeeded");
        project = (await api("/api/projects", "GET", null, aCookie)).value[0];
        assert.equal(project.requirements.at(-1).text, "Требование из файла");
      },
    );
    await t.test("archive preserves data, rejects writes and can be restored", async () => {
      const before=(await api("/api/projects", "GET", null, aCookie)).value[0];
      assert.equal((await api("/api/projects/p1/archive", "POST", {archived:true,revision:before.revision}, bCookie)).status,404);
      const archived=await api("/api/projects/p1/archive", "POST", {archived:true,revision:before.revision}, aCookie);
      assert.equal(archived.status,200);assert.equal(archived.value.archived,true);
      assert.deepEqual(archived.value.cases,before.cases);
      assert.equal((await api("/api/projects/p1", "PUT", {...archived.value,name:"Forbidden"}, aCookie)).status,409);
      assert.equal((await api("/api/projects/p1/generate", "POST", {requirement_ids:[before.requirements[0].id],framework:"pytest",count:1,include_code:false}, aCookie)).status,409);
      assert.equal((await api("/api/projects/p1/archive", "POST", {archived:false,revision:before.revision}, aCookie)).status,409);
      const restored=await api("/api/projects/p1/archive", "POST", {archived:false,revision:archived.value.revision}, aCookie);
      assert.equal(restored.status,200);assert.equal(restored.value.archived,false);
      project=restored.value;
    });
    await t.test(
      "SQLite backup can be reopened with projects, accounts and migrations intact",
      async () => {
        const file = join(dir, "backup.sqlite");
        await backup(db.raw, file);
        const copy = openDatabase(file);
        assert.equal(
          copy.raw.prepare("SELECT count(*) n FROM accounts").get().n,
          db.raw.prepare("SELECT count(*) n FROM accounts").get().n,
        );
        assert.equal(
          JSON.parse(
            copy.raw.prepare("SELECT data FROM projects WHERE id=?").get("p1")
              .data,
          ).name,
          "Изменено командой",
        );
        copy.close();
      },
    );
    await t.test(
      "logout revokes session; login attempt limits apply",
      async () => {
        assert.equal(
          (await api("/auth/logout", "POST", {}, aCookie)).status,
          200,
        );
        assert.equal(
          (await api("/api/projects", "GET", null, aCookie)).status,
          401,
        );
        for (let i = 0; i < 12; i++)
          await api("/auth/login", "POST", {
            email: "unknown@example.test",
            password: "bad-password",
          });
        assert.equal(
          (
            await api("/auth/login", "POST", {
              email: "unknown@example.test",
              password: "bad-password",
            })
          ).status,
          429,
        );
      },
    );
  } finally {
    if (release) release();
    await app.close();
    await new Promise((r) => ml.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
