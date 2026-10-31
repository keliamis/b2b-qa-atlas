export interface Session {
  id: string;
  email: string;
  name: string;
  auth: string;
}
export interface Member {
  id: string;
  email: string;
  name: string;
  role: "owner" | "tester" | "viewer";
}
export interface Invitation {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_by: string | null;
  revoked: number;
}
export interface Team {
  members: Member[];
  invitations: Invitation[];
  role: string;
}
export interface Comment {
  id: string;
  case_id: string;
  author: string;
  body: string;
  created_at: string;
}
export type Outcome = "untested" | "passed" | "failed" | "blocked" | "skipped";
export interface RunResult {
  caseId: string;
  key: string;
  title: string;
  gherkin: string;
  outcome: Outcome;
  note: string;
  by: string | null;
  at: string | null;
}
export interface ManualRun {
  id: string;
  name: string;
  environment: string;
  createdAt: string;
  author: string;
  revision: number;
  projectRevision: number;
  results: RunResult[];
}
export async function cloud<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), method === "GET" ? 15000 : 150000);
  try {
    const response = await fetch("/workspace-api" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    let value: any;
    try {
      value = await response.json();
    } catch {
      if (controller.signal.aborted) throw new Error("Запрос превысил время ожидания. Проверьте состояние операции перед повтором.");
      throw Object.assign(new Error("Сервер вернул некорректный ответ. Попробуйте обновить страницу."), {status: response.status});
    }
    if (!response.ok)
      throw Object.assign(new Error(value?.detail || "Не удалось выполнить запрос"), {status: response.status});
    return value;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Запрос превысил время ожидания. Проверьте состояние операции перед повтором.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export const roleLabels = {
  owner: "Владелец",
  tester: "Тестировщик",
  viewer: "Наблюдатель",
};
export const outcomeLabels: Record<Outcome, string> = {
  untested: "Не проверен",
  passed: "Пройден",
  failed: "Ошибка",
  blocked: "Заблокирован",
  skipped: "Пропущен",
};
