import { useEffect, useRef, useState } from "react";
import {
  Bug,
  Plus,
  RefreshCw,
  Search,
  ArrowUpRight,
  Link2,
  Download,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { cloud, type Team } from "./cloud";
import type { Project } from "./types";
import { priorityLabels } from "./types";
import {
  defectStatuses,
  defectMarkdown,
  type Defect,
  type DefectDraft,
  type DefectStatus,
} from "./quality";
import { downloadText } from "./download";
import { Dialog } from "./Workbench";
const emptyDraft: DefectDraft = {
  title: "",
  severity: "medium",
  actual: "",
  expected: "",
  steps: "",
  environment: "",
};
export function Defects({
  project,
  hosted,
  readOnly,
  draft,
  onDraftConsumed,
  onError,
}: {
  project: Project;
  hosted: boolean;
  readOnly: boolean;
  draft: DefectDraft | null;
  onDraftConsumed: () => void;
  onError: (s: string) => void;
}) {
  const [items, setItems] = useState<Defect[]>([]),
    [team, setTeam] = useState<Team | null>(null),
    [creating, setCreating] = useState<DefectDraft | null>(draft),
    [detail, setDetail] = useState<Defect | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [problem, setProblem] = useState("");
  const loadVersion = useRef(0);
  async function load() {
    const version = ++loadVersion.current;
    setLoading(true);
    setProblem("");
    try {
      const [d, t] = await Promise.all([
        cloud<Defect[]>(`/projects/${project.id}/defects`),
        cloud<Team>(`/projects/${project.id}/team`),
      ]);
      if (version !== loadVersion.current) return;
      setItems(d);
      setTeam(t);
      setDetail((old) => (old ? d.find((x) => x.id === old.id) || null : null));
    } catch (e) {
      if (version === loadVersion.current) setProblem((e as Error).message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setDetail(null);
    if (hosted) void load();
    else setLoading(false);
    return () => { loadVersion.current++; };
  }, [project.id, hosted]);
  useEffect(() => {
    if (draft) {
      setCreating(draft);
      onDraftConsumed();
    }
  }, [draft]);
  function download(d: Defect) {
    downloadText(d.key + ".md", defectMarkdown(d), "text/markdown;charset=utf-8");
  }
  if (!hosted)
    return (
      <section className="card team-empty">
        <Bug size={38} />
        <h2>У каждой ошибки есть история</h2>
        <p>
          Откройте проект аккаунта, чтобы вести дефекты с командой, сохранять
          контекст прогонов и фиксировать перепроверку.
        </p>
      </section>
    );
  const filtered = items.filter(
    (d) =>
      (status === "all" || d.status === status) &&
      `${d.key} ${d.title} ${d.actual}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="defects-workspace">
      <div className="defect-summary">
        {Object.entries(defectStatuses).map(([k, l]) => (
          <button
            className={`defect-stat ${k} ${status === k ? "selected" : ""}`}
            key={k}
            onClick={() => setStatus(status === k ? "all" : k)}
          >
            <span>
              <i />
              {l}
            </span>
            <strong>{items.filter((d) => d.status === k).length}</strong>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      <section className="card defect-table">
        <div className="toolbar">
          <label className="library-search">
            <Search size={16} />
            <input
              aria-label="Поиск дефектов"
              placeholder="Название, номер или описание ошибки…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            className="icon-button"
            aria-label="Обновить дефекты"
            onClick={load}
          >
            <RefreshCw size={16} />
          </button>
          {!readOnly && (
            <button
              className="button primary"
              onClick={() => setCreating(emptyDraft)}
            >
              <Plus size={15} /> Новый дефект
            </button>
          )}
        </div>
        {problem && (
          <div className="error-banner" role="alert">
            {problem}
            <button onClick={load}>Повторить</button>
          </div>
        )}
        {filtered.map((d) => (
          <button
            key={d.id}
            className="defect-row"
            onClick={() => setDetail(d)}
          >
            <span className={`defect-severity ${d.severity}`}>
              <Bug size={18} />
            </span>
            <span className="defect-row-title">
              <small>
                {d.key} · {d.source?.caseKey || "Создан вручную"}
              </small>
              <strong>{d.title}</strong>
              <em>{d.environment || "Окружение не указано"}</em>
            </span>
            <span className={`priority ${d.severity}`}>
              {priorityLabels[d.severity]}
            </span>
            <span className={`defect-status ${d.status}`}>
              {defectStatuses[d.status]}
            </span>
            <ArrowUpRight size={16} />
          </button>
        ))}
        {!filtered.length && !problem && (
          <div className="calm-empty large">
            <Bug size={32} />
            <h3>
              {loading
                ? "Загружаем дефекты…"
                : items.length
                  ? "По фильтрам ничего не найдено"
                  : "Ошибки не потеряются в переписке"}
            </h3>
            <p>
              {items.length
                ? "Измените статус или поисковый запрос."
                : "Создайте дефект вручную или из неуспешного ручного прогона. Шаги и окружение будут связаны с результатом проверки."}
            </p>
            {items.length > 0 && (
              <button
                className="button"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        )}
        <div className="table-footer">
          {filtered.length} из {items.length} дефектов
          <span>Сначала исправление, затем перепроверка</span>
        </div>
      </section>
      {creating && (
        <Dialog
          title="Новый дефект"
          subtitle={
            creating.sourceRunId
              ? "Контекст сохранённой проверки будет прикреплён автоматически."
              : "Опишите ошибку так, чтобы её можно было воспроизвести."
          }
          wide
          onClose={() => {
            if (!busy) {
              setCreating(null);
              setProblem("");
            }
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setProblem("");
              const f = new FormData(e.currentTarget);
              try {
                const d = await cloud<Defect>(
                  `/projects/${project.id}/defects`,
                  "POST",
                  {
                    ...creating,
                    title: f.get("title"),
                    severity: f.get("severity"),
                    actual: f.get("actual"),
                    expected: f.get("expected"),
                    steps: f.get("steps"),
                    environment: f.get("environment"),
                  },
                );
                await load();
                setCreating(null);
                setDetail(d);
              } catch (e) {
                setProblem((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {problem && (
              <div className="error-banner" role="alert">
                {problem}
              </div>
            )}
            <label>
              Краткое название
              <input
                name="title"
                required
                minLength={3}
                maxLength={300}
                defaultValue={creating.title}
                placeholder="Что работает неправильно?"
              />
            </label>
            <div className="form-grid">
              <label>
                Приоритет
                <select name="severity" defaultValue={creating.severity}>
                  {Object.entries(priorityLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Окружение
                <input
                  name="environment"
                  maxLength={300}
                  defaultValue={creating.environment}
                  placeholder="Staging · Chrome 131 · Windows"
                />
              </label>
            </div>
            <label>
              Шаги воспроизведения
              <textarea
                name="steps"
                rows={4}
                defaultValue={creating.steps}
                maxLength={50000}
              />
            </label>
            <div className="form-grid">
              <label>
                Ожидалось
                <textarea
                  name="expected"
                  rows={4}
                  defaultValue={creating.expected}
                  maxLength={10000}
                />
              </label>
              <label>
                Получилось
                <textarea
                  name="actual"
                  rows={4}
                  required
                  defaultValue={creating.actual}
                  maxLength={10000}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setCreating(null)}
                disabled={busy}
              >
                Отмена
              </button>
              <button className="button primary" disabled={busy}>
                <Bug size={15} /> Зарегистрировать
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {detail && (
        <Dialog
          title={`${detail.key} · ${detail.title}`}
          subtitle={`Зарегистрировал ${detail.author}`}
          wide
          onClose={() => {
            if (!busy) {
              setDetail(null);
              setProblem("");
            }
          }}
        >
          <div className="defect-detail">
            {detail.source && (
              <div className="defect-source">
                <Link2 size={17} />
                <div>
                  <strong>
                    {detail.source.runName} / {detail.source.caseKey}
                  </strong>
                  <p>
                    {detail.source.environment} · снимок результата v
                    {detail.source.runRevision}
                  </p>
                </div>
                <span className="mini-label">
                  {detail.source.outcome === "failed" ? "Ошибка" : "Блокировка"}
                </span>
              </div>
            )}
            <div className="defect-evidence">
              <section>
                <h4>Шаги воспроизведения</h4>
                <pre>
                  {detail.steps || detail.source?.gherkin || "Не указаны"}
                </pre>
              </section>
              <div className="form-grid">
                <section>
                  <h4>Ожидалось</h4>
                  <p>{detail.expected || "См. сценарий"}</p>
                </section>
                <section>
                  <h4>Получилось</h4>
                  <p>{detail.actual}</p>
                </section>
              </div>
            </div>
            <form
              key={detail.id + "-" + detail.revision}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setProblem("");
                const f = new FormData(e.currentTarget);
                try {
                  const saved = await cloud<Defect>(
                    `/projects/${project.id}/defects/${detail.id}`,
                    "PATCH",
                    {
                      revision: detail.revision,
                      status: f.get("status"),
                      severity: f.get("severity"),
                      assigneeId: f.get("assignee") || null,
                      resolution: f.get("resolution"),
                    },
                  );
                  setDetail(saved);
                  setItems((prev) =>
                    prev.map((d) => (d.id === saved.id ? saved : d)),
                  );
                } catch (e) {
                  setProblem((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {problem && (
                <div className="error-banner" role="alert">
                  {problem}
                  <button type="button" onClick={load}>
                    Обновить
                  </button>
                </div>
              )}
              <div className="form-grid three">
                <label>
                  Статус
                  <select
                    name="status"
                    defaultValue={detail.status}
                    disabled={readOnly || busy}
                  >
                    {Object.entries(defectStatuses).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Приоритет
                  <select
                    name="severity"
                    defaultValue={detail.severity}
                    disabled={readOnly || busy}
                  >
                    {Object.entries(priorityLabels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ответственный
                  <select
                    name="assignee"
                    defaultValue={detail.assigneeId || ""}
                    disabled={readOnly || busy}
                  >
                    <option value="">Не назначен</option>
                    {team?.members
                      .filter((m) => m.role !== "viewer")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label>
                Исправление / результат перепроверки
                <textarea
                  name="resolution"
                  defaultValue={detail.resolution}
                  rows={3}
                  maxLength={10000}
                  disabled={readOnly || busy}
                  placeholder="Что исправлено? На каком окружении проверено повторно?"
                />
              </label>
              <p className="text-muted">
                Для статусов «На перепроверке» и «Закрыт» требуется описание
                результата.
              </p>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button"
                  onClick={() => download(detail)}
                >
                  <Download size={15} /> Markdown
                </button>
                {!readOnly && (
                  <button className="button primary" disabled={busy}>
                    <CheckCircle2 size={15} /> Сохранить изменения
                  </button>
                )}
              </div>
            </form>
            <details className="defect-history">
              <summary>История дефекта · {detail.history.length}</summary>
              {detail.history
                .slice()
                .reverse()
                .map((h, i) => (
                  <article key={i}>
                    <Clock size={13} />
                    <div>
                      <strong>
                        {defectStatuses[h.status]} · {h.author}
                      </strong>
                      <p>{h.message}</p>
                      <small>{new Date(h.at).toLocaleString("ru-RU")}</small>
                    </div>
                  </article>
                ))}
            </details>
          </div>
        </Dialog>
      )}
    </div>
  );
}
