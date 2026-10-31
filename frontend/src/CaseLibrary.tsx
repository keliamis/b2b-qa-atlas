import { useEffect, useState, type ReactNode } from "react";
import {
  Search,
  Plus,
  Bookmark,
  SlidersHorizontal,
  ArrowDownWideNarrow,
  Star,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  Layers,
  Check,
} from "lucide-react";
import type { Project, TestCase } from "./types";
import { priorityLabels, typeLabels, statusLabels } from "./types";
import { cloud, type Session } from "./cloud";
import {
  filterCases,
  defaultFilters,
  type CaseFilters,
  type SavedView,
} from "./quality";
export function CaseLibrary({
  project,
  session,
  hosted,
  readOnly,
  favorites,
  initialStatus,
  selected,
  clearSelection,
  renderTable,
  onCreate,
  onCommit,
  onError,
  onExport,
}: {
  project: Project;
  session: Session | null;
  hosted: boolean;
  readOnly: boolean;
  favorites: string[];
  initialStatus: string;
  selected: string[];
  clearSelection: () => void;
  renderTable: (cases: TestCase[]) => ReactNode;
  onCreate: () => void;
  onCommit: (p: Project, action: string, target: string) => Promise<boolean>;
  onError: (s: string) => void;
  onExport: () => void;
}) {
  const [filters, setFilters] = useState<CaseFilters>({
      ...defaultFilters,
      status: initialStatus,
    }),
    [views, setViews] = useState<SavedView[]>([]),
    [savingView, setSavingView] = useState(false),
    [viewName, setViewName] = useState(""),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [bulkPriority, setBulkPriority] = useState(""),
    [bulkSuite, setBulkSuite] = useState(""),
    [compact, setCompact] = useState(
      () => localStorage.getItem("qa-atlas-density") === "compact",
    );
  const key = `qa-atlas-views-${project.id}`;
  useEffect(() => {
    setFilters({ ...defaultFilters, status: initialStatus });
    setPage(1);
    setViews([]);
    if (hosted)
      cloud<SavedView[]>(`/projects/${project.id}/views`)
        .then(setViews)
        .catch((e) => onError(e.message));
    else {
      try {
        setViews(JSON.parse(localStorage.getItem(key) || "[]"));
      } catch {}
    }
  }, [project.id, hosted]);
  function change(patch: Partial<CaseFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
    clearSelection();
  }
  const suites = [
    ...new Set(project.cases.map((c) => c.suite || "Без набора")),
  ].sort();
  const filtered = filterCases(project.cases, filters, session?.id, favorites);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  async function saveView() {
    if (!viewName.trim()) return;
    setBusy(true);
    try {
      if (views.length >= 30)
        throw new Error("Можно сохранить до 30 представлений");
      const v = hosted
        ? await cloud<SavedView>(`/projects/${project.id}/views`, "POST", {
            name: viewName,
            filters,
          })
        : { id: crypto.randomUUID(), name: viewName.trim(), filters };
      const next = [...views, v];
      if (!hosted) localStorage.setItem(key, JSON.stringify(next));
      setViews(next);
      setSavingView(false);
      setViewName("");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeView(id: string) {
    try {
      if (hosted) await cloud(`/projects/${project.id}/views/${id}`, "DELETE");
      const next = views.filter((v) => v.id !== id);
      if (!hosted) localStorage.setItem(key, JSON.stringify(next));
      setViews(next);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function removeCases(all: boolean) {
    if (busy || readOnly) return;
    const ids = all ? project.cases.map((c) => c.id) : selected.filter((id) => project.cases.some((c) => c.id === id));
    if (!ids.length) return;
    const text = all
      ? `Удалить ВСЕ ${ids.length} тест-кейсов проекта «${project.name}»? Требования и исходники сохранятся. Действие нельзя отменить.`
      : `Удалить выбранные тест-кейсы (${ids.length})? Действие нельзя отменить.`;
    if (!window.confirm(text)) return;
    setBusy(true);
    try {
      const p = structuredClone(project);
      const removing = new Set(ids);
      p.cases = p.cases.filter((c) => !removing.has(c.id));
      if (await onCommit(p, "Удалены тест-кейсы", `${ids.length} тест-кейсов`)) clearSelection();
    } finally { setBusy(false); }
  }
  async function bulk(kind: "review" | "priority" | "suite") {
    if (
      (kind === "priority" && !bulkPriority) ||
      (kind === "suite" && !bulkSuite.trim())
    )
      return;
    setBusy(true);
    const p = structuredClone(project);
    p.cases.forEach((t) => {
      if (selected.includes(t.id)) {
        if (kind === "review") t.status = "review";
        if (kind === "priority")
          t.priority = bulkPriority as TestCase["priority"];
        if (kind === "suite") t.suite = bulkSuite.trim();
        t.updatedAt = new Date().toISOString();
      }
    });
    if (
      await onCommit(
        p,
        "Массовое изменение тестов",
        `${kind}: ${selected.length}`,
      )
    )
      clearSelection();
    setBusy(false);
  }
  return (
    <div className={`case-library ${compact ? "compact" : ""}`}>
      <div className="saved-view-bar">
        <span>
          <Bookmark size={14} /> Представления
        </span>
        <button
          className="saved-view default"
          onClick={() => {
            setFilters(defaultFilters);
            setPage(1);
            clearSelection();
          }}
        >
          Все тесты
        </button>
        {views.map((v) => (
          <span className="saved-view" key={v.id}>
            <button
              onClick={() => {
                setFilters({ ...defaultFilters, ...v.filters });
                setPage(1);
                clearSelection();
              }}
            >
              {v.name}
            </button>
            <button
              aria-label={`Удалить представление ${v.name}`}
              onClick={() => removeView(v.id)}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <button
          className="save-view-button"
          onClick={() => setSavingView(!savingView)}
        >
          <Plus size={13} /> Сохранить фильтры
        </button>
      </div>
      {savingView && (
        <form
          className="save-view-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveView();
          }}
        >
          <Bookmark size={16} />
          <input
            aria-label="Название представления"
            placeholder="Например, критичные сценарии на ревью"
            value={viewName}
            maxLength={60}
            onChange={(e) => setViewName(e.target.value)}
            required
          />
          <span>Видно только вам</span>
          <button className="button primary" disabled={busy}>
            Сохранить
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Отменить сохранение фильтра"
            onClick={() => setSavingView(false)}
          >
            <X size={16} />
          </button>
        </form>
      )}
      <section className="card library-table">
        <div className="toolbar">
          <div className="tabs">
            {[
              ["all", "Все"],
              ["review", "На ревью"],
              ["approved", "Утверждены"],
              ["draft", "Черновики"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={filters.status === v ? "selected" : ""}
                onClick={() => change({ status: v })}
              >
                {l}
                <span>
                  {v === "all"
                    ? project.cases.length
                    : project.cases.filter((c) => c.status === v).length}
                </span>
              </button>
            ))}
          </div>
          <button
            className="button primary"
            onClick={onCreate}
            disabled={readOnly}
          >
            <Plus size={15} /> Новый тест
          </button>
        </div>
        <div className="library-search-row">
          <label className="library-search">
            <Search size={16} />
            <input
              aria-label="Поиск тест-кейсов"
              value={filters.query}
              placeholder="Найти по названию, шагам или метке…"
              onChange={(e) => change({ query: e.target.value })}
            />
            {filters.query && (
              <button
                className="icon-button"
                aria-label="Очистить поиск тестов"
                onClick={() => change({ query: "" })}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <button
            className={`button ${filters.favorites ? "active-filter" : ""}`}
            onClick={() => change({ favorites: !filters.favorites })}
            aria-pressed={filters.favorites}
          >
            <Star size={15} /> Избранные
          </button>
          <button className="button" onClick={onExport}>
            <Download size={15} /> Экспорт
          </button>
          <button className="button danger-action" disabled={readOnly || busy || !project.cases.length} onClick={() => void removeCases(true)} aria-label="Удалить все тест-кейсы проекта">
            <Trash2 size={15} /> Удалить все тесты
          </button>
        </div>
        <div className="library-filters">
          <span>
            <SlidersHorizontal size={14} /> Фильтры
          </span>
          <select
            aria-label="Приоритет тестов"
            value={filters.priority}
            onChange={(e) => change({ priority: e.target.value })}
          >
            <option value="all">Все приоритеты</option>
            {Object.entries(priorityLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            aria-label="Тип проверки"
            value={filters.type}
            onChange={(e) => change({ type: e.target.value })}
          >
            <option value="all">Все типы</option>
            {Object.entries(typeLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            aria-label="Назначение тестов"
            value={filters.assignment}
            onChange={(e) => change({ assignment: e.target.value })}
          >
            <option value="all">Все участники</option>
            <option value="mine" disabled={!session}>
              Назначенные мне
            </option>
            <option value="unassigned">Без ответственного</option>
          </select>
          <select
            aria-label="Набор тестов"
            value={filters.suite}
            onChange={(e) => change({ suite: e.target.value })}
          >
            <option value="all">Все наборы</option>
            {suites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            className="text-button"
            onClick={() => change(defaultFilters)}
          >
            Сбросить
          </button>
        </div>
        {selected.length > 0 && (
          <div className="bulk-toolbar">
            <strong>
              <Check size={15} /> {selected.length} выбрано
            </strong>
            <button
              className="button"
              disabled={busy || readOnly}
              onClick={() => bulk("review")}
            >
              На ревью
            </button>
            <select
              aria-label="Массовый приоритет"
              value={bulkPriority}
              onChange={(e) => setBulkPriority(e.target.value)}
            >
              <option value="">Приоритет…</option>
              {Object.entries(priorityLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button
              className="text-button"
              disabled={busy || readOnly || !bulkPriority}
              onClick={() => bulk("priority")}
            >
              Применить
            </button>
            <input
              aria-label="Массовый набор"
              value={bulkSuite}
              onChange={(e) => setBulkSuite(e.target.value)}
              maxLength={100}
              placeholder="В набор…"
            />
            <button
              className="text-button"
              disabled={busy || readOnly || !bulkSuite.trim()}
              onClick={() => bulk("suite")}
            >
              <Layers size={14} /> Переместить
            </button>
            <button className="button danger-action" disabled={busy || readOnly} onClick={() => void removeCases(false)}>
              <Trash2 size={14}/> Удалить выбранные
            </button>
            <button
              className="icon-button"
              aria-label="Снять выбор тестов"
              onClick={clearSelection}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {renderTable(shown)}
        <div className="library-footer">
          <span>
            {filtered.length
              ? `${(currentPage - 1) * 50 + 1}–${Math.min(currentPage * 50, filtered.length)}`
              : "0"}{" "}
            из {filtered.length} тестов
          </span>
          <select
            aria-label="Сортировка тестов"
            value={filters.sort}
            onChange={(e) => change({ sort: e.target.value })}
          >
            <option value="priority">По приоритету</option>
            <option value="updated">По обновлению</option>
            <option value="title">По названию</option>
            <option value="due">По сроку</option>
          </select>
          <button
            className="density-toggle"
            aria-pressed={compact}
            onClick={() => {
              setCompact(!compact);
              localStorage.setItem(
                "qa-atlas-density",
                !compact ? "compact" : "comfortable",
              );
            }}
          >
            Компактно
          </button>
          <button
            className="icon-button"
            aria-label="Предыдущая страница тестов"
            disabled={currentPage === 1}
            onClick={() => {
              setPage(currentPage - 1);
              clearSelection();
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {currentPage}/{pageCount}
          </span>
          <button
            className="icon-button"
            aria-label="Следующая страница тестов"
            disabled={currentPage === pageCount}
            onClick={() => {
              setPage(currentPage + 1);
              clearSelection();
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
