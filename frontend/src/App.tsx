import { useState, useEffect, useRef, Fragment, type ReactNode } from "react";
import {
  LayoutDashboard,
  Files,
  ListChecks,
  Network,
  Play,
  Settings,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Upload,
  Download,
  Sparkles,
  ArrowUpRight,
  Check,
  CheckCheck,
  X,
  FileText,
  Code2,
  Clock,
  ShieldCheck,
  AlertCircle,
  MoreHorizontal,
  ArrowRight,
  ExternalLink,
  FolderOpen,
  History,
  Copy,
  Trash2,
  RefreshCw,
  Menu,
  Command,
  CheckCircle2,
  LoaderCircle,
  Link2,
  BookOpen,
  SlidersHorizontal,
  ArrowLeft,
} from "lucide-react";
import JSZip from "jszip";
import { AutoRuns, SourcePanel, RunMetrics, Artifacts } from "./AutoRuns";
import { Inbox, Bug, Bell, Layers } from "lucide-react";
import { ProjectInsights } from "./Insights";
import { CaseLibrary } from "./CaseLibrary";
import { Cockpit, MyWork, CommandPalette, WelcomeGate } from "./Workbench";
import { Defects } from "./Defects";
import { getAttention, type DefectDraft } from "./quality";
import { Sun, Moon, Users, BarChart3, Columns3, Star } from "lucide-react";
import { Analytics } from "./Analytics";
import {
  AccountPanel,
  TeamView,
  CollaborationPanel,
  ReviewBoard,
  ManualRuns,
} from "./Workspace";
import { cloud, type Session } from "./cloud";
import { exampleProject } from "./seed";
import {
  request,
  listProjects,
  saveProject,
  listJobs,
  downloadExport,
} from "./api";
import {
  uid,
  priorityLabels,
  statusLabels,
  typeLabels,
  type Project,
  type Requirement,
  type TestCase,
  type Connection,
  type Job,
  type Priority,
} from "./types";

type Page =
  | "autoruns"
  | "coverage"
  | "mywork"
  | "defects"
  | "analytics"
  | "team"
  | "board"
  | "overview"
  | "requirements"
  | "tests"
  | "trace"
  | "runs"
  | "activity"
  | "settings";
const nav = [
  { id: "overview", icon: LayoutDashboard, label: "Обзор проекта" },
  { id: "mywork", icon: Inbox, label: "Моя работа" },
  { id: "analytics", icon: BarChart3, label: "Аналитика" },
  { id: "board", icon: Columns3, label: "Доска ревью" },
  { id: "requirements", icon: Files, label: "Требования" },
  { id: "tests", icon: ListChecks, label: "Тест-кейсы" },
  { id: "trace", icon: Network, label: "Связи и покрытие" },
  { id: "runs", icon: Play, label: "Ручные прогоны" },
  { id: "autoruns", icon: Play, label: "Автопрогоны" },
  { id: "coverage", icon: Code2, label: "Покрытие кода" },
  { id: "defects", icon: Bug, label: "Дефекты" },
  { id: "team", icon: Users, label: "Команда" },
  { id: "activity", icon: History, label: "История изменений" },
] as const;
const blankProject = (name: string): Project => ({
  id: uid(),
  name,
  description: "",
  revision: 0,
  requirements: [],
  cases: [],
  sources: [],
  audit: [],
});
const nextKey = (items: { key: string }[], prefix: string) =>
  `${prefix}-${String(Math.max(0, ...items.map((x) => Number(x.key.split("-").pop()) || 0)) + 1).padStart(3, "0")}`;
const formatDate = (s: string) =>
  new Date(s).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const clone = <T,>(v: T): T => structuredClone(v);
function loadLocal(): Project[] {
  try {
    const v = JSON.parse(
      localStorage.getItem("qa-atlas-projects-v1") || "null",
    );
    if (
      Array.isArray(v) &&
      v.every(
        (p) =>
          Array.isArray(p.cases) &&
          Array.isArray(p.requirements) &&
          Array.isArray(p.sources) &&
          Array.isArray(p.audit),
      )
    )
      return v;
  } catch {}
  return [clone(exampleProject)];
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Badge({ status }: { status: TestCase["status"] }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {statusLabels[status]}
    </span>
  );
}
function PriorityTag({ value }: { value: Priority }) {
  return (
    <span className={`priority ${value}`}>
      <span>
        {value === "critical"
          ? "↑↑"
          : value === "high"
            ? "↑"
            : value === "medium"
              ? "−"
              : "↓"}
      </span>
      {priorityLabels[value]}
    </span>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FolderOpen size={26} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function App({
  hostedRuntime = false,
  signInUrl = "/login?return_to=%2F",
}: { hostedRuntime?: boolean; signInUrl?: string } = {}) {
  const [showWelcome, setShowWelcome] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [defectDraft, setDefectDraft] = useState<DefectDraft | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(hostedRuntime);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("qa-atlas-theme") || "dark",
  );
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("qa-atlas-favorites") || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media?.matches ? "dark" : "light") : theme);
    apply();
    localStorage.setItem("qa-atlas-theme", theme);
    media?.addEventListener?.("change", apply);
    return () => media?.removeEventListener?.("change", apply);
  }, [theme]);
  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      localStorage.setItem("qa-atlas-favorites", JSON.stringify(next));
      return next;
    });
  }
  const [projects, setProjects] = useState<Project[]>(loadLocal);
  const [active, setActive] = useState(() => loadLocal()[0]?.id || "");
  const [page, setPage] = useState<Page>("overview");
  const [connection, setConnection] = useState<Connection>({
    base: "",
    token: "",
  });
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [tab, setTab] = useState("scenario");
  const [modal, setModal] = useState<
    "project" | "delete-project" | "requirement" | "test" | "import" | "generate" | "help" | null
  >(null);
  const [editingReq, setEditingReq] = useState<Requirement | null>(null);
  const [deleteProjectName, setDeleteProjectName] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef("");
  const mutationRef = useRef(false);
  const project = projects.find((p) => p.id === active) || projects[0];
  const currentCase = project?.cases.find((t) => t.id === detail);
  const readOnly = !!project?.archived || (cloudEnabled && project?.role === "viewer");
  async function openCloud() {
    setCloudLoading(true);
    try {
      const me = await cloud<Session>("/session");
      setSession(me);
      setShowWelcome(false);
      let accepted = "";
      const invite = new URLSearchParams(location.search).get("invite");
      if (invite) {
        try {
          accepted = (
            await cloud<{ projectId: string }>("/invitations/accept", "POST", {
              token: invite,
            })
          ).projectId;
          history.replaceState(null, "", location.pathname);
          notify("Приглашение принято");
        } catch (e) {
          setError((e as Error).message);
        }
      }
      const all = await cloud<Project[]>("/projects");
      setConnection({ base: "/api", token: "" });
      setConfig(await cloud("/config"));
      setConnected(true);
      setCloudEnabled(true);
      setProjects(all);
      setActive(all.some((p) => p.id === accepted) ? accepted : all[0]?.id || "");
      setJobs([]);
      setDetail(null);
      setModal(null);
    } catch (e) {
      if ((e as any).status === 401) {
        setShowWelcome(true);
        setError("");
      } else setError((e as Error).message);
    } finally {
      setCloudLoading(false);
    }
  }
  useEffect(() => {
    if (hostedRuntime) void openCloud();
  }, []);
  useEffect(() => {
    if (!cloudEnabled || modal || detail) return;
    let alive = true, pending = false;
    const poll = async () => {
      if (pending || mutationRef.current || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const all = await cloud<Project[]>("/projects");
        if (alive && !mutationRef.current) {
          setProjects(all);
          setActive((id) => all.some((p) => p.id === id) ? id : all[0]?.id || "");
        }
      } catch {} finally { pending = false; }
    };
    const timer = setInterval(poll, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cloudEnabled, modal, detail]);
  useEffect(() => {
    if (!connected && !cloudEnabled) {
      try {
        localStorage.setItem("qa-atlas-projects-v1", JSON.stringify(projects));
      } catch {
        setError(
          "Память браузера заполнена. Экспортируйте проект и подключите сервер.",
        );
      }
    }
  }, [projects, connected, cloudEnabled]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4200);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setDetail(null);
        setMenu(false);
        setProjectMenu(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!connected || !active) return;
    let alive = true, pending = false;
    async function poll() {
      if (pending) return;
      pending = true;
      try {
        const j = await listJobs(connection, active);
        if (!alive) return;
        setJobs(j);
        const key = j
          .filter((x) =>
            ["succeeded", "failed", "cancelled"].includes(x.status),
          )
          .map((x) => x.id)
          .join(",");
        if (terminalRef.current !== key) {
          terminalRef.current = key;
          if (!mutationRef.current) {
            const p = await listProjects(connection);
            if (alive) setProjects(p);
          }
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally { pending = false; }
    }
    poll();
    const t = setInterval(poll, 3500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connected, connection, active]);
  const notify = (text: string) => setToast(text);
  async function commit(next: Project, action: string, target: string) {
    if (readOnly) {
      setError("У вас доступ только для просмотра");
      return false;
    }
    if (mutationRef.current) return false;
    mutationRef.current = true;
    setSaving(true);
    setError("");
    try {
      next.audit = [
        ...next.audit.slice(-999),
        { id: uid(), at: new Date().toISOString(), action, target },
      ];
      let saved = next;
      if (connected) saved = await saveProject(connection, next);
      else if (cloudEnabled)
        saved = await cloud<Project>(`/projects/${next.id}`, "PUT", next);
      else saved.revision++;
      setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }
  async function addProject(name: string) {
    if (saving) return;
    setSaving(true);
    try {
      let p = blankProject(name);
      if (connected) p = await saveProject(connection, p);
      else if (cloudEnabled)
        p = await cloud<Project>(`/projects/${p.id}`, "PUT", p);
      setProjects((prev) => [...prev, p]);
      setActive(p.id);
      setModal(null);
      setPage("overview");
      notify("Проект создан");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function toggleArchive() {
    if (saving) return;
    setSaving(true);setError("");
    try {
      const next = cloudEnabled ? await cloud<Project>(`/projects/${project.id}/archive`, "POST", {archived:!project.archived,revision:project.revision})
        : {...project, archived:!project.archived, revision:project.revision+1};
      setProjects(items=>items.map(p=>p.id===next.id?next:p));
      notify(next.archived ? "Проект в архиве. Данные сохранены" : "Проект восстановлен");
    } catch(e) {setError((e as Error).message);} finally {setSaving(false);}
  }
  async function deleteProject() {
    if (!project || saving || mutationRef.current || readOnly) return;
    if (deleteProjectName !== project.name) return;
    mutationRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (cloudEnabled) await cloud(`/projects/${project.id}`, "DELETE");
      else if (connected) await request(connection, `/projects/${project.id}`, { method: "DELETE" });
      const remaining = projects.filter((p) => p.id !== project.id);
      try { localStorage.removeItem(`qa-atlas-views-${project.id}`); } catch {}
      setProjects(remaining);
      setActive(remaining[0]?.id || "");
      setJobs([]);
      setDetail(null);
      setSelected([]);
      setPage("overview");
      setModal(null);
      setDeleteProjectName("");
      notify("Проект удалён");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }
  async function refresh() {
    if (connected || cloudEnabled)
      try {
        const p = cloudEnabled
          ? await cloud<Project[]>("/projects")
          : await listProjects(connection);
        setProjects(p);
        setActive((id) => p.some((item) => item.id === id) ? id : p[0]?.id || "");
        setError("");
        notify("Данные обновлены");
      } catch (e) {
        setError((e as Error).message);
      }
  }
  // The user may delete even their final project. Do not silently recreate it.
  if (!project) {
    if (cloudLoading) return <div className="boot-screen">Загружаем проекты…</div>;
    if (showWelcome) return <WelcomeGate signInUrl={signInUrl} onDemo={() => setShowWelcome(false)} />;
    return <div className="boot-screen empty-workspace" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 520, width: "100%", padding: 32 }}>
        <h1>Пока нет проектов</h1>
        <p>Создайте новое пространство. Удалённые проекты не появляются снова автоматически.</p>
        {error && <p role="alert">{error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); void addProject(String(data.get("name") || "").trim()); }}>
          <label>Название проекта<input name="name" required maxLength={120} placeholder="Например, тестирование приложения" /></label>
          <button className="button primary" disabled={saving} type="submit"><Plus size={16}/> Создать проект</button>
        </form>
        {session && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
          <button className="button" onClick={() => {
            if (cloudEnabled) { const all = loadLocal(); setCloudEnabled(false); setConnected(false); setProjects(all); setActive(all[0]?.id || ""); }
            else void openCloud();
          }}>{cloudEnabled ? "Открыть локальные проекты" : "Открыть проекты аккаунта"}</button>
          <button className="button" onClick={async () => {
            const r = await fetch("/auth/logout", { method: "POST" });
            if (r.ok) location.assign("/login");
            else setError("Не удалось выйти из аккаунта");
          }}>Выйти из аккаунта</button>
        </div>}
      </div>
    </div>;
  }
  const covered = project.requirements.filter((r) =>
    project.cases.some((t) => t.requirementIds.includes(r.id)),
  ).length;
  const approved = project.cases.filter((t) => t.status === "approved").length;
  const review = project.cases.filter((t) => t.status === "review").length;
  const uncovered = project.requirements.filter(
    (r) => !project.cases.some((t) => t.requirementIds.includes(r.id)),
  );
  const matchedCases = project.cases.filter(
    (t) =>
      (status === "all" || t.status === status) &&
      (typeFilter === "all" || t.type === typeFilter) &&
      `${t.title} ${t.key} ${t.gherkin}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const matchedReqs = project.requirements.filter((r) =>
    `${r.title} ${r.text} ${r.key}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const busy = jobs.some((j) => ["queued", "running"].includes(j.status));
  function navigate(p: Page) {
    setPage(p);
    setSearch("");
    setSelected([]);
    setMenu(false);
    setDetail(null);
  }
  async function exportProject() {
    try {
      if (connected) {
        saveBlob(
          await downloadExport(connection, active),
          "qa-atlas-export.zip",
        );
      } else {
        const zip = new JSZip();
        zip.file("project.json", JSON.stringify(project, null, 2));
        project.cases.forEach((t, i) => {
          const stem = `test_${String(i + 1).padStart(3, "0")}`;
          zip.file(`features/${stem}.feature`, t.gherkin);
          if (t.code)
            zip.file(
              `tests/${stem}.${t.framework === "pytest" ? "py" : t.framework === "playwright" ? "spec.js" : "java"}`,
              t.code,
            );
        });
        zip.file(
          "README.txt",
          "QA Atlas. Экспорт содержит сценарии, черновики кода и project.json со связями. Тесты автоматически не запускались. Проверьте импорты, зависимости и окружение. Approved означает ручное ревью. Для Java имя файла должно совпадать с public class.",
        );
        saveBlob(
          await zip.generateAsync({ type: "blob" }),
          "qa-atlas-export.zip",
        );
      }
      notify("Проект экспортирован");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function updateStatus(id: string, value: TestCase["status"]) {
    const p = clone(project);
    const t = p.cases.find((x) => x.id === id)!;
    if (value === "approved" && t.assumptions.length) {
      setError(
        "Перед утверждением разрешите допущения в редакторе тест-кейса.",
      );
      return;
    }
    t.status = value;
    t.updatedAt = new Date().toISOString();
    if (
      await commit(
        p,
        "Изменён статус теста",
        `${t.key}: ${statusLabels[value]}`,
      )
    )
      notify("Статус сохранён");
  }
  async function removeCase(id: string) {
    if (
      !confirm(
        "Удалить этот тест-кейс? Это действие можно восстановить только из экспорта.",
      )
    )
      return;
    const p = clone(project);
    p.cases = p.cases.filter((t) => t.id !== id);
    if (await commit(p, "Удалён тест-кейс", currentCase?.key || id)) {
      setDetail(null);
      notify("Тест-кейс удалён");
    }
  }
  const table = (items: TestCase[]) => (
    <div className="table-scroll">
      <table className="tests-table">
        <thead>
          <tr>
            <th className="checkcell">
              <input
                aria-label="Выбрать все показанные тесты"
                type="checkbox"
                checked={
                  items.length > 0 &&
                  items.every((t) => selected.includes(t.id))
                }
                onChange={(e) =>
                  setSelected(e.target.checked ? items.filter(t=>!t.duplicateOf).map((t) => t.id) : [])
                }
              />
            </th>
            <th>Тест-кейс</th>
            <th>Тип проверки</th>
            <th>Приоритет</th>
            <th>Статус</th>
            <th>Срок</th>
            <th aria-label="Открыть" />
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Выбрать ${t.key}`}
                  checked={selected.includes(t.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked
                        ? [...prev, t.id]
                        : prev.filter((id) => id !== t.id),
                    )
                  }
                />
              </td>
              <td>
                <button
                  className="case-link"
                  onClick={() => {
                    setDetail(t.id);
                    setTab("scenario");
                  }}
                >
                  <span className="mono text-muted">{t.key}</span>
                  <strong>{t.title}{t.duplicateOf && <span className="badge">Дубликат</span>}</strong>
                  {t.suite && (
                    <span className="case-suite">
                      <Layers size={10} />
                      {t.suite}
                    </span>
                  )}
                  <small>
                    {t.requirementIds
                      .map(
                        (id) =>
                          project.requirements.find((r) => r.id === id)?.key,
                      )
                      .join(" · ") || "Без требования"}
                  </small>
                </button>
              </td>
              <td>
                <span className={`type ${t.type}`}>{typeLabels[t.type]}</span>
              </td>
              <td>
                <PriorityTag value={t.priority} />
              </td>
              <td>
                <Badge status={t.status} />
              </td>
              <td>
                <span className="case-due">{t.dueDate || "—"}</span>
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Открыть ${t.key}`}
                  onClick={() => {
                    setDetail(t.id);
                    setTab("scenario");
                  }}
                >
                  <ChevronRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <Empty
          title="Тест-кейсы не найдены"
          text="Измените фильтры или создайте первую проверку."
          action={
            <button
              className="button"
              disabled={readOnly}
              onClick={() => setModal("test")}
            >
              <Plus size={16} />
              Создать тест-кейс
            </button>
          }
        />
      )}
    </div>
  );
  if (cloudLoading)
    return (
      <div className="boot-screen">
        <strong>
          qa<span>atlas</span>
        </strong>
        <p>Загружаем профиль и проекты…</p>
      </div>
    );
  if (showWelcome)
    return (
      <WelcomeGate
        signInUrl={signInUrl}
        onDemo={() => {
          setShowWelcome(false);
          setCloudEnabled(false);
          setConnected(false);
          setError("");
        }}
      />
    );
  return (
    <div className="app-shell" data-page={page}>
      <aside className={`sidebar ${menu ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-symbol">
            <Network size={23} />
          </span>
          <span>
            qa<span className="brand-light">atlas</span>
            <small>QUALITY WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <div className="project-switch">
          <button
            onClick={() => setProjectMenu(!projectMenu)}
            aria-expanded={projectMenu}
          >
            <span className="project-avatar">
              {project.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">
              {project.name}
              <small>
                {cloudEnabled
                  ? "Проект аккаунта"
                  : connected
                    ? "Командный сервер"
                    : "Локальный проект"}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
          {projectMenu && (
            <div className="project-options">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setActive(p.id);
                    setProjectMenu(false);
                    setDetail(null);
                    setSelected([]);
                    setJobs([]);
                  }}
                >
                  {p.id === active && <Check size={14} />}
                  <span>{p.name}{p.archived ? " · Архив" : ""}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  setModal("project");
                  setProjectMenu(false);
                }}
              >
                <Plus size={14} />
                Новый проект
              </button>
            </div>
          )}
        </div>
        <nav>
          {nav.map((n) => (
            <Fragment key={n.id}>
              {["overview", "requirements", "team"].includes(n.id) && (
                <span className="nav-section-label">
                  {n.id === "overview"
                    ? "ПРОСТРАНСТВО"
                    : n.id === "requirements"
                      ? "ТЕСТИРОВАНИЕ"
                      : "УПРАВЛЕНИЕ"}
                </span>
              )}
              <button
                key={n.id}
                className={page === n.id ? "active" : ""}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={18} />
                <span>{n.label}</span>
                {n.id === "tests" && (
                  <span className="nav-count">{project.cases.length}</span>
                )}
                {n.id === "runs" && !cloudEnabled && (
                  <small className="soon-dot" title="Модуль в разработке" />
                )}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <ShieldCheck size={19} />
            <strong>
              {cloudEnabled
                ? "Вместе — точнее"
                : connected
                  ? "Сервер подключён"
                  : "Ваше пространство QA"}
            </strong>
            <p>
              {cloudEnabled
                ? "Пригласите коллег и проверяйте продукт вместе."
                : connected
                  ? "Данные сохраняются на вашем сервере."
                  : "Учебные данные хранятся в этом браузере."}
            </p>
            <button
              onClick={() => navigate(cloudEnabled ? "team" : "settings")}
            >
              {cloudEnabled
                ? "Открыть команду"
                : connected
                  ? "Настройки подключения"
                  : "Подключить сервер"}
              <ArrowRight size={14} />
            </button>
          </div>
          <button
            className={`bottom-link ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={18} />
            Настройки
          </button>
          <button className="bottom-link" onClick={() => setModal("help")}>
            <BookOpen size={18} />
            Как устроен QA Atlas
            <ArrowUpRight size={14} />
          </button>
          <div className="user">
            <span className="user-avatar">
              {session?.name.slice(0, 2).toUpperCase() || "QA"}
            </span>
            <span>
              {session?.name || "Команда качества"}
              <small>{session?.email || "Рабочее пространство · v0.8.3"}</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Открыть меню"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Рабочее пространство <ChevronRight size={13} />
            <strong>{project.name}</strong>
          </div>
          <button
            className="global-search-button"
            onClick={() => setCommandOpen(true)}
          >
            <Search size={16} />
            <span>Найти тест, требование или действие</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="top-actions">
            <button
              className="icon-button notification-button"
              aria-label="Открыть задачи, требующие внимания"
              onClick={() => navigate("mywork")}
            >
              <Bell size={18} />
              {getAttention(project, session?.id).overdue.length > 0 && <i />}
            </button>
            <button
              className="icon-button theme-toggle"
              aria-label="Переключить тему"
              onClick={() =>
                setTheme(
                  document.documentElement.dataset.theme === "dark"
                    ? "light"
                    : "dark",
                )
              }
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            {(cloudEnabled || connected) && (
              <button
                className="icon-button"
                aria-label="Обновить проект"
                onClick={refresh}
              >
                <RefreshCw size={17} />
              </button>
            )}
            <span
              className={`connection-pill ${connected || cloudEnabled ? "online" : ""}`}
            >
              <span />
              {cloudLoading
                ? "Подключение…"
                : cloudEnabled
                  ? "Сервер"
                  : connected
                    ? "Сервер"
                    : "Локальный режим"}
            </span>
            <button
              className="icon-button"
              aria-label="Помощь"
              onClick={() => setModal("help")}
            >
              <BookOpen size={18} />
            </button>
            <button
              className="user-avatar small"
              aria-label="Мой аккаунт"
              onClick={() => navigate("settings")}
            >
              {session?.name.slice(0, 2).toUpperCase() || "QA"}
            </button>
          </div>
        </header>
        <main>
          {!connected && !cloudEnabled && (
            <div className="demo-banner">
              <span>
                <span className="live-dot" />
                <strong>Демонстрационный режим</strong>
                <span className="banner-detail">
                  Изменения сохраняются в браузере. ИИ и прогоны не
                  симулируются.
                </span>
              </span>
              <button
                onClick={() =>
                  hostedRuntime && !session
                    ? setShowWelcome(true)
                    : navigate("settings")
                }
              >
                {hostedRuntime && !session ? "Войти в аккаунт" : "Подключение"}
                <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          {readOnly && (
            <div className="notice subtle">
              <ShieldCheck size={16} /> Вы наблюдатель: можете читать проекты и
              результаты. Для редактирования попросите владельца изменить роль.
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              {(connected || cloudEnabled) && (
                <button onClick={refresh}>Обновить</button>
              )}
              <button
                className="icon-button"
                aria-label="Закрыть ошибку"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "ВАШ ЦЕНТР УПРАВЛЕНИЯ КАЧЕСТВОМ"
                  : "QA ATLAS / " + project.name.toUpperCase()}
              </div>
              <h1>
                {page === "settings"
                  ? "Настройки пространства"
                  : nav.find((n) => n.id === page)?.label}
              </h1>
              <p>
                {
                  {
                    autoruns: "Выполняйте тесты и разбирайте результаты.",
                    coverage: "Покрытые и непокрытые строки исходного кода.",
                    mywork:
                      "Личная очередь, сроки и вопросы команды в текущем проекте.",
                    defects:
                      "Сохраняйте контекст ошибки от обнаружения до перепроверки.",
                    analytics:
                      "Замечайте пробелы, оценивайте готовность и выбирайте следующий шаг.",
                    team: "Приглашайте коллег, распределяйте проверки и обсуждайте результаты.",
                    board:
                      "Двигайте сценарии от первого черновика к общему решению.",
                    overview:
                      "От требований до уверенных решений — всё в одном проекте.",
                    requirements:
                      "Единый источник ожидаемого поведения вашего продукта.",
                    tests:
                      "Создавайте, проверяйте и поддерживайте тестовые сценарии.",
                    trace: "Понимайте, что проверяется и где ещё нужны тесты.",
                    runs: "Результаты должны быть подтверждены реальным выполнением.",
                    activity:
                      "Изменения требований и тестов в хронологическом порядке.",
                    settings:
                      "Соедините интерфейс с сервером и настройте генерацию.",
                  }[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {!readOnly &&
                ![
                  "settings",
                  "activity",
                  "runs",
                  "team",
                  "analytics",
                  "mywork",
                  "defects",
                ].includes(page) && (
                  <>
                    <button
                      className="button"
                      onClick={() => setModal("import")}
                    >
                      <Upload size={16} />
                      Импорт
                    </button>
                    <button
                      className="button primary"
                      onClick={() => {
                        if (page === "requirements") {
                          setEditingReq(null);
                          setModal("requirement");
                        } else setModal("generate");
                      }}
                    >
                      {page === "requirements" ? (
                        <Plus size={16} />
                      ) : (
                        <Sparkles size={16} />
                      )}{" "}
                      {page === "requirements"
                        ? "Требование"
                        : "Генерировать тесты"}
                    </button>
                  </>
                )}
            </div>
          </div>
          {['requirements','coverage','tests','autoruns'].includes(page) && <ProjectInsights key={project.id+page} project={project} section={page==='autoruns'?'reports':page as 'requirements'|'coverage'|'tests'} connected={connected} readOnly={readOnly} onCommit={commit} onOpen={c=>setDetail(c.id)} onError={setError}/>}
          {(page === "autoruns" || page === "coverage") && <AutoRuns key={project.id} project={project} connected={connected} readOnly={readOnly} coverageOnly={page === "coverage"} onError={setError}/>}
          {page === "overview" && <><RunMetrics project={project} jobs={jobs}/><SourcePanel key={project.id} project={project} connected={connected} readOnly={readOnly} onError={setError} onUploaded={()=>notify("Файл отправлен в очередь")}/></>}
          {page === "overview" && (
            <Cockpit
              project={project}
              session={session}
              hosted={cloudEnabled}
              onNavigate={(p) => navigate(p as Page)}
              onCase={(id) => {
                setDetail(id);
                setTab("scenario");
              }}
              onRequirement={(r) => {
                setEditingReq(r);
                setModal("requirement");
              }}
              onCreate={() => {
                setDetail(null);
                setModal("test");
              }}
            />
          )}
          {page === "mywork" && (
            <MyWork
              project={project}
              session={session}
              onCase={(id) => {
                setDetail(id);
                setTab("scenario");
              }}
            />
          )}
          {page === "defects" && (
            <Defects
              key={project.id}
              project={project}
              hosted={cloudEnabled}
              readOnly={readOnly}
              draft={defectDraft}
              onDraftConsumed={() => setDefectDraft(null)}
              onError={setError}
            />
          )}
          {page === "analytics" && (
            <Analytics
              full
              project={project}
              openTests={(s) => {
                navigate("tests");
                setStatus(s);
              }}
              openRequirements={() => navigate("requirements")}
              onCase={setDetail}
            />
          )}
          {page === "board" && (
            <ReviewBoard
              project={project}
              onCase={setDetail}
              onStatus={updateStatus}
              onError={setError}
              readOnly={readOnly}
              favorites={favorites}
              toggleFavorite={toggleFavorite}
            />
          )}
          {page === "team" && (
            <TeamView
              project={project}
              session={session}
              enabled={cloudEnabled}
              onError={setError}
            />
          )}
          {page === "runs" && cloudEnabled && (
            <ManualRuns
              project={project}
              enabled={cloudEnabled}
              onError={setError}
              readOnly={readOnly}
              onDefect={(draft) => {
                setDefectDraft(draft);
                navigate("defects");
              }}
            />
          )}
          {page === "tests" && (
            <CaseLibrary
              key={project.id}
              project={project}
              session={session}
              hosted={cloudEnabled}
              readOnly={readOnly}
              favorites={favorites}
              initialStatus={status}
              selected={selected}
              clearSelection={() => setSelected([])}
              renderTable={table}
              onCreate={() => {
                setDetail(null);
                setModal("test");
              }}
              onCommit={commit}
              onError={setError}
              onExport={exportProject}
            />
          )}
          {page === "requirements" && (
            <section className="card">
              <div className="filter-row">
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  inputRef={searchRef}
                />
                <span className="text-muted">
                  {project.requirements.length} требований
                </span>
                <button
                  className="button"
                  onClick={() => {
                    setSelected(matchedReqs.map((r) => r.id));
                    setModal("generate");
                  }}
                >
                  <Sparkles size={15} />
                  Создать проверки
                </button>
              </div>
              {matchedReqs.map((r) => {
                const count = project.cases.filter((t) =>
                  t.requirementIds.includes(r.id),
                ).length;
                return (
                  <div className="requirement-row" key={r.id}>
                    <div className="req-icon">
                      <FileText size={20} />
                    </div>
                    <div className="req-body">
                      <div className="req-title">
                        <span className="mono text-muted">{r.key}</span>
                        <PriorityTag value={r.priority} />
                      </div>
                      <button
                        className="title-button"
                        onClick={() => {
                          setEditingReq(r);
                          setModal("requirement");
                        }}
                      >
                        {r.title}
                      </button>
                      <p>
                        {r.text.slice(0, 220)}
                        {r.text.length > 220 ? "…" : ""}
                      </p>
                      <small>
                        <FileText size={12} />
                        {r.source || "Добавлено вручную"}
                        {r.page ? ` · стр. ${r.page}${r.pageEnd && r.pageEnd > r.page ? `–${r.pageEnd}` : ""}` : ""}
                        {r.conditions?.length ? ` · условий: ${r.conditions.length}` : ""}
                      </small>
                    </div>
                    <div className="req-right">
                      <span
                        className={`coverage-badge ${count ? "covered" : "missing"}`}
                      >
                        {count ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <AlertCircle size={14} />
                        )}{" "}
                        {count ? `${count} тест-кейса` : "Нет проверок"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected([r.id]);
                          setModal("generate");
                        }}
                      >
                        Создать тесты
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {!matchedReqs.length && (
                <Empty
                  title="Добавьте требования"
                  text="Загрузите спецификацию или опишите ожидаемое поведение вручную."
                  action={
                    <button
                      className="button primary"
                      onClick={() => {
                        setEditingReq(null);
                        setModal("requirement");
                      }}
                    >
                      <Plus size={16} />
                      Добавить требование
                    </button>
                  }
                />
              )}
            </section>
          )}
          {page === "trace" && (
            <>
              <div className="notice">
                <Network size={19} />
                <div>
                  <strong>Покрытие требований</strong>
                  <p>
                    Связь означает наличие сценария. Она не гарантирует полноту
                    проверки или успешный прогон. Покрытие строк кода смотрите
                    во вкладке «Покрытие кода».
                  </p>
                </div>
              </div>
              <section className="card">
                <div className="section-title padded">
                  <h3>Матрица прослеживаемости</h3>
                  <button className="button" onClick={exportProject}>
                    <Download size={15} />
                    Выгрузить связи
                  </button>
                </div>
                <div className="trace-list">
                  {project.requirements.map((r) => (
                    <div className="trace-row" key={r.id}>
                      <div>
                        <span className="mono text-muted">{r.key}</span>
                        <strong>{r.title}</strong>
                        {r.conditions?.length ? <small className="text-muted">{r.conditions.length} вложенных условий · без отдельных строк покрытия</small> : null}
                      </div>
                      <ArrowRight size={16} />
                      <div className="trace-tests">
                        {project.cases
                          .filter((t) => t.requirementIds.includes(r.id))
                          .map((t) => (
                            <button
                              key={t.id}
                              onClick={() => {
                                setDetail(t.id);
                                setTab("source");
                              }}
                              className={
                                t.status === "approved" ? "approved" : ""
                              }
                            >
                              <ListChecks size={14} />
                              {t.key}
                            </button>
                          ))}
                        {!project.cases.some((t) =>
                          t.requirementIds.includes(r.id),
                        ) && (
                          <button
                            className="missing"
                            onClick={() => {
                              setSelected([r.id]);
                              setModal("generate");
                            }}
                          >
                            <Plus size={14} />
                            Нужен тест
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {!project.requirements.length && (
                  <Empty
                    title="Связи ещё не созданы"
                    text="Добавьте требования и привяжите к ним тест-кейсы."
                  />
                )}
              </section>
            </>
          )}
          {page === "runs" && !cloudEnabled && (
            <section className="card runner-card">
              <div className="runner-illustration">
                <Code2 />
                <span />
                <Play />
                <span />
                <ShieldCheck />
              </div>
              <span className="tag">СЛЕДУЮЩИЙ МОДУЛЬ</span>
              <h2>Исполнитель тестов</h2>
              <p>
                Тесты ещё не запускались в QA Atlas. Здесь появятся реальные
                результаты pytest, Playwright и JUnit, отчёты покрытия и
                диагностика ошибок.
              </p>
              <div className="runner-features">
                <span>
                  <Check size={16} />
                  Изолированная среда
                </span>
                <span>
                  <Check size={16} />
                  Логи и артефакты
                </span>
                <span>
                  <Check size={16} />
                  Покрытие кода
                </span>
              </div>
              <button className="button primary" onClick={exportProject}>
                <Download size={16} />
                Экспортировать текущие тесты
              </button>
              <small>
                В первой части доступен экспорт для проверки в вашей среде.
              </small>
            </section>
          )}
          {page === "activity" && (
            <section className="card">
              <div className="section-title padded">
                <h3>Журнал проекта</h3>
                <span className="text-muted">Версия {project.revision}</span>
              </div>
              <div className="activity-list">
                {[...project.audit].reverse().map((a) => (
                  <div className="activity-item" key={a.id}>
                    <span className="activity-icon">
                      <History size={17} />
                    </span>
                    <div>
                      <strong>{a.action}</strong>
                      <p>
                        {a.target}
                        {a.actor ? ` · ${a.actor}` : ""}
                      </p>
                    </div>
                    <time>{formatDate(a.at)}</time>
                  </div>
                ))}
              </div>
              {!project.audit.length && (
                <Empty
                  title="Изменений пока нет"
                  text="Действия с проектом будут отображаться здесь."
                />
              )}
            </section>
          )}
          {page === "settings" && (
            <>
              <AccountPanel
                session={session}
                hosted={cloudEnabled}
                onCloud={openCloud}
                onImportLocal={async () => {
                  setCloudLoading(true);
                  try {
                    const p = clone(project);
                    p.id = uid();
                    p.revision = 0;
                    delete p.role;
                    for (const c of p.cases) delete c.assigneeId;
                    const saved = await cloud<Project>(
                      `/projects/${p.id}`,
                      "PUT",
                      p,
                    );
                    const all = await cloud<Project[]>("/projects");
                    setProjects(all);
                    setActive(saved.id);
                    setCloudEnabled(true);
                    setConnected(true);
                    notify("Копия проекта сохранена в аккаунте");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setCloudLoading(false);
                  }
                }}
                onLocal={() => {
                  setCloudEnabled(false);
                  setConnected(false);
                  const all = loadLocal();
                  setProjects(all);
                  setActive(all[0]?.id || "");
                  setJobs([]);
                }}
                theme={theme}
                setTheme={setTheme}
              />
              <section className="card settings-card">
                <h3>Сервер обработки</h3>
                <p>
                  Подключается автоматически вместе с вашим аккаунтом. Проекты,
                  команда и генерация используют одно хранилище.
                </p>
                <p>
                  ИИ:{" "}
                  <strong>
                    {config?.ai_ready ? config.model : "не настроен"}
                  </strong>
                </p>
                <p className="text-muted">
                  Ключ и модель задаёт администратор в конфигурации сервера.
                  Импорт документов работает без ключа ИИ.
                </p>
                <p className="text-muted">Автопрогоны: {config?.runner_ready ? "исполнитель подключён" : connected ? "исполнитель недоступен — проверьте контейнер runner" : "требуется подключение к серверу"}. Запуск доступен во вкладке «Автопрогоны».</p>
                <button className="button" onClick={exportProject}>
                  <Download size={16} /> Экспортировать проект
                </button>
              </section>
              <section className="card settings-card">
                <h3>{project.archived ? "Проект в архиве" : "Архив проекта"}</h3>
                <p>Архив сохраняет требования, тесты и историю. После восстановления можно продолжить работу.</p>
                <button className="button" disabled={saving || (cloudEnabled && project.role !== "owner")} onClick={()=>void toggleArchive()}>{project.archived ? "Восстановить проект" : "Архивировать проект"}</button>
              </section>
              <section className="card settings-card">
                <h3>Удаление проекта</h3>
                <p className="text-muted">Удаляется сам проект, его тесты, требования, связанные обсуждения, прогоны и отчёты. Это действие нельзя отменить. Другие проекты не затрагиваются.</p>
                <button className="button danger-action" disabled={saving || readOnly || (cloudEnabled && project.role !== "owner")} onClick={() => { setDeleteProjectName(""); setModal("delete-project"); }}><Trash2 size={16}/> Удалить проект</button>
                {cloudEnabled && project.role !== "owner" && <small>Удалить командный проект может только его владелец.</small>}
              </section>
            </>
          )}
          {jobs.length > 0 && (
            <section className="card job-section">
              <div className="section-title padded">
                <h3>Фоновые задачи</h3>
                <span className="text-muted">{jobs.length}</span>
              </div>
              {jobs.slice(0, 5).map((j) => (
                <div className="job-row" key={j.id}>
                  <div>
                    {["queued", "running"].includes(j.status) ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : j.status === "succeeded" ? (
                      <CheckCircle2 size={18} />
                    ) : (
                      <AlertCircle size={18} />
                    )}
                  </div>
                  <div>
                    <strong>
                      {j.kind === "import"
                        ? "Импорт документа"
                        : j.kind === "autorun" ? "Автопрогон" : j.kind === "embeddings" ? "Семантический индекс" : "Генерация тестов"}
                    </strong>
                    {j.kind === "generate" && j.result?.framework && (
                      <small className="text-muted">
                        {j.result.framework === "pytest" ? "Python · pytest" : j.result.framework === "playwright" ? "JavaScript · Playwright" : "Java · JUnit"}
                        {j.result.includeCode ? " · с кодом автотестов" : " · только Gherkin"}
                        {j.created_at ? ` · ${new Date(j.created_at).toLocaleString("ru-RU")}` : ""}
                      </small>
                    )}
                    <p>{j.error || j.progress}</p>
                    {j.result?.questions?.length > 0 && (
                      <ul className="questions">
                        {j.result.questions.map((q: string, i: number) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {["queued", "running"].includes(j.status) && (
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await request(connection, `/jobs/${j.id}/cancel`, {
                            method: "POST",
                          });
                          setJobs(await listJobs(connection, active));
                          notify(
                            "Сохранение результата отменено. Уже отправленный запрос ИИ может завершиться и тарифицироваться.",
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Отменить
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          <footer className="page-footer">
            <span>
              QA Atlas <span className="text-muted">/</span> Пространство
              качества · v0.8.3
            </span>
            <span>
              {saving ? (
                <>
                  <LoaderCircle className="spin" size={13} />
                  Сохранение…
                </>
              ) : (
                <>
                  <Check size={13} />
                  {cloudEnabled
                    ? "Серверное хранение · обновление каждые 20 с"
                    : connected
                      ? "Сохранено на сервере"
                      : "Локальные изменения сохраняются"}
                </>
              )}
            </span>
          </footer>
        </main>
      </div>
      {currentCase && (
        <div
          className="drawer-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={currentCase.title}
          >
            <div className="drawer-head">
              <span>
                <ListChecks size={17} />
                <span className="mono">{currentCase.key}</span>
              </span>
              <button
                className="icon-button"
                aria-label="Закрыть тест"
                onClick={() => setDetail(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="drawer-body">
              <div className="detail-meta">
                <Badge status={currentCase.status} />
                <PriorityTag value={currentCase.priority} />
                <button
                  className={`icon-button ${favorites.includes(currentCase.id) ? "is-favorite" : ""}`}
                  aria-label="В избранное"
                  aria-pressed={favorites.includes(currentCase.id)}
                  onClick={() => toggleFavorite(currentCase.id)}
                >
                  <Star size={17} />
                </button>
              </div>
              <h2>{currentCase.title}</h2>
              <p className="text-muted">
                {typeLabels[currentCase.type]} · {currentCase.framework} ·{" "}
                {currentCase.origin === "example"
                  ? "Учебный пример"
                  : currentCase.origin === "ai"
                    ? "Черновик ИИ"
                    : "Создан вручную"}
              </p>
              <div className="tabs drawer-tabs">
                {[
                  ["scenario", "Сценарий"],
                  ["code", "Автотест"],
                  ["source", "Требования"],
                  ["team", "Обсуждение"],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={tab === v ? "selected" : ""}
                    onClick={() => setTab(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {tab === "team" && (
                <CollaborationPanel
                  project={project}
                  test={currentCase}
                  enabled={cloudEnabled}
                  readOnly={readOnly}
                  onError={setError}
                  onUpdate={async (patch) => {
                    const p = clone(project);
                    Object.assign(
                      p.cases.find((c) => c.id === currentCase.id)!,
                      patch,
                    );
                    return await commit(
                      p,
                      "Изменено назначение",
                      currentCase.key,
                    );
                  }}
                />
              )}
              {tab === "scenario" && (
                <>
                  <Artifacts test={currentCase}/>
                  <div className="code-head">
                    <span>Gherkin</span>
                    <button
                      className="icon-button"
                      aria-label="Копировать сценарий"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(currentCase.gherkin)
                          .then(() => notify("Сценарий скопирован"))
                          .catch(() => setError("Браузер запретил копирование"))
                      }
                    >
                      <Copy size={15} />
                    </button>
                  </div>
                  <pre className="gherkin">
                    {currentCase.gherkin.split("\n").map((line, i) => (
                      <div key={i}>
                        <span className="line-number">{i + 1}</span>
                        <span>
                          {line
                            .split(/(Feature:|Scenario:|Given|When|Then|And)/)
                            .map((s, j) => (
                              <span
                                key={j}
                                className={
                                  /^(Feature:|Scenario:|Given|When|Then|And)$/.test(
                                    s,
                                  )
                                    ? "keyword"
                                    : ""
                                }
                              >
                                {s}
                              </span>
                            ))}
                        </span>
                      </div>
                    ))}
                  </pre>
                  {currentCase.assumptions.length > 0 && (
                    <div className="assumptions">
                      <h4>
                        <AlertCircle size={17} />
                        Требует уточнения
                      </h4>
                      <ul>
                        {currentCase.assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                      <small>
                        Разрешите допущения перед утверждением сценария.
                      </small>
                    </div>
                  )}
                </>
              )}
              {tab === "code" &&
                (currentCase.code ? (
                  <>
                    <div className="notice subtle">
                      <AlertCircle size={16} />
                      Проверьте код перед запуском. Лимит прогона — 75 секунд.
                    </div>
                    <pre className="code-block">{currentCase.code}</pre>
                    
                    <Artifacts test={currentCase}/>
                    {currentCase.artifacts && Object.entries(currentCase.artifacts).filter(([f,c])=>f!==currentCase.framework && c).map(([f,c])=><details key={f}><summary>Код {f}</summary><pre className="code-block">{c}</pre></details>)}
                    <div className="auto-actions">
                      <button className="button primary" disabled={!connected || saving || readOnly || busy || currentCase.framework === 'junit'} onClick={async()=>{
                        setSaving(true);
                        try {
                          await request(connection,`/projects/${active}/auto-runs`,{method:'POST',body:JSON.stringify({framework:currentCase.framework,case_ids:[currentCase.id]})});
                          setDetail(null);setPage('autoruns');notify('Автотест поставлен в очередь');
                        } catch(e){setError((e as Error).message);} finally {setSaving(false);}
                      }}><Play size={15}/>Запустить автотест</button>
                      <button
                        className="button"
                        onClick={() =>
                          saveBlob(
                            new Blob([currentCase.code], { type: "text/plain" }),
                            `test_case.${currentCase.framework === "pytest" ? "py" : currentCase.framework === "playwright" ? "spec.js" : "java"}`,
                          )
                        }
                      >
                        <Download size={15} />
                        Скачать код
                      </button>
                    </div>
                  </>
                ) : (
                  <Empty
                    title="Автотест ещё не создан"
                    text="Добавьте исходный код и включите генерацию автотестов. Готовый код также можно вставить в редакторе."
                  />
                ))}
              {tab === "source" && (
                <>
                  {currentCase.requirementIds.map((id) => {
                    const r = project.requirements.find((x) => x.id === id);
                    return (
                      r && (
                        <div className="source-card" key={id}>
                          <span className="mono">{r.key}</span>
                          <h3>{r.title}</h3>
                          <p>{r.text}</p>
                          <small>{r.source}</small>
                        </div>
                      )
                    );
                  })}
                  {!currentCase.requirementIds.length && (
                    <p className="text-muted">
                      Привяжите требование в редакторе.
                    </p>
                  )}
                </>
              )}
              <div className="detail-bottom">
                <span>
                  <Clock size={14} />
                  Изменён {formatDate(currentCase.updatedAt)}
                </span>
                <button
                  className="icon-button danger"
                  disabled={saving || readOnly}
                  aria-label="Удалить тест"
                  onClick={() => removeCase(currentCase.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div className="drawer-footer">
              <button
                className="icon-button"
                aria-label="Дублировать тест-кейс"
                disabled={saving || readOnly}
                onClick={async () => {
                  const p = clone(project);
                  const copy = {
                    ...clone(currentCase),
                    id: uid(),
                    key: nextKey(p.cases, "TC"),
                    title: currentCase.title + " (копия)",
                    status: "draft" as const,
                    origin: "manual" as const,
                    updatedAt: new Date().toISOString(),
                  };
                  delete copy.assigneeId;
                  delete copy.dueDate;
                  p.cases.push(copy);
                  if (await commit(p, "Создана копия теста", copy.key)) {
                    setDetail(copy.id);
                    notify("Копия создана");
                  }
                }}
              >
                <Copy size={17} />
              </button>
              <button
                className="button"
                disabled={readOnly}
                onClick={() => setModal("test")}
              >
                Редактировать
              </button>
              <button
                className="button primary"
                disabled={saving || readOnly}
                onClick={() =>
                  updateStatus(
                    currentCase.id,
                    currentCase.status === "approved"
                      ? "review"
                      : currentCase.status === "draft"
                        ? "review"
                        : "approved",
                  )
                }
              >
                <Check size={16} />
                {currentCase.status === "draft"
                  ? "На ревью"
                  : currentCase.status === "review"
                    ? "Утвердить"
                    : "Вернуть на ревью"}
              </button>
            </div>
          </aside>
        </div>
      )}
      {modal === "delete-project" && (
        <Modal title="Удалить проект?" subtitle={`«${project.name}» и все связанные данные будут удалены без возможности восстановления.`} onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); void deleteProject(); }}>
            <p>Перед удалением рекомендуем экспортировать проект. Участники команды потеряют к нему доступ.</p>
            <label>Введите точное название проекта для подтверждения
              <input autoFocus name="confirmProjectName" value={deleteProjectName} onChange={(e) => setDeleteProjectName(e.target.value)} autoComplete="off" placeholder={project.name} />
            </label>
            <div className="modal-footer">
              <button type="button" className="button" onClick={() => setModal(null)}>Отмена</button>
              <button type="submit" className="button danger-action" disabled={saving || deleteProjectName !== project.name}><Trash2 size={15}/> Удалить безвозвратно</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "project" && (
        <Modal
          title="Новый проект"
          subtitle="Отдельное пространство для требований и проверок."
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              addProject(String(f.get("name")).trim());
            }}
          >
            <label>
              Название проекта
              <input
                required
                name="name"
                maxLength={120}
                placeholder="Например, личный кабинет поставщика"
              />
            </label>
            <div className="modal-footer">
              <button
                className="button"
                type="button"
                onClick={() => setModal(null)}
              >
                Отмена
              </button>
              <button className="button primary" disabled={saving || readOnly}>
                Создать проект
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "requirement" && (
        <Modal
          title={editingReq ? "Редактировать требование" : "Новое требование"}
          subtitle="Опишите ожидаемое поведение и ограничения."
          onClose={() => setModal(null)}
          wide
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const p = clone(project);
              const r: Requirement = {
                ...(editingReq || {}),
                id: editingReq?.id || uid(),
                key: editingReq?.key || nextKey(p.requirements, "REQ"),
                title: String(f.get("title")).trim(),
                text: String(f.get("text")).trim(),
                source: String(f.get("source")),
                priority: f.get("priority") as Priority,
              };
              if (!r.title || !r.text) return;
              if (editingReq) {
                p.requirements = p.requirements.map((x) =>
                  x.id === r.id ? r : x,
                );
                if (editingReq.text !== r.text)
                  p.cases.forEach((t) => {
                    if (t.requirementIds.includes(r.id)) {
                      t.status = "review";
                      t.updatedAt = new Date().toISOString();
                    }
                  });
              } else p.requirements.push(r);
              if (
                await commit(
                  p,
                  editingReq ? "Изменено требование" : "Добавлено требование",
                  r.key,
                )
              ) {
                setModal(null);
                notify(
                  editingReq
                    ? "Требование сохранено. Связанные тесты отправлены на ревью."
                    : "Требование добавлено",
                );
              }
            }}
          >
            <label>
              Название
              <input
                name="title"
                required
                maxLength={300}
                defaultValue={editingReq?.title}
              />
            </label>
            <label>
              Описание
              <textarea
                name="text"
                required
                rows={7}
                maxLength={120000}
                defaultValue={editingReq?.text}
                placeholder="При каких условиях, какое действие и какой результат ожидаются?"
              />
            </label>
            <div className="form-grid">
              <label>
                Приоритет
                <select
                  name="priority"
                  defaultValue={editingReq?.priority || "medium"}
                >
                  {Object.entries(priorityLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Источник
                <input
                  name="source"
                  maxLength={500}
                  defaultValue={editingReq?.source}
                  placeholder="Документ, раздел или ссылка"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setModal(null)}
              >
                Отмена
              </button>
              <button className="button primary" disabled={saving || readOnly}>
                Сохранить требование
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "test" && (
        <CaseEditor
          initial={currentCase}
          project={project}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={async (t) => {
            const p = clone(project);
            const index = p.cases.findIndex((x) => x.id === t.id);
            if (index >= 0) p.cases[index] = t;
            else p.cases.push(t);
            if (
              await commit(
                p,
                index >= 0 ? "Изменён тест-кейс" : "Создан тест-кейс",
                t.key,
              )
            ) {
              setModal(null);
              setDetail(t.id);
              notify("Тест сохранён как черновик");
            }
          }}
        />
      )}
      {modal === "import" && (
        <ImportModal
          connected={connected}
          saving={saving || busy}
          onClose={() => setModal(null)}
          onImport={async (file) => {
            setSaving(true);
            try {
              if (file.size > 10 * 1024 * 1024)
                throw new Error("Лимит файла — 10 МБ");
              if (connected) {
                const form = new FormData();
                form.append("file", file);
                await request(connection, `/projects/${active}/documents`, {
                  method: "POST",
                  body: form,
                });
                setJobs(await listJobs(connection, active));
                setModal(null);
                notify("Документ отправлен в очередь");
              } else {
                const ext = file.name.split(".").pop()?.toLowerCase();
                if (["pdf", "docx"].includes(ext || ""))
                  throw new Error(
                    "Для PDF и DOCX подключите сервер. Локально доступны MD, TXT и исходные файлы.",
                  );
                if (
                  !["md", "txt", "py", "js", "ts", "java"].includes(ext || "")
                )
                  throw new Error("Неподдерживаемый формат");
                const text = await file.text();
                if (!text.trim() || text.length > 120000)
                  throw new Error(
                    "Файл пуст или содержит больше 120 000 символов",
                  );
                const p = clone(project);
                if (["py", "js", "ts", "java"].includes(ext || ""))
                  p.sources.push({ id: uid(), name: file.name, text });
                else
                  p.requirements.push({
                    id: uid(),
                    key: nextKey(p.requirements, "REQ"),
                    title: file.name,
                    text,
                    priority: "medium",
                    source: file.name,
                  });
                if (await commit(p, "Импортирован файл", file.name)) {
                  setModal(null);
                  notify("Файл добавлен. Проверьте и уточните требования.");
                }
              }
            } catch (e) {
              setError((e as Error).message);
              notify((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {modal === "generate" && (
        <GenerateModal
          project={project}
          initialIds={selected.filter((id) =>
            project.requirements.some((r) => r.id === id),
          )}
          ready={connected && config?.ai_ready}
          busy={busy || saving}
          onClose={() => setModal(null)}
          onSettings={() => {
            setModal(null);
            navigate("settings");
          }}
          onGenerate={async (body) => {
            setSaving(true);
            try {
              await request(connection, `/projects/${active}/generate`, {
                method: "POST",
                body: JSON.stringify(body),
              });
              setJobs(await listJobs(connection, active));
              setModal(null);
              notify("Генерация поставлена в очередь");
            } catch (e) {
              setError((e as Error).message);
              notify((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {modal === "help" && (
        <Modal
          title="От требования к проверке"
          subtitle="QA Atlas · рабочее пространство команды"
          onClose={() => setModal(null)}
        >
          <div className="help-steps">
            {[
              [
                "01",
                "Добавьте требования",
                "Загрузите документ или создайте отдельные требования вручную.",
              ],
              [
                "02",
                "Подготовьте сценарии",
                "Создайте тест-кейсы или подключите сервер и ИИ для генерации.",
              ],
              [
                "03",
                "Проверьте результат",
                "Уточните допущения, отредактируйте сценарий и отправьте на ревью.",
              ],
              [
                "04",
                "Проведите проверку",
                "Зафиксируйте результат ручного прогона. Из ошибки создайте дефект и передайте его на перепроверку.",
              ],
            ].map(([n, t, d]) => (
              <div key={n}>
                <span>{n}</span>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="notice subtle">
            Ctrl+K открывает сквозной поиск. В проектах аккаунта работают роли,
            обсуждения, ручные прогоны и дефекты. Автопрогоны pytest и JavaScript
            доступны через раздел «Автопрогоны» при работающем серверном исполнителе.
          </div>
          <div className="modal-footer">
            <button className="button primary" onClick={() => setModal(null)}>
              Понятно
            </button>
          </div>
        </Modal>
      )}
      {commandOpen && (
        <CommandPalette
          projects={projects}
          active={active}
          onClose={() => setCommandOpen(false)}
          onCase={(pid, id) => {
            setActive(pid);
            setPage("tests");
            setDetail(id);
            setTab("scenario");
          }}
          onRequirement={(pid, r) => {
            setActive(pid);
            setPage("requirements");
            setEditingReq(r);
            setModal("requirement");
          }}
          onNavigate={(p, pid) => {
            if (pid) setActive(pid);
            navigate(p as Page);
          }}
          onCreate={() => {
            setDetail(null);
            setModal("test");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  sub,
  icon,
  onClick,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="metric card" onClick={onClick}>
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </button>
  );
}
function SearchBox({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (s: string) => void;
  inputRef: any;
}) {
  return (
    <div className="search-box">
      <Search size={16} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск по названию или ID"
        aria-label="Поиск"
      />
      <kbd>⌘ K</kbd>
    </div>
  );
}
function CaseEditor({
  initial,
  project,
  saving,
  onClose,
  onSave,
}: {
  initial?: TestCase;
  project: Project;
  saving: boolean;
  onClose: () => void;
  onSave: (t: TestCase) => void;
}) {
  const [links, setLinks] = useState(initial?.requirementIds || []);
  return (
    <Modal
      title={initial ? "Редактировать тест-кейс" : "Новый тест-кейс"}
      subtitle="Изменение содержания возвращает тест в черновик."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const title = String(f.get("title")).trim(),
            gherkin = String(f.get("gherkin")).trim();
          if (!title || !gherkin) return;
          onSave({
            ...initial,
            suite: String(f.get("suite") || "").trim() || undefined,
            labels: String(f.get("labels") || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
              .slice(0, 10),
            id: initial?.id || uid(),
            key: initial?.key || nextKey(project.cases, "TC"),
            title,
            gherkin,
            code: String(f.get("code")),
            artifacts: initial?.artifacts ? {...initial.artifacts, [String(f.get("framework"))]:String(f.get("code"))} : undefined,
            priority: f.get("priority") as Priority,
            type: f.get("type") as TestCase["type"],
            framework: f.get("framework") as TestCase["framework"],
            status: "draft",
            requirementIds: links,
            assumptions: String(f.get("assumptions"))
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
            origin: initial?.origin || "manual",
            updatedAt: new Date().toISOString(),
          });
        }}
      >
        <label>
          Название проверки
          <input
            name="title"
            maxLength={300}
            required
            defaultValue={initial?.title}
          />
        </label>
        <div className="form-grid three">
          <label>
            Тип
            <select name="type" defaultValue={initial?.type || "positive"}>
              {Object.entries(typeLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Приоритет
            <select
              name="priority"
              defaultValue={initial?.priority || "medium"}
            >
              {Object.entries(priorityLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Фреймворк
            <select
              name="framework"
              defaultValue={initial?.framework || "pytest"}
            >
              <option value="pytest">Python · pytest</option>
              <option value="playwright">JS · Playwright</option>
              <option value="junit">Java · JUnit 5</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Набор тестов
            <input
              name="suite"
              maxLength={100}
              defaultValue={initial?.suite}
              placeholder="Авторизация / Регрессия / API"
              list="suite-options"
            />
            <datalist id="suite-options">
              {[
                ...new Set(project.cases.map((c) => c.suite).filter(Boolean)),
              ].map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <label>
            Метки через запятую
            <input
              name="labels"
              maxLength={300}
              defaultValue={initial?.labels?.join(", ")}
              placeholder="smoke, критичный путь"
            />
          </label>
        </div>
        <label>Связанные требования</label>
        <div className="requirement-picker">
          {project.requirements.map((r) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={links.includes(r.id)}
                onChange={(e) =>
                  setLinks(
                    e.target.checked
                      ? [...links, r.id]
                      : links.filter((id) => id !== r.id),
                  )
                }
              />
              <span>
                <span className="mono">{r.key}</span> {r.title}
              </span>
            </label>
          ))}
          {!project.requirements.length && (
            <p className="text-muted">Сначала добавьте требования в проект.</p>
          )}
        </div>
        <label>
          Сценарий Gherkin
          <textarea
            className="mono"
            name="gherkin"
            rows={6}
            maxLength={30000}
            required
            defaultValue={
              initial?.gherkin ||
              "Feature: Название функции\n\n  Scenario: Название проверки\n    Given предусловие\n    When действие\n    Then ожидаемый результат"
            }
          />
        </label>
        <details>
          <summary>Код автотеста</summary>
          <textarea
            aria-label="Код автотеста"
            className="mono"
            name="code"
            rows={7}
            maxLength={60000}
            defaultValue={initial?.code}
          />
        </details>
        <label>
          Нерешённые вопросы и допущения
          <textarea
            name="assumptions"
            rows={2}
            defaultValue={initial?.assumptions.join("\n")}
            placeholder="Каждый вопрос с новой строки. После уточнения перенесите ответ в сценарий и удалите вопрос."
          />
        </label>
        <div className="modal-footer">
          <button className="button" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={saving}>
            Сохранить черновик
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ImportModal({
  connected,
  saving,
  onClose,
  onImport,
}: {
  connected: boolean;
  saving: boolean;
  onClose: () => void;
  onImport: (f: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <Modal
      title="Добавить материалы"
      subtitle="Требования и код остаются связанными с проектом."
      onClose={onClose}
    >
      <label
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setFile(e.dataTransfer.files[0] || null);
        }}
      >
        <Upload size={28} />
        <strong>{file ? file.name : "Перетащите файл или выберите его"}</strong>
        <span>PDF, DOCX, MD, TXT · код PY, JS, TS, JAVA</span>
        <small>До 10 МБ · UTF-8 для текстовых файлов</small>
        <input
          type="file"
          accept=".pdf,.docx,.md,.txt,.py,.js,.ts,.java"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <div className="notice subtle">
        <FileText size={17} />
        <span>
          {connected
            ? "PDF и DOCX обрабатываются в фоне. Импортированные фрагменты нужно проверить и разделить на отдельные требования. OCR сканов пока не подключён."
            : "Локально читаются текст и код. Для PDF и DOCX нужен сервер. Импортированный текст проверьте в разделе «Требования»."}
        </span>
      </div>
      <div className="modal-footer">
        <button className="button" onClick={onClose}>
          Отмена
        </button>
        <button
          className="button primary"
          disabled={!file || saving}
          onClick={() => file && onImport(file)}
        >
          {saving ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Upload size={16} />
          )}
          Добавить в проект
        </button>
      </div>
    </Modal>
  );
}
function GenerateModal({
  project,
  initialIds,
  ready,
  busy,
  onClose,
  onSettings,
  onGenerate,
}: {
  project: Project;
  initialIds: string[];
  ready: boolean;
  busy: boolean;
  onClose: () => void;
  onSettings: () => void;
  onGenerate: (body: any) => void;
}) {
  const [ids, setIds] = useState(
    initialIds.length
      ? initialIds
      : project.requirements.slice(0, 5).map((r) => r.id),
  );
  const [code, setCode] = useState(false);
  const [requirementSearch, setRequirementSearch] = useState("");
  const matches = project.requirements.filter(r =>
    `${r.key} ${r.originalId || ""} ${r.title} ${r.text} ${r.page || ""}`
      .toLocaleLowerCase("ru").includes(requirementSearch.trim().toLocaleLowerCase("ru"))
  );
  return (
    <Modal
      title="Создать проверки с ИИ"
      subtitle="Вы выбираете контекст. ИИ готовит черновики для ревью."
      onClose={onClose}
      wide
    >
      {!ready && (
        <div className="notice warning">
          <Sparkles size={20} />
          <div>
            <strong>Сначала подключите генератор</strong>
            <p>
              Нужны сервер QA Atlas и API-ключ на сервере. В локальном режиме
              ответы модели не подменяются шаблонами.
            </p>
            <button className="text-button" onClick={onSettings}>
              Открыть настройки
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onGenerate({
            requirement_ids: ids,
            framework: f.get("framework"),
            count: Number(f.get("count")),
            include_code: code,
          });
        }}
      >
        <label htmlFor="requirements-search">
          Требования для генерации: {ids.length} выбрано (не больше 20 за один запрос),
          всего {project.requirements.length}
        </label>
        <input
          id="requirements-search"
          type="search"
          placeholder="Поиск по ID, тексту или странице (например, REQ-051)"
          value={requirementSearch}
          onChange={e => setRequirementSearch(e.target.value)}
        />
        <div className="auto-actions">
          <button type="button" className="button" onClick={() =>
            setIds(prev => [...new Set([...prev, ...matches.map(r => r.id)])].slice(0, 20))}>
            Выбрать найденные (до 20)
          </button>
          <button type="button" className="button" onClick={() => setIds([])}>Снять выбор</button>
          <span className="text-muted">Найдено: {matches.length}</span>
        </div>
        <div className="requirement-picker">
          {matches.map((r) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={ids.includes(r.id)}
                disabled={!ids.includes(r.id) && ids.length >= 20}
                onChange={(e) =>
                  setIds(e.target.checked
                    ? [...ids, r.id].slice(0, 20)
                    : ids.filter((x) => x !== r.id))
                }
              />
              <span>
                <span className="mono">{r.key}</span> {r.title}
                {r.page ? ` · стр. ${r.page}` : ""}
                {r.extraction === "review" ? " · требуется ручное выделение" :
                  r.extraction === "heuristic" ? " · проверьте формулировку" : ""}
              </span>
            </label>
          ))}
          {!matches.length && <p>По запросу ничего не найдено.</p>}
        </div>
        {!project.requirements.length && (
          <p>Сначала добавьте хотя бы одно требование.</p>
        )}
        <div className="form-grid">
          <label>
            Целевой фреймворк
            <select name="framework">
              <option value="pytest">Python · pytest</option>
              <option value="playwright">JavaScript · Playwright</option>
              <option value="junit">Java · JUnit 5</option>
            </select>
          </label>
          <label>
            Максимум тест-кейсов
            <input
              name="count"
              type="number"
              min={1}
              max={15}
              defaultValue={6}
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={code}
            disabled={!project.sources.length}
            onChange={(e) => setCode(e.target.checked)}
          />
          <span>
            Добавить код автотестов
            <small>
              {project.sources.length
                ? `Будут переданы ${project.sources.length} исходных файлов. Проверьте допустимость передачи провайдеру.`
                : "Для кода сначала загрузите исходные файлы проекта."}
            </small>
          </span>
        </label>
        <div className="notice subtle">
          <ShieldCheck size={17} />
          <span>
            Генератор учитывает уже созданные сценарии и, если был прогон с покрытием,
            получает непокрытые строки для создания новых проверок. Новые тесты не гарантируют
            рост процента: итог измеряется только настоящим запуском. Черновики проверяйте перед использованием.
          </span>
        </div>
        <div className="modal-footer">
          <button className="button" type="button" onClick={onClose}>
            Отмена
          </button>
          <button
            className="button primary"
            disabled={!ready || busy || !ids.length || ids.length > 20}
          >
            <Sparkles size={16} />
            {busy ? "Задача уже выполняется" : "Начать генерацию"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
