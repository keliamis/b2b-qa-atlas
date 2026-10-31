import { Bug } from "lucide-react";
import type { DefectDraft } from "./quality";
import { useEffect, useState } from "react";
import {
  Users,
  Mail,
  Copy,
  ShieldCheck,
  Plus,
  RefreshCw,
  MessageSquare,
  Send,
  UserPlus,
  LogOut,
  ArrowRight,
  CheckCircle2,
  Play,
  Check,
  AlertCircle,
  Star,
  Columns3,
  Clock,
} from "lucide-react";
import {
  cloud,
  roleLabels,
  outcomeLabels,
  type Session,
  type Team,
  type Comment,
  type ManualRun,
  type RunResult,
  type Outcome,
} from "./cloud";
import {
  type Project,
  type TestCase,
  statusLabels,
  priorityLabels,
} from "./types";
const time = (s: string) =>
  new Date(s).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
export function AccountPanel({
  session,
  hosted,
  onCloud,
  onLocal,
  onImportLocal,
  theme,
  setTheme,
}: {
  session: Session | null;
  hosted: boolean;
  onCloud: () => void;
  onLocal: () => void;
  onImportLocal: () => void;
  theme: string;
  setTheme: (v: string) => void;
}) {
  return (
    <section className="card account-card">
      <div className="account-hero">
        <span className="profile-orb">
          {session?.name?.slice(0, 2).toUpperCase() || "QA"}
        </span>
        <div>
          <span className="section-kicker">МОЙ АККАУНТ</span>
          <h2>{session?.name || "Локальное пространство"}</h2>
          <p>
            {session?.email ||
              "Откройте опубликованный сайт, чтобы войти в аккаунт."}
          </p>
        </div>
        {session && (
          <span className="badge approved">
            <ShieldCheck size={14} /> Вход выполнен
          </span>
        )}
      </div>
      <div className="account-grid">
        <div>
          <h3>Профиль и вход</h3>
          <p>
            Вход по почте и паролю. Новый пользователь может зарегистрироваться
            самостоятельно на странице входа. Сброс пароля пока выполняет администратор.
          </p>
          {session ? (
            <button
              className="button"
              onClick={async () => {
                const r = await fetch("/auth/logout", { method: "POST" });
                if (r.ok) location.assign("/login");
              }}
            >
              <LogOut size={15} /> Выйти из аккаунта
            </button>
          ) : (
            <a
              className="button primary"
              href="/login?return_to=%2F"
              target="_top"
            >
              Войти по почте <ArrowRight size={15} />
            </a>
          )}
        </div>
        <div>
          <h3>Оформление</h3>
          <p>
            Выберите удобную тему. Настройка сохраняется на этом устройстве.
          </p>
          <div className="theme-options">
            {[
              ["light", "Светлая"],
              ["dark", "Тёмная"],
              ["system", "Как в системе"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={theme === v ? "selected" : ""}
                onClick={() => setTheme(v)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="account-storage">
        <div>
          <strong>
            {hosted ? "Пространство на сервере" : "Локальные проекты"}
          </strong>
          <p>
            {hosted
              ? "Данные привязаны к вашему аккаунту и доступны с другого устройства."
              : "Данные этой вкладки хранятся только в браузере."}
          </p>
        </div>
        {session && (
          <div className="storage-actions">
            {!hosted && (
              <button className="button primary" onClick={onImportLocal}>
                Скопировать проект в аккаунт
              </button>
            )}
            <button className="button" onClick={hosted ? onLocal : onCloud}>
              {hosted
                ? "Открыть локальные проекты"
                : "Открыть проекты аккаунта"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
export function TeamView({
  project,
  session,
  enabled,
  onError,
}: {
  project: Project;
  session: Session | null;
  enabled: boolean;
  onError: (s: string) => void;
}) {
  const [team, setTeam] = useState<Team | null>(null),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  async function load() {
    try {
      setTeam(await cloud<Team>(`/projects/${project.id}/team`));
    } catch (e) {
      onError((e as Error).message);
    }
  }
  useEffect(() => {
    setTeam(null);
    setLink("");
    if (enabled) void load();
  }, [project.id, enabled]);
  const mutate = async (path: string, method: string, data?: unknown) => {
    setBusy(true);
    try {
      await cloud(path, method, data);
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!enabled)
    return (
      <div className="card team-empty">
        <Users size={38} />
        <h2>Качество — командная работа</h2>
        <p>
          Общие проекты, назначение проверок, обсуждения и ревью доступны в
          проектах аккаунта. Откройте их в настройках.
        </p>
      </div>
    );
  return (
    <div className="team-layout">
      <section className="card">
        <div className="section-title padded">
          <div>
            <h3>
              Участники проекта{" "}
              <span className="count-label">{team?.members.length || 0}</span>
            </h3>
            <p>Одна команда. Общий контекст.</p>
          </div>
          <button
            className="icon-button"
            onClick={load}
            aria-label="Обновить команду"
          >
            <RefreshCw size={17} />
          </button>
        </div>
        {!team && <p className="padded">Загружаем участников…</p>}
        {team?.members.map((m) => (
          <div className="member-row" key={m.id}>
            <span className="member-avatar">
              {m.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>
                {m.name}
                {m.id === session?.id ? " · вы" : ""}
              </strong>
              <small>{m.email}</small>
            </div>
            {team.role === "owner" && m.role !== "owner" ? (
              <>
                <select
                  aria-label={`Роль ${m.name}`}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) =>
                    mutate(`/projects/${project.id}/members/${m.id}`, "PATCH", {
                      role: e.target.value,
                    })
                  }
                >
                  <option value="tester">Тестировщик</option>
                  <option value="viewer">Наблюдатель</option>
                </select>
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Удалить ${m.name} из проекта?`))
                      void mutate(
                        `/projects/${project.id}/members/${m.id}`,
                        "DELETE",
                      );
                  }}
                >
                  Удалить
                </button>
              </>
            ) : (
              <span className="role-badge">{roleLabels[m.role]}</span>
            )}
          </div>
        ))}
        <div className="role-guide">
          <ShieldCheck size={19} />
          <p>
            <b>Тестировщик</b> редактирует и проводит проверки.{" "}
            <b>Наблюдатель</b> читает данные. <b>Владелец</b> управляет составом
            команды.
          </p>
        </div>
      </section>
      <section className="card invite-card">
        <span className="feature-icon">
          <UserPlus size={24} />
        </span>
        <h3>Пригласить в проект</h3>
        <p>
          Создайте персональную ссылку для почты коллеги. Она действует 7 дней.
        </p>
        {team?.role === "owner" ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                const v = await cloud<{ url: string }>(
                  `/projects/${project.id}/team`,
                  "POST",
                  { email: f.get("email"), role: f.get("role") },
                );
                setLink(v.url);
                setCopied(false);
                await load();
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Почта участника
              <input
                type="email"
                name="email"
                placeholder="colleague@company.ru"
                required
                maxLength={254}
              />
            </label>
            <label>
              Роль
              <select name="role">
                <option value="tester">Тестировщик — редактирование</option>
                <option value="viewer">Наблюдатель — просмотр</option>
              </select>
            </label>
            <button className="button primary" disabled={busy}>
              <Plus size={16} /> Создать приглашение
            </button>
          </form>
        ) : (
          <div className="notice subtle">
            Приглашения создаёт владелец проекта.
          </div>
        )}
        {link && (
          <div className="invite-result">
            <strong>Ссылка готова</strong>
            <input aria-label="Ссылка приглашения" readOnly value={link} />
            <button
              className="button"
              onClick={() =>
                navigator.clipboard
                  .writeText(link)
                  .then(() => setCopied(true))
                  .catch(() => onError("Скопируйте ссылку вручную из поля"))
              }
            >
              <Copy size={14} />
              {copied ? "Скопировано" : "Копировать ссылку"}
            </button>
            <small>Письмо не отправлялось. Передайте ссылку участнику.</small>
          </div>
        )}
        <div className="notice subtle">
          <AlertCircle size={16} />
          <span>
            Администратор сервера сначала создаёт аккаунт коллеге. Затем коллега
            открывает ссылку приглашения и входит с указанной почтой.
          </span>
        </div>
      </section>
      {team?.role === "owner" && (
        <section className="card invitations-card">
          <div className="section-title padded">
            <h3>Приглашения</h3>
          </div>
          {team.invitations.length === 0 ? (
            <p className="padded text-muted">Вы ещё никого не приглашали.</p>
          ) : (
            team.invitations.map((i) => (
              <div className="invite-row" key={i.id}>
                <Mail size={17} />
                <div>
                  <strong>{i.email}</strong>
                  <small>
                    {roleLabels[i.role as keyof typeof roleLabels]} · до{" "}
                    {time(i.expires_at)}
                  </small>
                </div>
                <span>
                  {i.revoked
                    ? "Отозвано"
                    : i.accepted_by
                      ? "Принято"
                      : new Date(i.expires_at) < new Date()
                        ? "Истекло"
                        : "Ожидает входа"}
                </span>
                {!i.revoked && !i.accepted_by && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        `/projects/${project.id}/invitations/${i.id}`,
                        "DELETE",
                      )
                    }
                  >
                    Отозвать
                  </button>
                )}
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
export function CollaborationPanel({
  project,
  test,
  enabled,
  readOnly,
  onUpdate,
  onError,
}: {
  project: Project;
  test: TestCase;
  enabled: boolean;
  readOnly: boolean;
  onUpdate: (patch: Partial<TestCase>) => Promise<boolean>;
  onError: (s: string) => void;
}) {
  const [team, setTeam] = useState<Team | null>(null),
    [comments, setComments] = useState<Comment[]>([]),
    [busy, setBusy] = useState(false),
    [text, setText] = useState("");
  async function load() {
    try {
      const [t, c] = await Promise.all([
        cloud<Team>(`/projects/${project.id}/team`),
        cloud<Comment[]>(`/projects/${project.id}/comments`),
      ]);
      setTeam(t);
      setComments(c);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  useEffect(() => {
    setComments([]);
    setTeam(null);
    setText("");
    if (enabled) void load();
  }, [project.id, test.id, enabled]);
  if (!enabled)
    return (
      <div className="notice subtle">
        <Users size={18} />
        <span>
          Откройте проект аккаунта для назначения ответственных и обсуждения
          тест-кейсов.
        </span>
      </div>
    );
  return (
    <div className="collaboration-panel">
      <div className="assignment-fields">
        <label>
          Ответственный
          <select
            disabled={readOnly || busy}
            value={test.assigneeId || ""}
            onChange={async (e) => {
              setBusy(true);
              await onUpdate({ assigneeId: e.target.value || undefined });
              setBusy(false);
            }}
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
        <label>
          Срок проверки
          <input
            type="date"
            disabled={readOnly || busy}
            value={test.dueDate || ""}
            onChange={async (e) => {
              setBusy(true);
              await onUpdate({ dueDate: e.target.value || undefined });
              setBusy(false);
            }}
          />
        </label>
      </div>
      <div className="section-title">
        <h3>
          <MessageSquare size={16} /> Обсуждение
        </h3>
        <button
          className="icon-button"
          onClick={load}
          aria-label="Обновить обсуждение"
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="comments-list">
        {comments
          .filter((c) => c.case_id === test.id)
          .map((c) => (
            <article key={c.id}>
              <div>
                <strong>{c.author}</strong>
                <time>{time(c.created_at)}</time>
              </div>
              <p>{c.body}</p>
            </article>
          ))}
        {!comments.some((c) => c.case_id === test.id) && (
          <p className="text-muted">
            Уточните ожидаемый результат или оставьте замечание к сценарию.
          </p>
        )}
      </div>
      {!readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            setBusy(true);
            try {
              await cloud(`/projects/${project.id}/comments`, "POST", {
                caseId: test.id,
                body: text,
              });
              setText("");
              await load();
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea
            aria-label="Комментарий к тесту"
            placeholder="Добавьте комментарий…"
            value={text}
            maxLength={5000}
            onChange={(e) => setText(e.target.value)}
            required
            rows={3}
          />
          <button className="button primary" disabled={busy || !text.trim()}>
            <Send size={14} /> Отправить комментарий
          </button>
        </form>
      )}
    </div>
  );
}
export function ReviewBoard({
  project,
  onCase,
  onStatus,
  onError,
  readOnly,
  favorites,
  toggleFavorite,
}: {
  project: Project;
  onCase: (id: string) => void;
  onStatus: (id: string, status: TestCase["status"]) => void;
  onError: (s: string) => void;
  readOnly: boolean;
  favorites: string[];
  toggleFavorite: (id: string) => void;
}) {
  const [mine, setMine] = useState(false);
  const items = mine
    ? project.cases.filter((t) => favorites.includes(t.id))
    : project.cases;
  return (
    <>
      <div className="board-toolbar">
        <span>
          <Columns3 size={17} /> От черновика до готового сценария
        </span>
        <button
          className={`button ${mine ? "active-filter" : ""}`}
          onClick={() => setMine(!mine)}
        >
          <Star size={15} /> {mine ? "Показать все" : "Только избранные"}
        </button>
      </div>
      <div className="kanban">
        {(["draft", "review", "approved"] as const).map((s) => (
          <section className={`kanban-column ${s}`} key={s}>
            <header>
              <i />
              <h3>{statusLabels[s]}</h3>
              <b>{items.filter((t) => t.status === s).length}</b>
            </header>
            <div className="kanban-cards">
              {items
                .filter((t) => t.status === s)
                .map((t) => (
                  <article className="kanban-card" key={t.id}>
                    <div>
                      <span className="mono">{t.key}</span>
                      <button
                        className={`icon-button ${favorites.includes(t.id) ? "is-favorite" : ""}`}
                        aria-label={`В избранное ${t.key}`}
                        aria-pressed={favorites.includes(t.id)}
                        onClick={() => toggleFavorite(t.id)}
                      >
                        <Star size={15} />
                      </button>
                    </div>
                    <button
                      className="kanban-title"
                      onClick={() => onCase(t.id)}
                    >
                      {t.title}
                    </button>
                    <p>
                      <span className={`priority ${t.priority}`}>
                        {priorityLabels[t.priority]}
                      </span>
                      {t.assumptions.length > 0 && (
                        <span className="assumption-count">
                          {t.assumptions.length} уточн.
                        </span>
                      )}
                    </p>
                    {t.dueDate && (
                      <small className="due-date">
                        <Clock size={12} /> {t.dueDate}
                      </small>
                    )}
                    <footer>
                      <button
                        className="text-button"
                        onClick={() => onCase(t.id)}
                      >
                        Открыть <ArrowRight size={13} />
                      </button>
                      {!readOnly && (
                        <select
                          aria-label={`Статус ${t.key}`}
                          value={t.status}
                          onChange={(e) =>
                            onStatus(t.id, e.target.value as TestCase["status"])
                          }
                        >
                          {(["draft", "review", "approved"] as const).map(
                            (v) => (
                              <option key={v} value={v}>
                                {statusLabels[v]}
                              </option>
                            ),
                          )}
                        </select>
                      )}
                    </footer>
                  </article>
                ))}
              {!items.some((t) => t.status === s) && (
                <div className="kanban-empty">Пока нет тест-кейсов</div>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
function ResultEditor({
  result,
  run,
  disabled,
  onSave,
  onDefect,
}: {
  onDefect: () => void;
  result: RunResult;
  run: ManualRun;
  disabled: boolean;
  onSave: (outcome: Outcome, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(result.note),
    [outcome, setOutcome] = useState(result.outcome);
  useEffect(() => {
    setNote(result.note);
    setOutcome(result.outcome);
  }, [result.caseId, run.revision]);
  return (
    <div className="result-editor">
      <span className="section-kicker">{result.key} · СНИМОК СЦЕНАРИЯ</span>
      <h3>{result.title}</h3>
      <pre className="gherkin run-gherkin">
        {result.gherkin || "Сценарий не заполнен"}
      </pre>
      <label>
        Результат ручной проверки
        <select
          aria-label="Результат ручной проверки"
          value={outcome}
          disabled={disabled}
          onChange={(e) => setOutcome(e.target.value as Outcome)}
        >
          {Object.entries(outcomeLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Наблюдения / ссылка на дефект
        <textarea
          value={note}
          disabled={disabled}
          onChange={(e) => setNote(e.target.value)}
          maxLength={5000}
          rows={3}
          placeholder="Что получилось при выполнении сценария?"
        />
      </label>
      {["failed", "blocked"].includes(result.outcome) && !disabled && (
        <button
          type="button"
          className="button defect-from-result"
          onClick={onDefect}
        >
          <Bug size={16} /> Создать дефект по сохранённому результату
        </button>
      )}
      <div className="result-actions">
        <small>
          {result.by
            ? `${result.by} · ${time(result.at!)}`
            : "Результат ещё не зафиксирован"}
        </small>
        <button
          className="button primary"
          disabled={disabled}
          onClick={() => onSave(outcome, note)}
        >
          <Check size={15} /> Сохранить результат
        </button>
      </div>
    </div>
  );
}
export function ManualRuns({
  project,
  enabled,
  onError,
  readOnly,
  onDefect,
}: {
  onDefect?: (draft: DefectDraft) => void;
  project: Project;
  enabled: boolean;
  onError: (s: string) => void;
  readOnly: boolean;
}) {
  const [runs, setRuns] = useState<ManualRun[]>([]),
    [active, setActive] = useState(""),
    [caseId, setCaseId] = useState(""),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      const r = await cloud<ManualRun[]>(`/projects/${project.id}/runs`);
      setRuns(r);
      setActive((a) => (r.some((x) => x.id === a) ? a : r[0]?.id || ""));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setRuns([]);
    setActive("");
    setCreating(false);
    if (enabled) void load();
    else setLoading(false);
  }, [project.id, enabled]);
  const run = runs.find((r) => r.id === active);
  const result =
    run?.results.find((r) => r.caseId === caseId) || run?.results[0];
  if (!enabled)
    return (
      <section className="card team-empty">
        <Play size={38} />
        <h2>Ручные прогоны с историей</h2>
        <p>
          Откройте проект аккаунта, чтобы команда могла выполнять сценарии и
          сохранять результаты. Автоматический исполнитель пока не подключён.
        </p>
      </section>
    );
  return (
    <div className="manual-runs">
      <div className="board-toolbar">
        <span>
          <span className="mini-label">Ручное тестирование</span> Результаты
          фиксируют участники команды
        </span>
        <div>
          <button className="button" onClick={load} disabled={busy}>
            <RefreshCw size={15} /> Обновить
          </button>{" "}
          {!readOnly && (
            <button
              className="button primary"
              onClick={() => setCreating(!creating)}
              disabled={!project.cases.length}
            >
              <Plus size={15} /> Новый прогон
            </button>
          )}
        </div>
      </div>
      {creating && (
        <form
          className="card run-create"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const only = f.get("scope") === "approved";
            const ids = project.cases
              .filter((c) => !only || c.status === "approved")
              .map((c) => c.id);
            if (!ids.length) {
              onError("В выбранной группе нет тест-кейсов");
              return;
            }
            setBusy(true);
            try {
              const r = await cloud<ManualRun>(
                `/projects/${project.id}/runs`,
                "POST",
                {
                  name: f.get("name"),
                  environment: f.get("environment"),
                  caseIds: ids,
                },
              );
              await load();
              setActive(r.id);
              setCaseId("");
              setCreating(false);
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Название
            <input
              name="name"
              required
              maxLength={160}
              placeholder="Регрессия перед релизом 1.2"
            />
          </label>
          <label>
            Окружение
            <input
              name="environment"
              required
              maxLength={200}
              placeholder="Staging · Chrome · Windows"
            />
          </label>
          <label>
            Сценарии
            <select name="scope">
              <option value="all">Все тест-кейсы</option>
              <option value="approved">Только утверждённые</option>
            </select>
          </label>
          <button className="button primary" disabled={busy}>
            Создать
          </button>
        </form>
      )}
      {runs.length > 0 && (
        <div className="run-layout">
          <aside className="card run-list">
            <h3>История прогонов</h3>
            {runs.map((r) => (
              <button
                className={r.id === active ? "selected" : ""}
                key={r.id}
                onClick={() => {
                  setActive(r.id);
                  setCaseId("");
                }}
              >
                <strong>{r.name}</strong>
                <small>{r.environment}</small>
                <span>
                  {r.results.filter((x) => x.outcome !== "untested").length}/
                  {r.results.length} проверено · {time(r.createdAt)}
                </span>
              </button>
            ))}
          </aside>
          {run && (
            <section className="card run-content">
              <div className="section-title padded">
                <div>
                  <h3>{run.name}</h3>
                  <p>
                    {run.environment} · снимок проекта v{run.projectRevision}
                  </p>
                </div>
                <span className="mini-label">
                  {run.results.filter((r) => r.outcome === "passed").length}{" "}
                  пройдено
                </span>
              </div>
              <div className="run-distribution">
                {Object.entries(outcomeLabels).map(([k, l]) => (
                  <span key={k} className={`outcome ${k}`}>
                    {l}:{" "}
                    <b>{run.results.filter((r) => r.outcome === k).length}</b>
                  </span>
                ))}
              </div>
              <div className="run-body">
                <div className="run-cases">
                  {run.results.map((r) => (
                    <button
                      key={r.caseId}
                      className={result?.caseId === r.caseId ? "selected" : ""}
                      onClick={() => setCaseId(r.caseId)}
                    >
                      <i className={`outcome-dot ${r.outcome}`} />
                      <span>
                        <small>
                          {r.key} · {outcomeLabels[r.outcome]}
                        </small>
                        {r.title}
                      </span>
                    </button>
                  ))}
                </div>
                {result && (
                  <ResultEditor
                    key={`${run.id}-${result.caseId}`}
                    run={run}
                    result={result}
                    disabled={busy || readOnly}
                    onDefect={() =>
                      onDefect?.({
                        title: result.title,
                        severity:
                          project.cases.find((c) => c.id === result.caseId)
                            ?.priority || "medium",
                        actual: result.note || "",
                        expected: "",
                        steps: result.gherkin,
                        environment: run.environment,
                        caseId: result.caseId,
                        sourceRunId: run.id,
                      })
                    }
                    onSave={async (outcome, note) => {
                      setBusy(true);
                      try {
                        const updated = await cloud<ManualRun>(
                          `/projects/${project.id}/runs/${run.id}`,
                          "PATCH",
                          {
                            revision: run.revision,
                            caseId: result.caseId,
                            outcome,
                            note,
                          },
                        );
                        setRuns((rs) =>
                          rs.map((r) => (r.id === updated.id ? updated : r)),
                        );
                      } catch (e) {
                        onError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                )}
              </div>
            </section>
          )}
        </div>
      )}
      {runs.length === 0 && (
        <section className="card team-empty">
          <Play size={35} />
          <h2>{loading ? "Загружаем прогоны…" : "Пока нет ручных прогонов"}</h2>
          <p>
            Создайте набор проверок, выполните шаги в продукте и зафиксируйте
            результаты. Сценарии сохранятся в том виде, в котором были на момент
            создания прогона.
          </p>
        </section>
      )}
      <div className="notice subtle">
        <AlertCircle size={16} /> Эти результаты введены участниками вручную.
        Автоматический запуск и измерение покрытия кода ещё не подключены.
      </div>
    </div>
  );
}
