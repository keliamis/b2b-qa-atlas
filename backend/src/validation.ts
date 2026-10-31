import { z } from "zod";
const id = z.string().min(1).max(100);
const priority = z.enum(["critical", "high", "medium", "low"]);
const req = z.object({
  id,
  key: z.string().max(100),
  title: z.string().min(1).max(500),
  text: z.string().max(120000),
  priority,
  source: z.string().max(500),
  page: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
  conditions: z.array(z.object({
    number: z.number().int().positive(),
    text: z.string().min(1).max(120000),
  })).max(200).optional(),
  originalId: z.string().max(100).optional(),
  extraction: z.enum(["explicit", "numbered", "heuristic", "review"]).optional(),
});
const testcase = z.object({
  id,
  key: z.string().max(100),
  title: z.string().min(1).max(500),
  requirementIds: z.array(id).max(1000),
  type: z.enum(["positive", "negative", "boundary"]),
  priority,
  status: z.enum(["draft", "review", "approved"]),
  gherkin: z.string().max(50000),
  code: z.string().max(100000),
  artifacts: z.object({pytest:z.string().max(100000),playwright:z.string().max(100000)}).optional(),
  framework: z.enum(["pytest", "playwright", "junit"]),
  assumptions: z.array(z.string().max(2000)).max(100),
  origin: z.enum(["manual", "example", "ai"]),
  duplicateOf: id.optional(),
  updatedAt: z.string().max(100),
  assigneeId: id.optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  suite: z.string().max(100).optional(),
  labels: z.array(z.string().max(30)).max(10).optional(),
});
export const projectSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(5000),
    archived: z.boolean().optional(),
    revision: z.number().int().min(0),
    requirements: z.array(req).max(2000),
    cases: z.array(testcase).max(5000),
    sources: z
      .array(
        z.object({
          id,
          name: z.string().max(300),
          text: z.string().max(120000),
        }),
      )
      .max(100),
    audit: z
      .array(
        z.object({
          id,
          at: z.string().max(100),
          action: z.string().max(300),
          target: z.string().max(1000),
          actor: z.string().max(300).optional(),
        }),
      )
      .max(1000),
  })
  .superRefine((p, ctx) => {
    const ids = new Set(p.requirements.map((r) => r.id));
    if (
      ids.size !== p.requirements.length ||
      new Set(p.cases.map((c) => c.id)).size !== p.cases.length
    )
      ctx.addIssue({ code: "custom", message: "Повторяющиеся ID" });
    for (const t of p.cases) {
      if(t.duplicateOf && !p.cases.some(c=>c.id===t.duplicateOf))delete t.duplicateOf;
      if (t.duplicateOf && (t.duplicateOf === t.id || !p.cases.some(c=>c.id===t.duplicateOf && !c.duplicateOf)))
        ctx.addIssue({code:'custom',message:'Основной тест дубликата должен существовать и не быть дубликатом'});
      if (t.requirementIds.some((id) => !ids.has(id)))
        ctx.addIssue({ code: "custom", message: "Неизвестное требование" });
      if (t.status === "approved" && t.assumptions.length)
        ctx.addIssue({
          code: "custom",
          message: "Разрешите допущения перед утверждением",
        });
    }
  });
export function canEdit(role: string) {
  return role === "owner" || role === "tester";
}
export function invalidateReviews(
  next: z.infer<typeof projectSchema>,
  previous: z.infer<typeof projectSchema>,
) {
  const changed = new Set(
    next.requirements
      .filter((r) => {
        const old = previous.requirements.find((x) => x.id === r.id);
        return old && JSON.stringify(old) !== JSON.stringify(r);
      })
      .map((r) => r.id),
  );
  for (const t of next.cases) {
    const old = previous.cases.find((x) => x.id === t.id);
    if (changed.size && t.requirementIds.some((id) => changed.has(id)))
      t.status = "draft";
    if (
      old &&
      (
        [
          "title",
          "gherkin",
          "code",
          "artifacts",
          "framework",
          "requirementIds",
          "assumptions",
          "type",
        ] as const
      ).some((k) => JSON.stringify(t[k]) !== JSON.stringify(old[k]))
    )
      t.status = "draft";
  }
  return next;
}
export const runResultSchema = z.object({
  revision: z.number().int().min(0),
  caseId: id,
  outcome: z.enum(["untested", "passed", "failed", "blocked", "skipped"]),
  note: z.string().max(5000),
});
