import http from "node:http";
import { createInsights } from "./insights.mjs";
import { createRecovery } from "./recovery.mjs";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { openDatabase } from "./database.mjs";
import {
  currentUser,
  sameOrigin,
  login,
  register,
  logout,
  cookie,
  error,
} from "./auth.mjs";
import { handleWorkspace } from "../dist/workspace.mjs";
import { createJobs, requireProject } from "./jobs.mjs";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
async function readBody(req, limit) {
  const data = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw error(413, "Слишком большой запрос");
    data.push(chunk);
  }
  return Buffer.concat(data);
}
function parseJson(body) {
  try {
    return JSON.parse(body.toString());
  } catch {
    throw error(400, "Некорректный JSON");
  }
}
export function createServer({
  db = openDatabase(),
  origin = process.env.PUBLIC_ORIGIN || "http://localhost:8080",
  staticDir = resolve("frontend/dist"),
  mlUrl = process.env.ML_URL || "http://127.0.0.1:8000",
  mlToken = process.env.ML_TOKEN || "",
  runnerUrl = process.env.RUNNER_URL || "",
  model = process.env.OPENAI_MODEL || "",
  apiKeyConfigured = !!process.env.OPENAI_API_KEY,
} = {}) {
  const publicUrl = new URL(origin);
  if (
    publicUrl.origin !== origin ||
    !["http:", "https:"].includes(publicUrl.protocol)
  )
    throw new Error(
      "PUBLIC_ORIGIN: укажите http(s)://домен[:порт] без завершающего /",
    );
  if (
    publicUrl.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname) &&
    process.env.ALLOW_INSECURE_HTTP !== "true"
  )
    throw new Error(
      "Для сетевого доступа задайте HTTPS PUBLIC_ORIGIN. HTTP разрешён только для localhost",
    );
  const secure = publicUrl.protocol === "https:",
    jobs = createJobs(db, { mlUrl, mlToken, model, apiKeyConfigured, runnerUrl });
  const recovery = createRecovery(db, origin);
  const insights = createInsights(db,{mlUrl,mlToken});
  const server = http.createServer(async (req, res) => {
    const send = (status, value, headers = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...headers,
      });
      res.end(JSON.stringify(value));
    };
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
      const url = new URL(req.url, origin),
        path = url.pathname;
      if (req.method === "GET" && path === "/health") {
        db.raw.prepare("SELECT 1").get();
        return send(200, { status: "ok", version: "0.8.3" });
      }
      sameOrigin(req, origin);
      if (req.method === "GET" && path === "/auth/config")
        return send(200, {email_enabled: recovery.configured});
      if (req.method === "POST" && ["/auth/forgot-password", "/auth/request-verification", "/auth/reset-password", "/auth/verify-email"].includes(path)) {
        const input = parseJson(await readBody(req,4096));
        const result = path === "/auth/reset-password" ? await recovery.reset(input)
          : path === "/auth/verify-email" ? recovery.verify(input)
          : await recovery.request(input, req.socket.remoteAddress, path === "/auth/request-verification" ? "verify" : "reset");
        return send(200,result);
      }
      if (req.method === "POST" && path === "/auth/register") {
        const result = await register(db,parseJson(await readBody(req,4096)),req.socket.remoteAddress);
        return send(201,result.user,{"Set-Cookie":cookie(result.token,secure)});
      }
      if (req.method === "POST" && path === "/auth/login") {
        const result = await login(
          db,
          parseJson(await readBody(req, 4096)),
          req.socket.remoteAddress,
        );
        return send(200, result.user, {
          "Set-Cookie": cookie(result.token, secure),
        });
      }
      if (req.method === "POST" && path === "/auth/logout") {
        logout(db, req);
        return send(
          200,
          { ok: true },
          { "Set-Cookie": cookie("", secure, true) },
        );
      }
      if (path.startsWith("/api/") || path.startsWith("/workspace-api/")) {
        const user = currentUser(db, req);
        if (!user) throw error(401, "Войдите в аккаунт QA Atlas");
        const apiPath = path.replace(/^\/(workspace-api|api)/, "");
        if (apiPath === "/config" && req.method === "GET")
          return send(200, await jobs.config());
        const featurePath = apiPath.match(/^\/projects\/([^/]+)\/insights\/([a-z-]+)$/);
        if(featurePath) return send(200,await insights(user,featurePath[1],featurePath[2],req.method,req.method==='GET'?{}:parseJson(await readBody(req,100000))));
        const archivePath = apiPath.match(/^\/projects\/([^/]+)\/archive$/);
        if (archivePath && req.method === "POST") {
          const input = parseJson(await readBody(req,4096));
          const pid = archivePath[1], row = requireProject(db,pid,user.id);
          if (row.role !== "owner") throw error(403,"Архивировать проект может только владелец");
          if (typeof input?.archived !== "boolean" || input.revision !== row.revision) throw error(409,"Обновите проект перед изменением");
          if (db.raw.prepare("SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','running')").get(pid)) throw error(409,"Сначала завершите или отмените фоновые задачи");
          const p=JSON.parse(row.data);p.archived=input.archived;p.revision++;
          p.audit=[...p.audit.slice(-999),{id:crypto.randomUUID(),at:new Date().toISOString(),action:p.archived?"Проект архивирован":"Проект восстановлен",target:p.name,actor:user.name}];
          db.raw.prepare("UPDATE projects SET data=?,revision=?,updated_at=? WHERE id=?").run(JSON.stringify(p),p.revision,new Date().toISOString(),pid);
          return send(200,{...p,role:row.role});
        }
        const jp = apiPath.match(
            /^\/projects\/([^/]+)\/(jobs|generate|documents|export|auto-runs|semantic-index)$/,
          ),
          cancel = apiPath.match(/^\/jobs\/([^/]+)\/cancel$/);
        if (cancel && req.method === "POST")
          return send(200, jobs.cancel(user, cancel[1]));
        if (jp) {
          const [, pid, action] = jp;
          if(action==='semantic-index'&&req.method==='POST')return send(202,jobs.index(user,pid));
          if (action === "auto-runs" && req.method === "GET") return send(200,jobs.autoRuns(user,pid));
          if (action === "auto-runs" && req.method === "POST") return send(202,jobs.run(user,pid,parseJson(await readBody(req,20000))));
          if (action === "jobs" && req.method === "GET")
            return send(200, jobs.list(user, pid));
          if (action === "generate" && req.method === "POST")
            return send(
              202,
              jobs.generate(user, pid, parseJson(await readBody(req, 200000))),
            );
          if (action === "documents" && req.method === "POST") {
            requireProject(db, pid, user.id, true);
            const raw = await readBody(req, 11 * 1024 * 1024);
            const form = await new Request(origin + path, {
              method: "POST",
              headers: { "Content-Type": req.headers["content-type"] || "" },
              body: raw,
            }).formData();
            const file = form.get("file");
            if (!file || typeof file === "string")
              throw error(400, "Файл не передан");
            return send(
              202,
              jobs.import(
                user,
                pid,
                file.name,
                Buffer.from(await file.arrayBuffer()),
              ),
            );
          }
          if (action === "export" && req.method === "GET") {
            const p = JSON.parse(requireProject(db, pid, user.id).data),
              zip = new JSZip();
            zip.file("project.json", JSON.stringify(p, null, 2));
            p.cases.forEach((t, i) => {
              const n = String(i + 1).padStart(3, "0");
              zip.file(`features/test_${n}.feature`, t.gherkin);
              for (const [framework, code] of Object.entries(t.artifacts || {})) {
                if (code) zip.file(`tests/${framework}/test_${n}.${framework === "pytest" ? "py" : "spec.js"}`,code);
              }
              if (t.code)
                zip.file(
                  `tests/test_${n}.${{ pytest: "py", playwright: "spec.js", junit: "java" }[t.framework]}`,
                  t.code,
                );
            });
            for (const source of p.sources) zip.file(`sources/${source.name.split(/[\\/]/).at(-1)}`,source.text);
            zip.file("auto-runs.json",JSON.stringify(jobs.autoRuns(user,pid),null,2));
            for(const record of db.raw.prepare("SELECT id,data FROM ai_feature_records WHERE project_id=? AND kind='report'").all(pid)) zip.file(`bug-reports/${record.id}.md`,JSON.parse(record.data).markdown);
            res.writeHead(200, {
              "Content-Type": "application/zip",
              "Content-Disposition":
                'attachment; filename="qa-atlas-export.zip"',
              "Cache-Control": "no-store",
            });
            return res.end(await zip.generateAsync({ type: "nodebuffer" }));
          }
          throw error(405, "Метод не поддерживается");
        }
        // Only session data may supply the identity used by the workspace handler.
        const headers = new Headers({
          "Content-Type": "application/json",
          "oai-authenticated-user-id": user.id,
          "oai-authenticated-user-email": user.email,
          "oai-authenticated-user-full-name": encodeURIComponent(user.name),
          "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
        });
        if (req.headers.origin) headers.set("origin", req.headers.origin);
        const body = ["GET", "HEAD"].includes(req.method)
          ? undefined
          : await readBody(req, 8_000_000);
        const response = await handleWorkspace(
          new Request(origin + "/workspace-api" + apiPath + url.search, {
            method: req.method,
            headers,
            body,
          }),
          db,
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw error(404, "Маршрут не найден");
      let file = resolve(staticDir, "." + decodeURIComponent(path));
      if (file !== staticDir && !file.startsWith(staticDir + "/"))
        throw error(404, "Не найдено");
      if (path === "/" || path === "/login")
        file = resolve(staticDir, "index.html");
      try {
        if (!(await stat(file)).isFile()) throw new Error();
      } catch {
        throw error(404, "Файл не найден");
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] || "application/octet-stream",
        "Cache-Control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = e.status || (e.name === "ZodError" ? 400 : 500);
      send(status, {
        detail:
          status === 500
            ? "Внутренняя ошибка сервера"
            : e.name === "ZodError"
              ? "Некорректные поля запроса"
              : e.message,
      });
      if (status === 500) {
        // Error names alone hide PostgreSQL failures (e.g. SQLSTATE 22003).
        // Never log request payloads, credentials, cookies or SQL parameters.
        const sqlstate = typeof e.code === "string" && /^[A-Z0-9]{5}$/.test(e.code)
          ? e.code : "unknown";
        const detail = e instanceof Error ? e.message : String(e);
        console.error("Request failed:", req.method,
          (req.url || "").split("?")[0],
          "SQLSTATE=" + sqlstate,
          "reason=" + detail.replace(/[\r\n]+/g, " ").slice(0, 350));
      }
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return {
    server,
    db,
    close: () => {
      jobs.close();
      return new Promise((resolve) =>
        server.close(() => {
          db.close();
          resolve();
        }),
      );
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const app = createServer();
  app.server.listen(
    Number(process.env.PORT || 8080),
    process.env.HOST || "127.0.0.1",
    () => console.log("QA Atlas backend ready"),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      app.close().then(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    });
}
