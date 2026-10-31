export type Priority = "critical" | "high" | "medium" | "low";
export type CaseStatus = "draft" | "review" | "approved";
export interface Requirement {
  id: string;
  key: string;
  title: string;
  text: string;
  priority: Priority;
  source: string;
  page?: number;
  pageEnd?: number;
  conditions?: { number: number; text: string }[];
  originalId?: string;
  extraction?: "explicit" | "numbered" | "heuristic" | "review";
}
export interface SourceFile {
  id: string;
  name: string;
  text: string;
}
export interface TestCase {
  id: string;
  key: string;
  title: string;
  requirementIds: string[];
  type: "positive" | "negative" | "boundary";
  priority: Priority;
  status: CaseStatus;
  gherkin: string;
  code: string;
  artifacts?: { pytest: string; playwright: string };
  framework: "pytest" | "playwright" | "junit";
  assumptions: string[];
  origin: "manual" | "example" | "ai";
  duplicateOf?: string;
  updatedAt: string;
  assigneeId?: string;
  dueDate?: string;
  labels?: string[];
  suite?: string;
}
export interface Audit {
  id: string;
  at: string;
  action: string;
  target: string;
  actor?: string;
}
export interface Project {
  archived?: boolean;
  id: string;
  name: string;
  description: string;
  revision: number;
  role?: "owner" | "tester" | "viewer";
  requirements: Requirement[];
  cases: TestCase[];
  sources: SourceFile[];
  audit: Audit[];
}
export interface Job {
  id: string;
  project_id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: string;
  error?: string | null;
  result?: any;
  created_at: string;
}
export interface Connection {
  base: string;
  token: string;
}
export const priorityLabels: Record<Priority, string> = {
  critical: "Критичный",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};
export const statusLabels: Record<CaseStatus, string> = {
  draft: "Черновик",
  review: "На ревью",
  approved: "Утверждён",
};
export const typeLabels = {
  positive: "Позитивный",
  negative: "Негативный",
  boundary: "Граничный",
};
export const uid = () => crypto.randomUUID();
