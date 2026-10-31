import {embeddingConfig, prepareIndex, storeIndex} from './vectors.mjs';
import {createClient} from 'redis';
import { snapshot, resultSchema } from "./autorun.mjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { projectSchema } from "../dist/validation.mjs";
import { error } from "./auth.mjs";
const generateSchema = z.object({
  requirement_ids: z.array(z.string()).min(1).max(20),
  framework: z.enum(["pytest", "playwright", "junit"]),
  count: z.number().int().min(1).max(15),
  include_code: z.boolean(),
});
const key = (items, prefix) =>
  prefix +
  "-" +
  String(
    Math.max(0, ...items.map((i) => Number(i.key.split("-").at(-1)) || 0)) + 1,
  ).padStart(3, "0");
const view = (j) => ({
  ...j,
  payload: undefined,
  author_id: undefined,
  result: j.result ? JSON.parse(j.result) : null,
});
export function requireProject(db, pid, uid, write = false) {
  const row = db.raw
    .prepare(
      "SELECT p.*,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE p.id=? AND m.user_id=?",
    )
    .get(pid, uid);
  if (!row) throw error(404, "Проект не найден");
  if (write && JSON.parse(row.data).archived) throw error(409, "Проект в архиве. Сначала восстановите его");
  if (write && row.role === "viewer") throw error(403, "Недостаточно прав");
  return row;
}
export function createJobs(db, { mlUrl, mlToken, model, apiKeyConfigured, runnerUrl = "" }) {
  const indexControllers=new Map();
  const queue=process.env.REDIS_URL?createClient({url:process.env.REDIS_URL}):null;
  let queueReady=false;
  if (queue) {
    // PostgreSQL is authoritative; Redis is a recoverable dispatch queue.
    queue.on('error', () => { queueReady=false; });
    queue.on('ready', () => { queueReady=true; if (!closed) void pump(); });
    void queue.connect().catch(() => {});
  }
  const retry=setInterval(()=>{if(!closed)void pump();},2000);retry.unref();
  let working = false,
    closed = false;
  db.raw
    .prepare(
      "UPDATE jobs SET status='failed',error='Сервер перезапущен во время обработки. Повторите задачу.',payload='{}' WHERE status='running'",
    )
    .run();
  function enqueue(user, pid, kind, payload) {
    requireProject(db, pid, user.id, true);
    if (
      db.raw
        .prepare(
          "SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','running')",
        )
        .get(pid)
    )
      throw error(409, "В проекте уже выполняется задача");
    if (
      db.raw
        .prepare(
          "SELECT count(*) n FROM jobs WHERE status IN ('queued','running')",
        )
        .get().n >= 20
    )
      throw error(429, "Очередь заполнена. Повторите позже");
    const id = randomUUID();
    db.raw
      .prepare(
        "INSERT INTO jobs VALUES(?,?,?,?,'queued','В очереди',?,NULL,NULL,?)",
      )
      .run(
        id,
        pid,
        user.id,
        kind,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
    if(queue&&queueReady)void queue.rPush('atlas:jobs',id).then(()=>pump()).catch(()=>{queueReady=false;});else setImmediate(pump);
    return view(db.raw.prepare("SELECT * FROM jobs WHERE id=?").get(id));
  }
  async function processJob(j) {
    const pld = JSON.parse(j.payload);
    if (j.kind === 'embeddings') {
      const controller=new AbortController();indexControllers.set(j.id,controller);
      try {
        const row=requireProject(db,j.project_id,j.author_id,true);
        if(row.revision!==pld.revision)throw error(409,'Проект изменился. Повторите индексацию');
        const prepared=await prepareIndex(JSON.parse(row.data),{
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600000)]),
          progress:(done,total)=>{if(closed)throw error(409,'Сервер остановлен');db.raw.prepare("UPDATE jobs SET progress=? WHERE id=? AND status='running'").run(`Семантический индекс: ${done}/${total}`,j.id);}
        });
        if(closed)return;
        db.raw.exec('BEGIN IMMEDIATE');
        try {
          const active=db.raw.prepare('SELECT status FROM jobs WHERE id=?').get(j.id);
          if(active?.status!=='running') {db.raw.exec('ROLLBACK');return;}
          const account=db.raw.prepare('SELECT disabled FROM accounts WHERE id=?').get(j.author_id);
          if(!account||account.disabled)throw error(403,'Аккаунт автора отключён');
          if(requireProject(db,j.project_id,j.author_id,true).revision!==pld.revision)throw error(409,'Проект изменился. Старый индекс сохранён, повторите индексацию');
          storeIndex(db,j.project_id,prepared);
          db.raw.prepare("UPDATE jobs SET status='succeeded',progress='Семантический индекс готов',result=?,payload='{}' WHERE id=?").run(JSON.stringify({chunks:prepared.rows.length,dimensions:prepared.dimensions}),j.id);
          db.raw.exec('COMMIT');
        }catch(e){db.raw.exec('ROLLBACK');throw e;}
      }finally{indexControllers.delete(j.id);}
      return;
    }
    const auto = j.kind === "autorun";
    const response = await fetch(
      auto ? runnerUrl + "/run" : mlUrl + (j.kind === "import" ? "/parse" : "/generate"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + mlToken,
        },
        body: JSON.stringify(auto ? {id:j.id, framework:pld.input.framework, sources:pld.input.sources, tests:pld.input.tests} : pld.input),
        signal: AbortSignal.timeout(260000),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw error(
        502,
        typeof result.detail === "string"
          ? result.detail
          : "Сервис обработки отклонил запрос",
      );
    if (closed) return;
    db.raw.exec("BEGIN IMMEDIATE");
    try {
      const current = db.raw
        .prepare("SELECT status FROM jobs WHERE id=?")
        .get(j.id);
      if (current.status === "cancelled") {
        db.raw.exec("ROLLBACK");
        return;
      }
      const account = db.raw
        .prepare("SELECT name,disabled FROM accounts WHERE id=?")
        .get(j.author_id);
      if (!account || account.disabled)
        throw error(403, "Аккаунт автора отключён");
      const row = requireProject(db, j.project_id, j.author_id, true);
      if (auto) {
        const report = resultSchema.parse(result);
        const summary = {...report, snapshot:pld.input, completedAt:new Date().toISOString()};
        db.raw.prepare("UPDATE jobs SET status='succeeded',progress='Прогон завершён',result=?,payload='{}' WHERE id=?").run(JSON.stringify(summary),j.id);
        db.raw.exec("COMMIT");
        return;
      }
      if (row.revision !== pld.revision)
        throw error(
          409,
          "Проект изменился во время обработки. Повторите на актуальной версии",
        );
      const p = JSON.parse(row.data);
      let summary, action;
      if (j.kind === "import") {
        if (pld.source_code) {
          if (typeof result.text !== "string" || !result.text.trim() || result.text.length > 120000)
            throw error(502, "Некорректный текст исходного кода");
          p.sources = p.sources.filter(s => s.name !== pld.name);
          p.sources.push({id: randomUUID(), name: pld.name, text: result.text});
          summary = {imported:true,source:true};
        } else {
          if (!Array.isArray(result.requirements) || !result.requirements.length || result.requirements.length > 2000)
            throw error(502, "Не удалось выделить требования; документ не был частично импортирован");
          // Re-import is additive and idempotent. Never delete old requirements
          // or reassign existing test-case links without an explicit review.
          const seen = new Set(p.requirements.map(r => r.key));
          const sourceIdentity = (item) => item.originalId
            ? `id:${item.originalId.trim().toUpperCase()}`
            : `text:${item.text.trim().replace(/\s+/g, ' ')}`;
          const existing = new Set(p.requirements
            .filter(r => r.source === pld.name)
            .map(sourceIdentity));
          let imported = 0, skipped = 0;
          for (const req of result.requirements) {
            if (typeof req.text !== 'string' || !req.text.trim() || req.text.length > 120000 ||
                typeof req.title !== 'string' || (req.originalId != null && typeof req.originalId !== 'string') || !['explicit','numbered','heuristic','review'].includes(req.extraction) ||
                (req.conditions !== undefined && (!Array.isArray(req.conditions) || req.conditions.length > 200)))
              throw error(502, 'Сервис вернул некорректную структуру требования');
            const identity = sourceIdentity(req);
            if (existing.has(identity)) { skipped++; continue; }
            const originalId = typeof req.originalId === 'string' && req.originalId.length <= 100 &&
              /^[\p{L}\p{N}._-]+$/u.test(req.originalId) ? req.originalId : null;
            let displayKey = originalId || key(p.requirements, 'REQ');
            if (seen.has(displayKey)) displayKey = key(p.requirements, 'REQ');
            seen.add(displayKey);
            existing.add(identity);
            const page = Number.isInteger(req.page) && req.page > 0 ? req.page : null;
            const pageEnd = Number.isInteger(req.pageEnd) && req.pageEnd >= (page || 1) ? req.pageEnd : null;
            p.requirements.push({
              id:randomUUID(),key:displayKey,title:req.title.slice(0,500),text:req.text,
              priority:'medium',source:pld.name,
              ...(page ? {page} : {}),
              ...(pageEnd ? {pageEnd} : {}),
              ...(originalId ? {originalId} : {}),
              ...(req.conditions?.length ? {conditions:req.conditions} : {}),
              extraction:req.extraction,
            });
            imported++;
          }
          summary = {imported:true,count:imported,skipped,
            review:result.requirements.filter(r => r.extraction !== 'explicit' && r.extraction !== 'numbered').length,
            note: skipped ? `Уже импортированные требования пропущены: ${skipped}. Старые записи и связи не изменены.` :
              'Сверьте автоматически выделенные правила с оригиналом; элементы с пометкой «проверить» не являются подтверждёнными требованиями.'};
        }
        action = "Импортирован документ";
      } else {
        if (
          !Array.isArray(result.cases) ||
          result.cases.length > pld.input.count
        )
          throw error(502, "Некорректное количество сценариев");
        const valid = new Set(pld.input.requirements.map((r) => r.id));
        for (const c of result.cases) {
          if (
            !Array.isArray(c.requirementIds) ||
            !c.requirementIds.length ||
            c.requirementIds.some((id) => !valid.has(id))
          )
            throw error(502, "ИИ вернул неизвестную связь с требованием");
          p.cases.push({
            ...c,
            code: pld.input.include_code ? c.code : "",
            id: randomUUID(),
            key: key(p.cases, "TC"),
            framework: pld.input.framework,
            status: "draft",
            origin: "ai",
            updatedAt: new Date().toISOString(),
          });
        }
        action = "Сгенерированы черновики";
        summary = {
          framework: pld.input.framework,
          includeCode: pld.input.include_code,
          requestedCount: pld.input.count,
          selectedRequirements: pld.input.requirements.map(r => r.key),
          partial: result.cases.length < pld.input.count || pld.input.requirements.some(r => !result.cases.some(c => c.requirementIds[0] === r.id)),
          count: result.cases.length,
          questions: [...(Array.isArray(result.questions) ? result.questions.filter(q => {
            if (typeof q !== 'string') return false;
            if (!pld.input.include_code && /playwright|pytest|junit|артефакт|автотест|браузерн/i.test(q)) return false;
            if (pld.input.framework !== 'playwright' && /playwright/i.test(q)) return false;
            return true;
          }) : []),
            ...(() => {
              const missing = pld.input.requirements.filter(r => !result.cases.some(c => c.requirementIds[0] === r.id));
              return missing.length ? ['Частичный результат. Нет отдельного сценария для: ' + missing.map(r => r.key).join(', ')] : [];
            })()],
          missingRequirementIds: pld.input.requirements.filter(r => !result.cases.some(c => c.requirementIds[0] === r.id)).map(r => r.id),
          model: result.model,
          usage: result.usage,
        };
      }
      p.revision++;
      p.audit = [
        ...p.audit.slice(-999),
        {
          id: randomUUID(),
          at: new Date().toISOString(),
          action,
          target: j.kind === "import" ? pld.name : result.model,
          actor: account.name,
        },
      ];
      const validated = projectSchema.parse(p),
        data = JSON.stringify(validated);
      if (data.length > 8_000_000)
        throw error(413, "После обработки проект превышает 8 МБ");
      db.raw
        .prepare(
          "UPDATE projects SET data=?,revision=?,updated_at=? WHERE id=?",
        )
        .run(data, p.revision, new Date().toISOString(), p.id);
      db.raw
        .prepare(
          "UPDATE jobs SET status='succeeded',progress=?,result=?,payload='{}' WHERE id=?",
        )
        .run(summary.partial ? "Частичный результат — проверьте пропущенные требования" : "Готово", JSON.stringify(summary), j.id);
      db.raw.exec("COMMIT");
    } catch (e) {
      db.raw.exec("ROLLBACK");
      throw e;
    }
  }
  async function pump() {
    if (working || closed || (queue&&!queueReady)) return;
    working=true;
    let dispatchId;
    if(queue){try{let id=await queue.lPop('atlas:jobs');if(!id){for(const pending of db.raw.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at").all())await queue.rPush('atlas:jobs',pending.id);id=await queue.lPop('atlas:jobs');}if(!id){working=false;return;}dispatchId=id;}catch{working=false;return;}}
    const j = db.raw
      .prepare(
        dispatchId ? "SELECT * FROM jobs WHERE status='queued' AND id=?" : "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1",
      )
      .get(...(dispatchId ? [dispatchId] : []));
    if (!j) {working=false;return;}
    working = true;
    db.raw
      .prepare("UPDATE jobs SET status='running',progress=? WHERE id=?")
      .run(
        j.kind === "embeddings" ? "Построение семантического индекса" : j.kind === "autorun" ? "Выполнение автотестов" : j.kind === "import" ? "Извлечение текста" : "Генерация черновиков",
        j.id,
      );
    try {
      await processJob(j);
    } catch (e) {
      if (!closed)
        db.raw
          .prepare(
            "UPDATE jobs SET status='failed',error=?,payload='{}' WHERE id=? AND status<>'cancelled'",
          )
          .run(
            (e.status
              ? e.message
              : "Сервис обработки недоступен или превысил время ожидания"
            ).slice(0, 500),
            j.id,
          );
    } finally {
      working = false;
      if (!closed) setImmediate(pump);
    }
  }
  setImmediate(pump);
  return {
    config: async () => {
      let runnerReady = false;
      if (runnerUrl) {
        try { runnerReady = (await fetch(runnerUrl+"/health",{signal:AbortSignal.timeout(2000)})).ok; } catch {}
      }
      return ({
      model: model || null,
      ai_ready: !!(model && apiKeyConfigured),
      runner_ready: runnerReady,
      auth_mode: "password",
      version: "0.8.3",
    }); },
    list(user, pid) {
      requireProject(db, pid, user.id);
      return db.raw
        .prepare(
          "SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 30",
        )
        .all(pid)
        .map(view);
    },
    autoRuns(user, pid) {
      requireProject(db,pid,user.id);
      return db.raw.prepare("SELECT * FROM jobs WHERE project_id=? AND kind='autorun' ORDER BY created_at DESC LIMIT 50").all(pid).map(view);
    },
    run(user,pid,input) {
      if (!runnerUrl) throw error(503,'Исполнитель не настроен');
      const row = requireProject(db,pid,user.id,true);
      return enqueue(user,pid,'autorun',{revision:row.revision,input:snapshot(JSON.parse(row.data),input)});
    },
    index(user,pid) {
      if(db.dialect!=='postgres')throw error(503,'Для индекса нужен PostgreSQL + pgvector');
      embeddingConfig();
      const row=requireProject(db,pid,user.id,true);
      if(!JSON.parse(row.data).requirements.length)throw error(400,'Загрузите требования');
      return enqueue(user,pid,'embeddings',{revision:row.revision});
    },
    generate(user, pid, input) {
      const r = generateSchema.parse(input);
      if (!model || !apiKeyConfigured)
        throw error(
          503,
          "Задайте OPENAI_API_KEY и OPENAI_MODEL в .env сервера",
        );
      const row = requireProject(db, pid, user.id, true),
        p = JSON.parse(row.data);
      const requirements = p.requirements.filter((x) =>
        r.requirement_ids.includes(x.id),
      );
      if (requirements.length !== new Set(r.requirement_ids).size)
        throw error(400, "Требование не найдено");
      if (r.include_code && !p.sources.length)
        throw error(400, "Для кода нужен контекст исходных файлов");
      // Give the model both existing scenarios and real uncovered lines from
      // the last measured run, so additional batches add value rather than volume.
      const existing_cases = p.cases
        .filter(c => c.requirementIds?.some(id => r.requirement_ids.includes(id)))
        .slice(-40)
        .map(c => ({title:c.title,gherkin:c.gherkin}));
      let coverage_target = [];
      if (r.include_code && r.framework !== "junit") {
        const recent = db.raw.prepare("SELECT result FROM jobs WHERE project_id=? AND kind='autorun' AND status='succeeded' ORDER BY created_at DESC LIMIT 15").all(pid);
        for (const previous of recent) {
          if (!previous.result) continue;
          let report;
          try { report = JSON.parse(previous.result); } catch { continue; }
          if (report.snapshot?.framework !== r.framework || report.coverage == null) continue;
          const measuredSources = (report.snapshot.sources || []).filter(s => s.name.endsWith(r.framework === "pytest" ? ".py" : ".js"));
          const currentSources = p.sources.filter(s => s.name.endsWith(r.framework === "pytest" ? ".py" : ".js"));
          if (JSON.stringify(measuredSources) !== JSON.stringify(currentSources)) continue;
          // Only reuse coverage when the measured source snapshot still matches.
          coverage_target = (report.files || []).flatMap(f => {
            const source = p.sources.find(s=>s.name===f.name);
            if (!source) return [];
            const lines = source.text.split("\n");
            return (f.missing || []).slice(0,18).map(line=>({file:f.name,line,code:lines[line-1]?.slice(0,200)||""}));
          }).slice(0,60);
          break;
        }
      }
      const payload = {
        revision: row.revision,
        input: {
          requirements,
          sources: r.include_code ? p.sources : [],
          framework: r.framework,
          count: r.count,
          include_code: r.include_code,
          existing_cases,
          coverage_target,
        },
      };
      if (JSON.stringify(payload).length > 140000)
        throw error(413, "Контекст слишком большой");
      return enqueue(user, pid, "generate", payload);
    },
    import(user, pid, name, raw) {
      const row = requireProject(db, pid, user.id, true);
      name = name.split(/[\\/]/).at(-1);
      if (
        !name ||
        name.length > 260 ||
        !/\.(pdf|docx|md|txt|py|js|ts|java)$/i.test(name)
      )
        throw error(400, "Неподдерживаемое имя или формат файла");
      if (raw.length > 10 * 1024 * 1024)
        throw error(413, "Лимит файла — 10 МБ");
      return enqueue(user, pid, "import", {
        revision: row.revision,
        name,
        source_code: /\.(py|js|ts|java)$/i.test(name),
        input: { name, data: raw.toString("base64") },
      });
    },
    cancel(user, id) {
      const j = db.raw.prepare("SELECT * FROM jobs WHERE id=?").get(id);
      if (!j) throw error(404, "Задача не найдена");
      requireProject(db, j.project_id, user.id, true);
      db.raw
        .prepare(
          "UPDATE jobs SET status='cancelled',progress='Отменено',payload='{}' WHERE id=? AND status IN ('queued','running')",
        )
        .run(id);
      indexControllers.get(id)?.abort();
      if (j.kind === 'autorun' && j.status === 'running' && runnerUrl) {
        fetch(runnerUrl+'/runs/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+mlToken},signal:AbortSignal.timeout(5000)}).catch(()=>{});
      }
      return view(db.raw.prepare("SELECT * FROM jobs WHERE id=?").get(id));
    },
    close() {
      closed = true;for(const c of indexControllers.values())c.abort();clearInterval(retry);if(queue)void queue.quit().catch(()=>{});
    },
  };
}
