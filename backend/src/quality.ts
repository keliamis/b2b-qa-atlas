import { z } from "zod";
export const filtersSchema = z.object({
  query: z.string().max(300).default(""),
  status: z.enum(["all", "draft", "review", "approved"]).default("all"),
  type: z.enum(["all", "positive", "negative", "boundary"]).default("all"),
  priority: z.enum(["all", "critical", "high", "medium", "low"]).default("all"),
  assignment: z.enum(["all", "mine", "unassigned"]).default("all"),
  suite: z.string().max(100).default("all"),
  sort: z.enum(["priority", "updated", "title", "due"]).default("priority"),
  favorites: z.boolean().default(false),
});
export const viewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  filters: filtersSchema,
});
export const defectCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(300),
    severity: z.enum(["critical", "high", "medium", "low"]),
    actual: z.string().trim().min(1).max(10000),
    expected: z.string().max(10000).default(""),
    steps: z.string().max(50000).default(""),
    environment: z.string().max(300).default(""),
    caseId: z.string().max(100).optional(),
    sourceRunId: z.string().max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.sourceRunId && !v.caseId)
      ctx.addIssue({ code: "custom", message: "Укажите тест из прогона" });
  });
export const defectUpdateSchema = z
  .object({
    revision: z.number().int().min(0),
    status: z.enum(["open", "in_progress", "fixed", "closed"]),
    severity: z.enum(["critical", "high", "medium", "low"]),
    assigneeId: z.string().max(100).nullable(),
    resolution: z.string().max(10000),
  })
  .superRefine((v, ctx) => {
    if (["fixed", "closed"].includes(v.status) && !v.resolution.trim())
      ctx.addIssue({
        code: "custom",
        message: "Опишите исправление или результат перепроверки",
      });
  });
