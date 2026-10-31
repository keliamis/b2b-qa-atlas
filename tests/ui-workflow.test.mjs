import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import React, { act } from "react";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "https://qa.test" },
);
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "localStorage",
  "FormData",
  "Event",
  "MouseEvent",
])
  globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const target = new URL("../.ui-test-app.mjs", import.meta.url);
await build({
  entryPoints: ["frontend/src/App.tsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  packages: "external",
  outfile: target.pathname,
});
const { default: App } = await import(pathToFileURL(target.pathname).href);
const seedBuild = await build({
  entryPoints: ["frontend/src/seed.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { exampleProject } = await import(
  "data:text/javascript;base64," +
    Buffer.from(seedBuild.outputFiles[0].text).toString("base64")
);
exampleProject.cases[0].assigneeId = "local-tester";
exampleProject.cases[0].dueDate = "2026-11-20";
localStorage.setItem("qa-atlas-projects-v1", JSON.stringify([exampleProject]));
const root = createRoot(document.getElementById("root"));
const button = (text) =>
  [...document.querySelectorAll("button")].find(
    (x) => x.textContent.trim() === text,
  );
const click = async (el) => {
  assert.ok(el, "Expected UI element");
  await act(async () =>
    el.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
};
const fill = (name, value) => {
  const el = document.querySelector(`[name="${name}"]`);
  assert.ok(el);
  el.value = value;
};
const submit = async () => {
  await act(async () =>
    document
      .querySelector('[role="dialog"] form')
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
};
test("tester can create a requirement, edit an approved case, and cannot fake AI or runs", async () => {
  await act(async () => root.render(React.createElement(App)));
  assert.match(document.body.textContent, /Локальный режим/);
  await click(
    [...document.querySelectorAll("nav button")].find((b) =>
      b.textContent.includes("Требования"),
    ),
  );
  await click(button("Требование"));
  fill("title", "Проверка входа");
  fill("text", "После входа открывается главная страница");
  await submit();
  assert.match(document.body.textContent, /Проверка входа/);
  const local = JSON.parse(localStorage.getItem("qa-atlas-projects-v1"));
  assert.equal(local[0].requirements.length, 9);
  await click(
    [...document.querySelectorAll("nav button")].find((b) =>
      b.textContent.includes("Тест-кейсы"),
    ),
  );
  await click(
    [...document.querySelectorAll(".case-link")].find((b) =>
      b.textContent.includes(local[0].cases[0].title),
    ),
  );
  await click(button("Редактировать"));
  fill("title", "Изменённая проверка");
  await submit();
  assert.equal(
    JSON.parse(localStorage.getItem("qa-atlas-projects-v1"))[0].cases[0].status,
    "draft",
  );
  const edited = JSON.parse(localStorage.getItem("qa-atlas-projects-v1"))[0]
    .cases[0];
  assert.equal(edited.assigneeId, "local-tester");
  assert.equal(edited.dueDate, "2026-11-20");
  await click(document.querySelector('[aria-label="Закрыть тест"]'));
  await click(button("Генерировать тесты"));
  assert.match(
    document.querySelector('[role="dialog"]').textContent,
    /Сначала подключите генератор/,
  );
  assert.ok(button("Начать генерацию").disabled);
  await click(document.querySelector('[aria-label="Закрыть"]'));
  await click(
    [...document.querySelectorAll("nav button")].find(
      (b) => b.textContent === "Ручные прогоны",
    ),
  );
  assert.match(document.body.textContent, /Тесты ещё не запускались/);
  await click(document.querySelector('[aria-label="Переключить тему"]'));
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(localStorage.getItem("qa-atlas-theme"), "light");
  await click(
    [...document.querySelectorAll("nav button")].find(
      (b) => b.textContent === "Аналитика",
    ),
  );
  assert.equal(document.querySelectorAll(".chart-card").length, 4);
  assert.match(
    document.querySelector(".donut svg").getAttribute("aria-label"),
    /Черновик/,
  );
  await click(
    [...document.querySelectorAll("nav button")].find(
      (b) => b.textContent === "Доска ревью",
    ),
  );
  assert.equal(document.querySelectorAll(".kanban-column").length, 3);
  await click(document.querySelector('[aria-label^="В избранное TC-"]'));
  await click(button("Только избранные"));
  assert.equal(document.querySelectorAll(".kanban-card").length, 1);
  assert.equal(
    JSON.parse(localStorage.getItem("qa-atlas-favorites")).length,
    1,
  );
  await act(async () =>
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
      }),
    ),
  );
  assert.match(
    document.querySelector('[role="dialog"]').textContent,
    /Быстрый/,
  );
  await act(async () =>
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await act(async () => root.unmount());
  await fs.unlink(target);
});
test("hosted account loads cloud projects, creates an invitation and records a manual result", async () => {
  globalThis.location = dom.window.location;
  globalThis.history = dom.window.history;
  const savedFetch = globalThis.fetch;
  const data = JSON.parse(localStorage.getItem("qa-atlas-projects-v1"))[0];
  data.id = "cloud-project";
  data.name = "Облачная команда";
  data.role = "owner";
  const pending = [];
  let runs = [];
  let defects = [];
  let savedOutcome = "";
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    const method = init.method || "GET";
    let value;
    if (path.endsWith("/session"))
      value = {
        id: "anna",
        email: "anna@example.test",
        name: "Анна",
        auth: "chatgpt",
      };
    else if (path.endsWith("/config")) value={model:null,ai_ready:false};
    else if (path.endsWith("/jobs")) value=[];
    else if (path.endsWith("/projects")) value = [data];
    else if (path.endsWith("/team") && method === "POST") {
      pending.push({
        id: "inv",
        email: "bob@example.test",
        role: "tester",
        expires_at: "2099-01-01",
        revoked: 0,
        accepted_by: null,
      });
      value = { url: "https://qa.test/?invite=example-secret" };
    } else if (path.endsWith("/team"))
      value = {
        role: "owner",
        members: [
          {
            id: "anna",
            email: "anna@example.test",
            name: "Анна",
            role: "owner",
          },
        ],
        invitations: pending,
      };
    else if (path.endsWith("/runs") && method === "POST") {
      const body = JSON.parse(init.body);
      runs = [
        {
          id: "run1",
          name: body.name,
          environment: body.environment,
          createdAt: new Date().toISOString(),
          author: "Анна",
          revision: 0,
          projectRevision: 1,
          results: data.cases.map((c) => ({
            caseId: c.id,
            key: c.key,
            title: c.title,
            gherkin: c.gherkin,
            outcome: "untested",
            note: "",
            by: null,
            at: null,
          })),
        },
      ];
      value = runs[0];
    } else if (path.endsWith("/runs")) value = runs;
    else if (path.endsWith("/runs/run1") && method === "PATCH") {
      const body = JSON.parse(init.body);
      savedOutcome = body.outcome;
      const r = runs[0].results.find((c) => c.caseId === body.caseId);
      Object.assign(r, {
        outcome: body.outcome,
        note: body.note,
        by: "Анна",
        at: new Date().toISOString(),
      });
      runs[0].revision++;
      value = runs[0];
    } else if (path.endsWith("/defects") && method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.sourceRunId, "run1");
      assert.equal(body.steps, runs[0].results[0].gherkin);
      defects = [
        {
          ...body,
          id: "defect1",
          key: "BUG-123ABC",
          status: "open",
          assigneeId: null,
          resolution: "",
          revision: 0,
          author: "Анна",
          source: {
            runName: "Регрессия",
            caseKey: runs[0].results[0].key,
            environment: "Staging",
            runRevision: 1,
            outcome: "failed",
          },
          history: [],
        },
      ];
      value = defects[0];
    } else if (path.endsWith("/defects")) value = defects;
    else throw new Error(`Unexpected request ${method} ${path}`);
    return new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const cloudRoot = createRoot(document.getElementById("root"));
  try {
    await act(async () =>
      cloudRoot.render(React.createElement(App, { hostedRuntime: true })),
    );
    assert.match(document.body.textContent, /Облачная команда/);
    assert.equal(
      document.querySelector(".connection-pill").textContent.trim(),
      "Сервер",
    );
    assert.equal(
      JSON.parse(localStorage.getItem("qa-atlas-projects-v1"))[0].name.includes(
        "Облачная",
      ),
      false,
    );
    await click(
      [...document.querySelectorAll("nav button")].find(
        (b) => b.textContent === "Команда",
      ),
    );
    assert.match(document.body.textContent, /anna@example.test/);
    document.querySelector('[name="email"]').value = "bob@example.test";
    await act(async () =>
      document
        .querySelector(".invite-card form")
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    assert.match(
      document.querySelector(".invite-result").textContent,
      /Письмо не отправлялось/,
    );
    assert.equal(
      document.querySelector('[aria-label="Ссылка приглашения"]').value,
      "https://qa.test/?invite=example-secret",
    );
    await click(
      [...document.querySelectorAll("nav button")].find(
        (b) => b.textContent === "Ручные прогоны",
      ),
    );
    await click(button("Новый прогон"));
    document.querySelector('.run-create [name="name"]').value = "Регрессия";
    document.querySelector('.run-create [name="environment"]').value =
      "Staging";
    await act(async () =>
      document
        .querySelector(".run-create")
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    assert.match(
      document.querySelector(".run-content").textContent,
      /Регрессия/,
    );
    const select = document.querySelector(
      '[aria-label="Результат ручной проверки"]',
    );
    await act(async () => {
      select.value = "failed";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(button("Сохранить результат"));
    assert.equal(savedOutcome, "failed");
    assert.match(
      document.querySelector(".run-distribution").textContent,
      /Ошибка: 1/,
    );
    await click(button("Создать дефект по сохранённому результату"));
    assert.match(
      document.querySelector('[role="dialog"]').textContent,
      /Новый дефект/,
    );
    fill("actual", "Фактический результат отличается от ожидаемого");
    await submit();
    assert.equal(defects.length, 1);
    assert.match(
      document.querySelector('[role="dialog"]').textContent,
      /BUG-123ABC/,
    );
  } finally {
    await act(async () => cloudRoot.unmount());
    globalThis.fetch = savedFetch;
  }
});

test("anonymous hosted visitor can sign in or open an explicitly local demo", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Войдите в аккаунт" }), {
      status: 401,
    });
  const r = createRoot(document.getElementById("root"));
  try {
    await act(async () =>
      r.render(
        React.createElement(App, {
          hostedRuntime: true,
          signInUrl: "/auth?return=invite",
        }),
      ),
    );
    assert.ok(document.querySelector(".welcome-gate"));
    assert.ok(document.querySelector('a[href="/auth?return=invite"]'));
    await click(
      [...document.querySelectorAll("button")].find((b) =>
        /демо/i.test(b.textContent),
      ),
    );
    assert.match(document.body.textContent, /Локальный режим/);
    assert.equal(document.querySelector(".welcome-gate"), null);
  } finally {
    await act(async () => r.unmount());
    globalThis.fetch = savedFetch;
  }
});
