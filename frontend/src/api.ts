import type { Connection, Project, Job } from "./types";
export async function request<T>(
  c: Connection,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const r = await fetch(c.base.replace(/\/$/, "") + path, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${c.token}`,
        ...options.headers,
      },
    });
    if (!r.ok) {
      let body: any = {};
      try {
        body = await r.json();
      } catch {}
      throw new Error(
        r.status === 409
          ? "Проект изменён другим участником. Обновите данные перед сохранением."
          : typeof body.detail === "string"
            ? body.detail
            : `Ошибка сервера: ${r.status}`,
      );
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}
export const listProjects = (c: Connection) =>
  request<Project[]>(c, "/projects");
export const saveProject = (c: Connection, p: Project) =>
  request<Project>(c, `/projects/${p.id}`, {
    method: "PUT",
    body: JSON.stringify(p),
  });
export const listJobs = (c: Connection, id: string) =>
  request<Job[]>(c, `/projects/${id}/jobs`);
export async function downloadExport(c: Connection, id: string) {
  const r = await fetch(c.base + `/projects/${id}/export`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  if (!r.ok) throw new Error("Не удалось выгрузить проект");
  return r.blob();
}
