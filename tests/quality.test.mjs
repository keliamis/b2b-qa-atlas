import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundled = await build({
  entryPoints: ["frontend/src/quality.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { filterCases, getAttention, defaultFilters } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const cases = [
  {
    id: "a",
    key: "TC-001",
    title: "Вход",
    gherkin: "Given account",
    priority: "high",
    type: "positive",
    status: "review",
    assumptions: [],
    requirementIds: ["r"],
    assigneeId: "anna",
    dueDate: "2026-10-16",
    suite: "Smoke",
    labels: ["auth"],
  },
  {
    id: "b",
    key: "TC-002",
    title: "Срок",
    gherkin: "",
    priority: "critical",
    type: "boundary",
    status: "draft",
    assumptions: ["Уточнить"],
    requirementIds: [],
    dueDate: "2026-10-15",
  },
];
test("filters combine suite, label search, ownership and favorites without mutating cases", () => {
  assert.deepEqual(
    filterCases(
      cases,
      {
        ...defaultFilters,
        query: " AUTH ",
        suite: "Smoke",
        assignment: "mine",
      },
      "anna",
    ).map((c) => c.id),
    ["a"],
  );
  assert.equal(
    filterCases(cases, { ...defaultFilters, assignment: "mine" }).length,
    0,
  );
  assert.deepEqual(
    filterCases(cases, { ...defaultFilters, favorites: true }, "anna", [
      "b",
    ]).map((c) => c.id),
    ["b"],
  );
  assert.deepEqual(
    filterCases(cases, defaultFilters).map((c) => c.id),
    ["b", "a"],
  );
  assert.equal(cases[0].id, "a");
});
test("attention uses local due date, pending review and requirement links", () => {
  const a = getAttention(
    { cases, requirements: [{ id: "r" }, { id: "gap" }] },
    "anna",
    "2026-10-16",
  );
  assert.deepEqual(
    a.overdue.map((c) => c.id),
    ["b"],
  );
  assert.deepEqual(
    a.mine.map((c) => c.id),
    ["a"],
  );
  assert.deepEqual(
    a.uncovered.map((c) => c.id),
    ["gap"],
  );
});
