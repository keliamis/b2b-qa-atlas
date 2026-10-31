import type { Project, TestCase, Priority } from "./types";
export interface CaseFilters {
  query: string;
  status: string;
  type: string;
  priority: string;
  assignment: string;
  suite: string;
  sort: string;
  favorites: boolean;
}
export const defaultFilters: CaseFilters = {
  query: "",
  status: "all",
  type: "all",
  priority: "all",
  assignment: "all",
  suite: "all",
  sort: "priority",
  favorites: false,
};
export interface SavedView {
  id: string;
  name: string;
  filters: CaseFilters;
}
export const priorityRank: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
export function filterCases(
  cases: TestCase[],
  filters: CaseFilters,
  userId?: string,
  favorites: string[] = [],
) {
  const query = filters.query.trim().toLocaleLowerCase("ru");
  return cases
    .filter(
      (c) =>
        (filters.status === "all" || c.status === filters.status) &&
        (filters.type === "all" || c.type === filters.type) &&
        (filters.priority === "all" || c.priority === filters.priority) &&
        (filters.assignment === "all" ||
          (filters.assignment === "mine" &&
            !!userId &&
            c.assigneeId === userId) ||
          (filters.assignment === "unassigned" && !c.assigneeId)) &&
        (filters.suite === "all" ||
          (c.suite || "Без набора") === filters.suite) &&
        (!filters.favorites || favorites.includes(c.id)) &&
        (!query ||
          `${c.key} ${c.title} ${c.gherkin} ${(c.labels || []).join(" ")} ${c.suite || ""}`
            .toLocaleLowerCase("ru")
            .includes(query)),
    )
    .sort((a, b) => {
      if (filters.sort === "title") return a.title.localeCompare(b.title, "ru");
      if (filters.sort === "updated")
        return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
      if (filters.sort === "due")
        return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
      return (
        priorityRank[a.priority] - priorityRank[b.priority] ||
        a.key.localeCompare(b.key)
      );
    });
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function getAttention(p: Project, userId?: string, today = localDate()) {
  return {
    mine: p.cases.filter(
      (c) => !!userId && c.assigneeId === userId && c.status !== "approved",
    ),
    review: p.cases.filter((c) => c.status === "review"),
    overdue: p.cases.filter(
      (c) => !!c.dueDate && c.dueDate < today && c.status !== "approved",
    ),
    unassigned: p.cases.filter((c) => !c.assigneeId && c.status !== "approved"),
    questions: p.cases.filter((c) => c.assumptions.length),
    uncovered: p.requirements.filter(
      (r) => !p.cases.some((c) => c.requirementIds.includes(r.id)),
    ),
  };
}
export const defectStatuses = {
  open: "Открыт",
  in_progress: "В работе",
  fixed: "На перепроверке",
  closed: "Закрыт",
};
export type DefectStatus = keyof typeof defectStatuses;
export interface Defect {
  id: string;
  key: string;
  title: string;
  severity: Priority;
  actual: string;
  expected: string;
  steps: string;
  environment: string;
  caseId?: string;
  sourceRunId?: string;
  status: DefectStatus;
  assigneeId: string | null;
  resolution: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  author: string;
  source: {
    runId: string;
    runName: string;
    runRevision: number;
    caseId: string;
    caseKey: string;
    caseTitle: string;
    gherkin: string;
    outcome: string;
    note: string;
    environment: string;
    at: string;
    by: string;
  } | null;
  history: {
    at: string;
    author: string;
    status: DefectStatus;
    message: string;
  }[];
}
export interface DefectDraft {
  title: string;
  severity: Priority;
  actual: string;
  expected: string;
  steps: string;
  environment: string;
  caseId?: string;
  sourceRunId?: string;
}
export function defectMarkdown(d: Defect) {
  return `# ${d.key}: ${d.title}\n\nПриоритет: ${d.severity}\nСтатус: ${defectStatuses[d.status]}\nОкружение: ${d.environment || "Не указано"}\n\n## Шаги\n${d.steps || d.source?.gherkin || "Не указаны"}\n\n## Ожидаемый результат\n${d.expected || "См. сценарий"}\n\n## Фактический результат\n${d.actual}\n\n## Источник\n${d.source ? `${d.source.runName} / ${d.source.caseKey} / версия прогона ${d.source.runRevision}` : "Создан вручную"}\n\n## Решение\n${d.resolution || "Не зафиксировано"}\n`;
}
