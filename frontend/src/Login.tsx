import { useState, useRef } from "react";
import { ArrowRight, ShieldCheck, Network, Eye, EyeOff } from "lucide-react";
import AccountRecovery from "./AccountRecovery";
export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const submitting = useRef(false);
  return (
    <main className="login-page">
      <section className="card login-card">
        <a className="brand" href="/">
          <span className="brand-symbol">
            <Network size={22} />
          </span>
          qa<span className="brand-light">atlas</span>
        </a>
        <div className="section-kicker">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <h1>{mode === "register" ? "Создайте аккаунт." : "С возвращением."}</h1>
        <p>{mode === "register" ? "Зарегистрируйтесь и начните работать с собственными проектами QA Atlas." : "Войдите в рабочее пространство."}</p>
        <form aria-busy={busy}
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current) return;
            submitting.current = true;
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              if (mode === "register" && f.get("password") !== f.get("confirmPassword"))
                throw new Error("Пароли не совпадают");
              const r = await fetch(mode === "register" ? "/auth/register" : "/auth/login", {
                method: "POST",
                signal: AbortSignal.timeout(15000),
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...(mode === "register" ? { name: f.get("name"), confirmPassword: f.get("confirmPassword") } : {}),
                  email: f.get("email"),
                  password: f.get("password"),
                }),
              });
              const data = await r.json().catch(() => ({detail:"Сервер вернул некорректный ответ"}));
              if (!r.ok) throw new Error(data.detail || "Не удалось войти");
              const target =
                new URLSearchParams(location.search).get("return_to") || "/";
              const url = new URL(target, location.origin);
              location.assign(
                url.origin === location.origin &&
                  target.startsWith("/") &&
                  !target.startsWith("//") &&
                  !url.pathname.startsWith("/auth") &&
                  !url.pathname.startsWith("/login")
                  ? url.pathname + url.search
                  : "/",
              );
            } catch (e) {
              setError((e as Error).name === "TimeoutError" ? "Сервер не ответил. Попробуйте ещё раз." : (e as Error).name === "TypeError" ? "Не удалось связаться с сервером. Проверьте соединение." : (e as Error).message);
              setBusy(false);
              submitting.current = false;
            }
          }}
        >
          <fieldset disabled={busy} className="auth-fields">
          {mode === "register" && <label>
            Имя или название команды
            <input name="name" required minLength={2} maxLength={120} autoComplete="name" placeholder="Ваше имя" />
          </label>}
          <label>
            Почта
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              placeholder="anna@company.ru"
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              minLength={mode === "register" ? 12 : undefined}
              maxLength={128}
            />
          </label>
          {mode === "register" && <>
            <label>Повторите пароль
              <input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} required />
            </label>
            <p className="text-muted">Минимум 12 символов. Используйте уникальный пароль.</p>
          </>}
          <button type="button" className="auth-reveal" aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>} {showPassword ? "Скрыть пароль" : "Показать пароль"}</button>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? (mode === "register" ? "Регистрируем…" : "Входим…") : (mode === "register" ? "Создать аккаунт" : "Войти")}
            <ArrowRight size={17} />
          </button>
          </fieldset>
        </form>
        <div className="notice subtle">
          <ShieldCheck size={19} />
          <span>Пароль хранится на сервере в виде защищённого хеша. Проекты видны только участникам.</span>
        </div>
        <button type="button" className="text-button" disabled={busy} onClick={() => {setError("");setShowPassword(false);setMode(mode === "login" ? "register" : "login");}}>
          {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
        </button>
        <AccountRecovery />
        <a className="text-button" href="/">
          Вернуться на главную
        </a>
      </section>
    </main>
  );
}
