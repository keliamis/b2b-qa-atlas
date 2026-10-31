import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCircle2,
  Search,
  Command,
  FileText,
  ListChecks,
  Plus,
  Clock,
  Inbox,
  AlertTriangle,
  Target,
  Network,
  Layers,
  Play,
  Bug,
  X,
  CornerDownLeft,
  ShieldCheck,
  Sun,
  Moon,
  Users,
  ArrowDown,
  Activity,
} from "lucide-react";
import type { Project, Requirement, TestCase } from "./types";
import { statusLabels, priorityLabels } from "./types";
import { getAttention, priorityRank } from "./quality";
import { cloud, type Session, type ManualRun } from "./cloud";
export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const els = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
          ) || [],
        ).filter((x) => !x.hidden);
        if (!els.length) {
          e.preventDefault();
          return;
        }
        const i = els.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && (i === els.length - 1 || i === -1)) {
          e.preventDefault();
          els[0].focus();
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      previous?.focus();
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
        className={`modal premium-dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function CommandPalette({
  projects,
  active,
  onCase,
  onRequirement,
  onNavigate,
  onCreate,
  onClose,
}: {
  projects: Project[];
  active: string;
  onCase: (pid: string, id: string) => void;
  onRequirement: (pid: string, r: Requirement) => void;
  onNavigate: (page: string, pid?: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim().toLocaleLowerCase("ru");
  const commands = [
    {
      id: "new",
      label: "Создать тест-кейс",
      type: "Быстрое действие",
      icon: Plus,
      action: onCreate,
    },
    ...(
      [
        ["overview", "Обзор проекта"],
        ["mywork", "Моя работа"],
        ["tests", "Библиотека тест-кейсов"],
        ["runs", "Ручные прогоны"],
        ["defects", "Дефекты"],
        ["analytics", "Аналитика"],
        ["team", "Команда"],
        ["settings", "Настройки"],
      ] as const
    ).map(([id, label]) => ({
      id: "page-" + id,
      label,
      type: "Перейти",
      icon: ArrowRight,
      action: () => onNavigate(id),
    })),
  ];
  const entities = projects.flatMap((p) => [
    ...p.cases.map((t) => ({
      id: `${p.id}-${t.id}`,
      label: `${t.key} · ${t.title}`,
      type: p.name,
      icon: ListChecks,
      action: () => onCase(p.id, t.id),
    })),
    ...p.requirements.map((r) => ({
      id: `${p.id}-${r.id}`,
      label: `${r.key} · ${r.title}`,
      type: p.name,
      icon: FileText,
      action: () => onRequirement(p.id, r),
    })),
  ]);
  const rows = (
    q
      ? [...commands, ...entities].filter((r) =>
          `${r.label} ${r.type}`.toLocaleLowerCase("ru").includes(q),
        )
      : commands
  ).slice(0, 40);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => setIndex(0), [query]);
  function execute(i: number) {
    const row = rows[i];
    if (row) {
      onClose();
      row.action();
    }
  }
  return (
    <Dialog
      title="Быстрый поиск"
      subtitle="Тест-кейсы, требования и действия во всех открытых проектах"
      onClose={onClose}
    >
      <div className="command-input">
        <Search size={20} />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => (i + 1) % Math.max(rows.length, 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => (i - 1 + rows.length) % Math.max(rows.length, 1));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              execute(index);
            }
          }}
          placeholder="Что нужно найти?"
          aria-label="Сквозной поиск"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={rows[index] ? `command-${index}` : undefined}
        />
        <kbd>esc</kbd>
      </div>
      <div
        className="command-results"
        id="command-results"
        role="listbox"
        aria-label="Результаты поиска"
      >
        {rows.map((r, i) => (
          <button
            key={r.id}
            id={`command-${i}`}
            role="option"
            aria-selected={index === i}
            className={index === i ? "selected" : ""}
            onMouseEnter={() => setIndex(i)}
            onClick={() => execute(i)}
          >
            <r.icon size={17} />
            <span>
              <strong>{r.label}</strong>
              <small>{r.type}</small>
            </span>
            {index === i && <CornerDownLeft size={15} />}
          </button>
        ))}
        {!rows.length && (
          <div className="command-empty">
            <Search size={26} />
            <strong>Ничего не найдено</strong>
            <p>Попробуйте номер теста или часть названия.</p>
          </div>
        )}
      </div>
      <div className="command-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> выбрать
        </span>
        <span>
          <kbd>↵</kbd> открыть
        </span>
        <span>До 40 результатов</span>
      </div>
    </Dialog>
  );
}
export function WelcomeGate({
  onDemo,
  signInUrl,
}: {
  onDemo: () => void;
  signInUrl: string;
}) {
  return (
    <div className="welcome-gate">
      <header>
        <a className="brand" href="/">
          <span className="brand-symbol">
            <Network size={22} />
          </span>
          <span>
            qa<span className="brand-light">atlas</span>
          </span>
        </a>
        <span className="welcome-version">QUALITY WORKSPACE · 0.4</span>
        <a className="button" href={signInUrl} target="_top">
          Войти <ArrowUpRight size={15} />
        </a>
      </header>
      <main className="welcome-main">
        <section className="welcome-copy">
          <div className="welcome-eyebrow">
            <span /> ДЛЯ ТЕХ, КТО ОТВЕЧАЕТ ЗА КАЧЕСТВО
          </div>
          <h1>
            Хорошие релизы
            <br />
            <em>Начинаются здесь</em>
          </h1>
          <p>
            Требования, тесты, команда и найденные ошибки.
            <br />В одном пространстве, где у каждой проверки есть контекст.
          </p>
          <div className="welcome-actions">
            <a className="button primary" href={signInUrl} target="_top">
              Войти по почте <ArrowRight size={17} />
            </a>
            <button className="button" onClick={onDemo}>
              <Play size={16} /> Открыть демо
            </button>
          </div>
          <div className="welcome-note">
            <ShieldCheck size={15} /> Ваши проекты доступны только вам и
            приглашённой команде.
          </div>
          <div className="welcome-feature-list">
            <div>
              <Layers size={18} />
              <strong>От требования до дефекта</strong>
              <span>Сохраняйте связь на каждом шаге</span>
            </div>
            <div>
              <Users size={18} />
              <strong>Общий контекст</strong>
              <span>Назначения, ревью и обсуждения</span>
            </div>
            <div>
              <Command size={18} />
              <strong>Меньше переключений</strong>
              <span>Поиск, фильтры и личная очередь</span>
            </div>
          </div>
        </section>
        <section
          className="welcome-visual"
          aria-label="Иллюстрация рабочего процесса"
        >
          <div className="preview-orbit orbit-one" />
          <div className="preview-orbit orbit-two" />
          <div className="preview-shell">
            <div className="preview-top">
              <span />
              <span />
              <span />
              <b>QA Atlas / пример процесса</b>
            </div>
            <div className="preview-body">
              <span className="section-kicker">QUALITY OVERVIEW</span>
              <h2>
                Весь контекст.
                <br />
                Одно пространство.
              </h2>
              <div className="preview-flow">
                <div>
                  <FileText size={18} />
                  <span>
                    Требование<small>Ожидаемое поведение</small>
                  </span>
                  <CheckCircle2 size={16} />
                </div>
                <i />
                <div>
                  <ListChecks size={18} />
                  <span>
                    Тест-кейс<small>Сценарий и ревью</small>
                  </span>
                  <CheckCircle2 size={16} />
                </div>
                <i />
                <div>
                  <Play size={18} />
                  <span>
                    Ручная проверка<small>Результат и окружение</small>
                  </span>
                  <ArrowRight size={16} />
                </div>
                <i />
                <div>
                  <Bug size={18} />
                  <span>
                    Дефект<small>От ошибки до перепроверки</small>
                  </span>
                  <ArrowRight size={16} />
                </div>
              </div>
            </div>
          </div>
          <div className="floating-context">
            <Network size={20} />
            <div>
              <strong>Ничего не теряется</strong>
              <span>Требование → тест → прогон → дефект</span>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <span>QA Atlas · Рабочее пространство тестировщика</span>
        <span>Демо хранит изменения только в вашем браузере</span>
      </footer>
    </div>
  );
}
export function Cockpit({
  project,
  session,
  hosted,
  onNavigate,
  onCase,
  onRequirement,
  onCreate,
}: {
  project: Project;
  session: Session | null;
  hosted: boolean;
  onNavigate: (page: string) => void;
  onCase: (id: string) => void;
  onRequirement: (r: Requirement) => void;
  onCreate: () => void;
}) {
  const attention = getAttention(project, session?.id);
  const important = attention.uncovered.filter(
    (r) => priorityRank[r.priority] < 2,
  );
  const approved = project.cases.filter((c) => c.status === "approved").length;
  const covered = project.requirements.length - attention.uncovered.length;
  const ratio = project.cases.length
    ? Math.round((approved / project.cases.length) * 100)
    : 0;
  const tasks = [
    ...attention.overdue,
    ...attention.review,
    ...attention.questions,
  ]
    .filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i)
    .slice(0, 4);
  const [runs, setRuns] = useState<ManualRun[]>([]),
    [runError, setRunError] = useState(false);
  useEffect(() => {
    let alive = true;
    setRuns([]);
    setRunError(false);
    if (hosted)
      cloud<ManualRun[]>(`/projects/${project.id}/runs`)
        .then((r) => {
          if (alive) setRuns(r);
        })
        .catch(() => {
          if (alive) setRunError(true);
        });
    return () => {
      alive = false;
    };
  }, [project.id, hosted]);
  const focusTitle = important.length
    ? `${important.length} важных требований без проверок`
    : attention.review.length
      ? `${attention.review.length} сценариев ждут вашего ревью`
      : project.cases.length
        ? "Дайте сценариям реальную проверку"
        : "Начнём с первой проверки";
  return (
    <div className="quality-cockpit">
      <div className="cockpit-heading">
        <div>
          <div className="section-kicker">
            <span className="tiny-orbit" /> PROJECT OVERVIEW
          </div>
          <h1>
            {project.name.replace(" · пример", "")}
            <span className="project-heading-dot">.</span>
          </h1>
          <p>Контекст, риски и следующий шаг — всё перед глазами.</p>
        </div>
        <div className="cockpit-heading-actions">
          <span className="project-stage">
            <span />
            {project.name.includes("пример")
              ? "Учебный проект"
              : "Рабочий проект"}
          </span>
          <button
            className="button primary"
            onClick={onCreate}
            disabled={project.role === "viewer"}
          >
            <Plus size={15} /> Новый тест
          </button>
        </div>
      </div>
      <div className="cockpit-hero-grid">
        <section className="focus-surface">
          <div className="focus-surface-copy">
            <span className="section-kicker">
              <Target size={14} /> В ФОКУСЕ СЕЙЧАС
            </span>
            <h2>{focusTitle}</h2>
            <p>
              {important.length
                ? "Сначала закройте пробелы в критичных и важных сценариях."
                : attention.review.length
                  ? "Проверьте ожидания и допущения, прежде чем переходить к прогону."
                  : "Подготовьте набор, выполните шаги и сохраните наблюдения команды."}
            </p>
            <button
              className="button primary"
              onClick={() =>
                important.length
                  ? onRequirement(important[0])
                  : onNavigate(attention.review.length ? "board" : "runs")
              }
            >
              {important.length
                ? "Разобрать требование"
                : attention.review.length
                  ? "Открыть ревью"
                  : "К прогонам"}
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="requirement-constellation">
            <div className="constellation-label">
              КАРТА ТРЕБОВАНИЙ{" "}
              <span>
                {covered}/{project.requirements.length}
              </span>
            </div>
            <div className="constellation-grid">
              {project.requirements.slice(0, 20).map((r) => {
                const has = project.cases.some((c) =>
                  c.requirementIds.includes(r.id),
                );
                return (
                  <button
                    key={r.id}
                    className={has ? "linked" : "gap"}
                    title={`${r.key}: ${r.title} — ${has ? "есть тесты" : "без тестов"}`}
                    onClick={() => onRequirement(r)}
                  >
                    {has ? <Check size={15} /> : <Plus size={15} />}
                    <span>{r.key.replace("REQ-", "")}</span>
                  </button>
                );
              })}
              {!project.requirements.length && (
                <div className="constellation-empty">
                  <FileText size={30} />
                  <span>Добавьте требования</span>
                </div>
              )}
            </div>
            <div className="constellation-foot">
              <span>
                <i /> Есть тесты
              </span>
              <span>
                <i /> Нужна проверка
              </span>
            </div>
            {project.requirements.length > 20 && (
              <small>Обзор первых 20 · все требования доступны в разделе требований и при поиске в генераторе</small>
            )}
          </div>
        </section>
        <section className="readiness-orbit card">
          <div className="section-title">
            <h3>Готовность сценариев</h3>
            <span className="mini-label">Ревью</span>
          </div>
          <div className="orbit-chart">
            <svg
              viewBox="0 0 180 180"
              role="img"
              aria-label={`Утверждено ${approved} из ${project.cases.length} тест-кейсов`}
            >
              <circle
                cx="90"
                cy="90"
                r="69"
                stroke="var(--surface-alt)"
                strokeWidth="13"
                fill="none"
              />
              <circle
                cx="90"
                cy="90"
                r="69"
                stroke="var(--signal)"
                strokeWidth="13"
                fill="none"
                strokeDasharray={`${(ratio / 100) * 433.54} 433.54`}
                strokeLinecap={ratio ? "round" : "butt"}
                transform="rotate(-90 90 90)"
              />
            </svg>
            <div>
              <strong>
                {ratio}
                <span>%</span>
              </strong>
              <small>утверждено</small>
            </div>
          </div>
          <div className="orbit-summary">
            <span>
              <i />
              {approved} готово к проверке
            </span>
            <span>{project.cases.length - approved} в работе</span>
          </div>
          <p>Ревью сценариев · не результат выполнения</p>
        </section>
      </div>
      <div className="cockpit-metrics">
        {[
          {
            label: "Требования",
            value: project.requirements.length,
            sub: `${attention.uncovered.length} без тестов`,
            icon: FileText,
            page: "requirements",
            tone: "violet",
          },
          {
            label: "Тест-кейсы",
            value: project.cases.length,
            sub: `${project.cases.filter((c) => c.type === "boundary").length} граничных сценария`,
            icon: ListChecks,
            page: "tests",
            tone: "cyan",
          },
          {
            label: "На ревью",
            value: attention.review.length,
            sub: "Ожидают решения команды",
            icon: CheckCircle2,
            page: "board",
            tone: "amber",
          },
          {
            label: "Просрочено",
            value: attention.overdue.length,
            sub: "Срок прошёл, ревью не завершено",
            icon: Clock,
            page: "mywork",
            tone: "rose",
          },
        ].map((m) => (
          <button
            key={m.label}
            className={`cockpit-metric ${m.tone}`}
            onClick={() => onNavigate(m.page)}
          >
            <div>
              <span>{m.label}</span>
              <m.icon size={17} />
            </div>
            <strong>{m.value}</strong>
            <small>
              {m.sub}
              <ArrowUpRight size={12} />
            </small>
          </button>
        ))}
      </div>
      <div className="cockpit-detail-grid">
        <section className="card attention-card">
          <div className="section-title padded">
            <div>
              <span className="section-kicker">NEXT UP</span>
              <h3>Требует внимания</h3>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate("mywork")}
            >
              Моя работа <ArrowUpRight size={14} />
            </button>
          </div>
          {tasks.map((t) => (
            <button
              className="attention-item"
              key={t.id}
              onClick={() => onCase(t.id)}
            >
              <span
                className={`attention-icon ${attention.overdue.some((c) => c.id === t.id) ? "rose" : "violet"}`}
              >
                {attention.overdue.some((c) => c.id === t.id) ? (
                  <Clock size={17} />
                ) : (
                  <ListChecks size={17} />
                )}
              </span>
              <span>
                <small>
                  {t.key} · {priorityLabels[t.priority]}
                </small>
                <strong>{t.title}</strong>
              </span>
              <span className={`badge ${t.status}`}>
                {statusLabels[t.status]}
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
          {!tasks.length && (
            <div className="calm-empty">
              <CheckCircle2 size={27} />
              <strong>Очередь свободна</strong>
              <p>Проверьте полноту требований или начните новый прогон.</p>
            </div>
          )}
          <div className="attention-footer">
            <Inbox size={14} />
            {attention.unassigned.length} сценариев ещё без ответственного
          </div>
        </section>
        <section className="card coverage-matrix">
          <div className="section-title padded">
            <div>
              <span className="section-kicker">TEST DESIGN</span>
              <h3>Глубина проверок</h3>
            </div>
            <button
              className="icon-button"
              aria-label="Открыть связи требований"
              onClick={() => onNavigate("trace")}
            >
              <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="matrix-labels">
            <span>Требование</span>
            <span>Позитив.</span>
            <span>Негатив.</span>
            <span>Граница</span>
          </div>
          {project.requirements.slice(0, 5).map((r) => (
            <button
              className="matrix-row"
              key={r.id}
              onClick={() => onRequirement(r)}
            >
              <span>
                <strong>{r.key}</strong>
                <small>{r.title}</small>
              </span>
              {(["positive", "negative", "boundary"] as const).map((type) => {
                const n = project.cases.filter(
                  (c) => c.type === type && c.requirementIds.includes(r.id),
                ).length;
                return (
                  <span key={type}>
                    <i className={n ? "has-check" : ""}>{n || "—"}</i>
                  </span>
                );
              })}
            </button>
          ))}
          {!project.requirements.length && (
            <p className="padded text-muted">
              Свяжите тест-кейсы с требованиями.
            </p>
          )}
          <p className="matrix-note">
            Количество связанных сценариев каждого типа. Не все типы обязательны
            для каждого требования.
          </p>
        </section>
      </div>
      <div className="cockpit-bottom">
        <section className="card recent-runs">
          <div className="section-title padded">
            <h3>Последние ручные прогоны</h3>
            <button className="text-button" onClick={() => onNavigate("runs")}>
              Все прогоны <ArrowRight size={14} />
            </button>
          </div>
          {runs.slice(0, 3).map((r) => {
            const done = r.results.filter(
              (x) => x.outcome !== "untested",
            ).length;
            return (
              <button
                key={r.id}
                className="recent-run"
                onClick={() => onNavigate("runs")}
              >
                <Play size={17} />
                <span>
                  <strong>{r.name}</strong>
                  <small>{r.environment}</small>
                </span>
                <div className="mini-run-bar">
                  {r.results.map((x, i) => (
                    <i key={i} className={x.outcome} />
                  ))}
                </div>
                <small>
                  {done}/{r.results.length}
                </small>
              </button>
            );
          })}
          {!runs.length && (
            <div className="compact-empty">
              <Play size={20} />
              <span>
                {runError
                  ? "Не удалось загрузить прогоны. Откройте раздел и повторите."
                  : hosted
                    ? "Первый прогон начнёт историю результатов."
                    : "Результаты команды появятся в проекте аккаунта."}
              </span>
            </div>
          )}
        </section>
        <section className="card cockpit-activity">
          <div className="section-title padded">
            <h3>Журнал проекта</h3>
            <Activity size={16} />
          </div>
          {project.audit
            .slice(-3)
            .reverse()
            .map((a) => (
              <div className="cockpit-event" key={a.id}>
                <i />
                <div>
                  <strong>{a.action}</strong>
                  <small>{a.actor || a.target}</small>
                </div>
                <time>
                  {new Date(a.at).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                  })}
                </time>
              </div>
            ))}
          {!project.audit.length && (
            <p className="padded text-muted">
              Здесь появятся изменения вашей команды.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
export function MyWork({
  project,
  session,
  onCase,
}: {
  project: Project;
  session: Session | null;
  onCase: (id: string) => void;
}) {
  const attention = getAttention(project, session?.id);
  const [scope, setScope] = useState<
    "mine" | "review" | "overdue" | "unassigned" | "questions"
  >(session ? "mine" : "review");
  const items = [...attention[scope]].sort(
    (a, b) => priorityRank[a.priority] - priorityRank[b.priority],
  );
  const tabs = [
    ["mine", "Назначено мне", Inbox],
    ["review", "На ревью", CheckCircle2],
    ["overdue", "Просрочено", Clock],
    ["unassigned", "Без ответственного", Users],
    ["questions", "Есть вопросы", AlertTriangle],
  ] as const;
  return (
    <div className="my-work">
      <div className="work-welcome">
        <div>
          <span className="section-kicker">YOUR FOCUS</span>
          <h2>
            {session
              ? `${session.name.split(" ")[0]}, начнём с важного.`
              : "Одна очередь. Чёткий следующий шаг."}
          </h2>
          <p>Назначенные проверки, сроки и вопросы по текущему проекту.</p>
        </div>
        <div className="work-orbit">
          <Target size={35} />
        </div>
      </div>
      <div className="work-tabs">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            className={scope === key ? "selected" : ""}
            onClick={() => setScope(key)}
            disabled={key === "mine" && !session}
          >
            <Icon size={17} />
            <span>{label}</span>
            <b>{attention[key].length}</b>
          </button>
        ))}
      </div>
      <section className="card work-list">
        <div className="section-title padded">
          <h3>{tabs.find((t) => t[0] === scope)?.[1]}</h3>
          <span className="mini-label">{items.length} задач</span>
        </div>
        {items.map((t) => (
          <button className="work-task" key={t.id} onClick={() => onCase(t.id)}>
            <span className={`work-priority ${t.priority}`} />
            <span className="work-task-title">
              <small>
                {t.key} {t.suite ? `/ ${t.suite}` : ""}
              </small>
              <strong>{t.title}</strong>
              {t.assumptions.length > 0 && <em>{t.assumptions[0]}</em>}
            </span>
            <span className={`priority ${t.priority}`}>
              {priorityLabels[t.priority]}
            </span>
            <span className={`badge ${t.status}`}>
              {statusLabels[t.status]}
            </span>
            <span className="work-due">{t.dueDate || "Без срока"}</span>
            <ArrowUpRight size={16} />
          </button>
        ))}
        {!items.length && (
          <div className="calm-empty large">
            <CheckCircle2 size={35} />
            <h3>Здесь всё спокойно</h3>
            <p>
              {scope === "mine"
                ? "Назначьте себя ответственным во вкладке «Обсуждение» тест-кейса."
                : "Сценариев в этой очереди пока нет. Можно перейти к другим проверкам."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
