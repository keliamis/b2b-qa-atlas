import { useState } from "react";
import {
  ArrowUpRight,
  ShieldAlert,
  CheckCircle2,
  Activity,
  Target,
  Download,
  BarChart3,
} from "lucide-react";
import {
  type Project,
  statusLabels,
  typeLabels,
  priorityLabels,
} from "./types";
const colors = ["#8b5cf6", "#38bdf8", "#fbbf24", "#fb7185"];
function Donut({
  values,
  labels,
  onSelect,
}: {
  values: number[];
  labels: string[];
  onSelect: (i: number) => void;
}) {
  const sum = values.reduce((a, b) => a + b, 0);
  let offset = 0;
  return (
    <div className="donut-layout">
      <div className="donut">
        <svg
          viewBox="0 0 160 160"
          role="img"
          aria-label={labels.map((l, i) => `${l}: ${values[i]}`).join(", ")}
        >
          <circle
            cx="80"
            cy="80"
            r="62"
            fill="none"
            stroke="var(--border)"
            strokeWidth="16"
          />
          {values.map((v, i) => {
            const length = sum ? (v / sum) * 389.56 : 0;
            const o = offset;
            offset += length;
            return (
              <circle
                key={i}
                cx="80"
                cy="80"
                r="62"
                fill="none"
                stroke={colors[i]}
                strokeWidth="16"
                strokeDasharray={`${length} ${389.56 - length}`}
                strokeDashoffset={-o}
                transform="rotate(-90 80 80)"
              />
            );
          })}
        </svg>
        <div>
          <strong>{sum}</strong>
          <small>тест-кейсов</small>
        </div>
      </div>
      <div className="chart-legend">
        {labels.map((l, i) => (
          <button key={l} onClick={() => onSelect(i)}>
            <i style={{ background: colors[i] }} />
            <span>{l}</span>
            <b>{values[i]}</b>
            <ArrowUpRight size={12} />
          </button>
        ))}
      </div>
    </div>
  );
}
export function Analytics({
  project,
  openTests,
  openRequirements,
  onCase,
  full = false,
}: {
  project: Project;
  openTests: (status: string) => void;
  openRequirements: () => void;
  onCase: (id: string) => void;
  full?: boolean;
}) {
  const [days, setDays] = useState(7);
  const statuses = ["approved", "review", "draft"] as const;
  const priorities = ["critical", "high", "medium", "low"] as const;
  const coverage = priorities.map((p) => {
    const rs = project.requirements.filter((r) => r.priority === p);
    return {
      total: rs.length,
      covered: rs.filter((r) =>
        project.cases.some((t) => t.requirementIds.includes(r.id)),
      ).length,
    };
  });
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d;
  });
  const events = dates.map(
    (d) =>
      project.audit.filter(
        (a) => new Date(a.at).toDateString() === d.toDateString(),
      ).length,
  );
  const max = Math.max(...events, 1);
  const uncovered = project.requirements.filter(
    (r) => !project.cases.some((c) => c.requirementIds.includes(r.id)),
  );
  const risks = uncovered.filter((r) =>
    ["critical", "high"].includes(r.priority),
  );
  const assumptions = project.cases.filter((c) => c.assumptions.length);
  const types = ["positive", "negative", "boundary"] as const;
  function exportStats() {
    const lines = [
      ["Показатель", "Значение"],
      ["Требования", project.requirements.length],
      ["Тест-кейсы", project.cases.length],
      ...statuses.map((s) => [
        statusLabels[s],
        project.cases.filter((t) => t.status === s).length,
      ]),
      ["Требования без тестов", uncovered.length],
      ["Критичные и важные без тестов", risks.length],
      ["Тесты с допущениями", assumptions.length],
    ];
    const b = new Blob(
      ["\uFEFF" + lines.map((row) => row.join(";")).join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "qa-atlas-analytics.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <div className="analytics-area">
      <div className="analytics-heading">
        <div>
          <span className="section-kicker">
            <Activity size={14} /> ПУЛЬС ПРОЕКТА
          </span>
          <h2>{full ? "Качество в цифрах" : "Вся картина. Без догадок."}</h2>
        </div>
        <button className="button compact" onClick={exportStats}>
          <Download size={14} /> Отчёт CSV
        </button>
      </div>
      <div className="charts-grid">
        <section className="card chart-card">
          <div className="section-title">
            <h3>Статусы тест-кейсов</h3>
            <span className="mini-label">Ревью</span>
          </div>
          <Donut
            values={statuses.map(
              (s) => project.cases.filter((c) => c.status === s).length,
            )}
            labels={statuses.map((s) => statusLabels[s])}
            onSelect={(i) => openTests(statuses[i])}
          />
          <p className="chart-foot">
            Утверждённый сценарий прошёл ревью, но ещё не обязательно
            выполнялся.
          </p>
        </section>
        <section className="card chart-card">
          <div className="section-title">
            <h3>Связь требований с тестами</h3>
            <Target size={16} />
          </div>
          <div className="coverage-chart">
            {priorities.map((p, i) => (
              <button
                className="coverage-row"
                key={p}
                onClick={openRequirements}
              >
                <span>{priorityLabels[p]}</span>
                <div>
                  <i
                    style={{
                      width: `${coverage[i].total ? (coverage[i].covered / coverage[i].total) * 100 : 0}%`,
                      background: colors[i],
                    }}
                  />
                </div>
                <b>
                  {coverage[i].covered}/{coverage[i].total}
                </b>
              </button>
            ))}
          </div>
          <p className="chart-foot">
            <i className="legend-square" /> Есть связанные тест-кейсы · не
            покрытие кода
          </p>
        </section>
      </div>
      {full && (
        <div className="charts-grid">
          <section className="card chart-card">
            <div className="section-title">
              <h3>Активность команды</h3>
              <select
                aria-label="Период активности"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>7 дней</option>
                <option value={14}>14 дней</option>
              </select>
            </div>
            <div
              className="activity-chart"
              role="img"
              aria-label={`Изменений по дням: ${events.join(", ")}`}
            >
              {dates.map((d, i) => (
                <div
                  key={i}
                  title={`${d.toLocaleDateString("ru-RU")}: ${events[i]} изменений`}
                >
                  <b>{events[i]}</b>
                  <span
                    style={{
                      height: `${Math.max(3, (events[i] / max) * 120)}px`,
                    }}
                  />
                  <small>
                    {d.getDate()}.{d.getMonth() + 1}
                  </small>
                </div>
              ))}
            </div>
            <p className="chart-foot">
              Сохранённые изменения требований и тестов, зафиксированные в
              журнале.
            </p>
          </section>
          <section className="card chart-card">
            <div className="section-title">
              <h3>Баланс проверок</h3>
              <BarChart3 size={17} />
            </div>
            <Donut
              values={types.map(
                (t) => project.cases.filter((c) => c.type === t).length,
              )}
              labels={types.map((t) => typeLabels[t])}
              onSelect={() => openTests("all")}
            />
            <p className="chart-foot">
              Позитивные, негативные и граничные сценарии дополняют друг друга.
            </p>
          </section>
        </div>
      )}
      <section className="insights-strip">
        <div className="insight-title">
          <ShieldAlert size={21} />
          <strong>Зоны внимания</strong>
          <small>Проверка по данным проекта</small>
        </div>
        <button onClick={openRequirements}>
          <b>{risks.length}</b>
          <span>
            важных требований
            <br />
            без тестов
          </span>
          <ArrowUpRight size={15} />
        </button>
        <button
          onClick={() =>
            assumptions[0] ? onCase(assumptions[0].id) : openTests("all")
          }
        >
          <b>{assumptions.length}</b>
          <span>
            сценариев
            <br />с допущениями
          </span>
          <ArrowUpRight size={15} />
        </button>
        <button onClick={() => openTests("review")}>
          <b>{project.cases.filter((c) => c.status === "review").length}</b>
          <span>
            проверок
            <br />
            ждут ревью
          </span>
          <ArrowUpRight size={15} />
        </button>
      </section>
    </div>
  );
}
