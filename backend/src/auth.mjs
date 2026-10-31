import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const digest = (s) => createHash("sha256").update(s).digest("hex");
export const normalizeEmail = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();
export const error = (status, message) =>
  Object.assign(new Error(message), { status });
export async function passwordHash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw error(400, "Пароль должен содержать от 12 до 128 символов");
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return salt + ":" + hash.toString("hex");
}
async function matches(password, stored) {
  const [salt, hex] = stored.split(":");
  const hash = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
export async function createAccount(db, email, name, password) {
  email = normalizeEmail(email);
  name = String(name || "").trim();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !name ||
    name.length > 120
  )
    throw error(400, "Укажите корректную почту и имя до 120 символов");
  if (db.raw.prepare("SELECT id FROM accounts WHERE email=?").get(email))
    throw error(409, "Этот аккаунт уже существует");
  const id = randomUUID();
  const hashed = await passwordHash(password);
  try {
  db.raw
    .prepare(
      "INSERT INTO accounts(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)",
    )
    .run(
      id,
      email,
      name,
      hashed,
      new Date().toISOString(),
    );
  } catch (exc) {
    // Another request may insert the same email while scrypt is awaiting.
    if (db.raw.prepare("SELECT id FROM accounts WHERE email=?").get(email))
      throw error(409, "Этот аккаунт уже существует");
    throw exc;
  }
  return { id, email, name };
}

// Self-service registration. Accounts are persistent and use the same session
// and project permission checks as administrator-provisioned users.
let activeRegistrations = 0;
export async function register(db, input, ip) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw error(400, "Укажите имя, почту и пароль");
  const email = normalizeEmail(input.email);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const password = input.password;
  if (typeof input.email !== "string" || typeof input.name !== "string" ||
      typeof password !== "string")
    throw error(400, "Укажите имя, почту и пароль");
  if (password !== input.confirmPassword)
    throw error(400, "Пароли не совпадают");
  const now = Date.now();
  const key = "register-ip:" + digest(ip || "unknown");
  const emailKey = "register-email:" + digest(email);
  db.raw.prepare("DELETE FROM login_attempts WHERE expires_at<?").run(now);
  const used = db.raw.prepare("SELECT count FROM login_attempts WHERE key=?").get(key)?.count || 0;
  const emailUsed = db.raw.prepare("SELECT count FROM login_attempts WHERE key=?").get(emailKey)?.count || 0;
  if (used >= 100 || emailUsed >= 5 || activeRegistrations >= 4)
    throw error(429, "Слишком много регистраций. Повторите позже");
  const track = db.raw.prepare("INSERT INTO login_attempts(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=login_attempts.count+1");
  track.run(key, now+60*60*1000);
  track.run(emailKey,now+60*60*1000);
  activeRegistrations++;
  try {
    const user = await createAccount(db, email, name, password);
    const token = randomBytes(32).toString("hex");
    db.raw.prepare("INSERT INTO sessions VALUES(?,?,?)").run(digest(token),user.id,now+7*24*60*60*1000);
    return { user, token };
  } finally {
    activeRegistrations--;
  }
}

export function currentUser(db, req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("qa_session="))
    ?.slice(11);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (
    db.raw
      .prepare(
        "SELECT a.id,a.email,a.name FROM accounts a JOIN sessions s ON s.user_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND a.disabled=0",
      )
      .get(digest(token), Date.now()) || null
  );
}
export function sameOrigin(req, origin) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  if (req.headers.origin !== origin)
    throw error(403, "Запрос разрешён только со страницы QA Atlas");
}
let activeLogins = 0;
export async function login(db, input, ip) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw error(400, "Укажите почту и пароль");
  const email = normalizeEmail(input.email),
    password = input.password;
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    email.length > 254
  )
    throw error(401, "Неверная почта или пароль");
  const now = Date.now();
  db.raw.prepare("DELETE FROM login_attempts WHERE expires_at<?").run(now);
  db.raw.prepare("DELETE FROM sessions WHERE expires_at<?").run(now);
  const keys = [
    ["email:" + digest(email), 12],
    ["ip:" + digest(ip || "unknown"), 100],
  ];
  for (const [key, limit] of keys) {
    const row = db.raw
      .prepare("SELECT count FROM login_attempts WHERE key=?")
      .get(key);
    if (row?.count >= limit)
      throw error(429, "Слишком много попыток. Повторите через 15 минут");
  }
  if (activeLogins >= 8) throw error(429, "Сервер занят. Повторите вход позже");
  for (const [key] of keys)
    db.raw
      .prepare(
        "INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=login_attempts.count+1",
      )
      .run(key, now + 15 * 60 * 1000);
  activeLogins++;
  try {
    const user = db.raw
      .prepare("SELECT * FROM accounts WHERE email=?")
      .get(email);
    const fake = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await matches(password, user?.password_hash || fake);
    if (!valid || !user || user.disabled)
      throw error(401, "Неверная почта или пароль");
    db.raw.prepare("DELETE FROM login_attempts WHERE key=?").run(keys[0][0]);
    const token = randomBytes(32).toString("hex");
    db.raw
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(digest(token), user.id, now + 7 * 24 * 60 * 60 * 1000);
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  } finally {
    activeLogins--;
  }
}
export function logout(db, req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("qa_session="))
    ?.slice(11);
  if (token)
    db.raw
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(digest(token));
}
export function cookie(token, secure, clear = false) {
  return `qa_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${secure ? "; Secure" : ""}`;
}
