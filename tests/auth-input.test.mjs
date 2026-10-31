import test from "node:test";
import assert from "node:assert/strict";
import { login, register, passwordHash, normalizeEmail } from "../backend/src/auth.mjs";

test("login rejects malformed bodies without unhandled TypeError", async () => {
  for (const value of [null, undefined, [], "", 7]) {
    await assert.rejects(() => login(null, value, "127.0.0.1"),
      (err) => err.status === 400 && err.message === "Укажите почту и пароль");
  }
});

test("register rejects invalid shapes before database calls", async () => {
  for (const value of [null, undefined, [], "", 7]) {
    await assert.rejects(() => register(null, value, "127.0.0.1"),
      (err) => err.status === 400);
  }
});

test("password hashing requires 12 to 128 chars", async () => {
  await assert.rejects(() => passwordHash("short"), (err) => err.status === 400);
  assert.match(await passwordHash("a secure test password"), /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(normalizeEmail("  USER@EXAMPLE.TEST "), "user@example.test");
});
