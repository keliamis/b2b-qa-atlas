import { openDatabase } from "./database.mjs";
import { createAccount, passwordHash, normalizeEmail } from "./auth.mjs";
const [command, emailArg, ...nameParts] = process.argv.slice(2);
async function hidden(prompt) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Запустите команду в интерактивном терминале (docker compose exec без -T)",
    );
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (err) => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      err ? reject(err) : resolve(value);
    };
    const onData = (s) => {
      for (const c of s) {
        if (c === "\u0003") {
          done(new Error("Отменено"));
          return;
        }
        if (c === "\r" || c === "\n") {
          done();
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c >= " ") value += c;
      }
    };
    process.stdin.on("data", onData);
  });
}
const db = openDatabase();
try {
  if (command === "list") {
    console.table(
      db.raw
        .prepare("SELECT email,name,disabled FROM accounts ORDER BY email")
        .all(),
    );
  } else if (["create", "password"].includes(command) && emailArg) {
    const password = await hidden("Пароль (12–128 символов, ввод скрыт): ");
    const confirmation = await hidden("Повторите пароль: ");
    if (password !== confirmation) throw new Error("Пароли не совпали");
    if (command === "create") {
      await createAccount(
        db,
        emailArg,
        nameParts.join(" ") || emailArg,
        password,
      );
      console.log(
        "Аккаунт создан. Передайте пароль участнику лично. Вход:",
        normalizeEmail(emailArg),
      );
    } else {
      const user = db.raw
        .prepare("SELECT id FROM accounts WHERE email=?")
        .get(normalizeEmail(emailArg));
      if (!user) throw new Error("Аккаунт не найден");
      const hash = await passwordHash(password);
      db.raw.exec("BEGIN IMMEDIATE");
      try {
        db.raw
          .prepare("UPDATE accounts SET password_hash=? WHERE id=?")
          .run(hash, user.id);
        db.raw.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        db.raw.exec("COMMIT");
      } catch (e) {
        db.raw.exec("ROLLBACK");
        throw e;
      }
      console.log("Пароль изменён, старые сессии завершены");
    }
  } else if (command === "disable" && emailArg) {
    const user = db.raw
      .prepare("SELECT id FROM accounts WHERE email=?")
      .get(normalizeEmail(emailArg));
    if (!user) throw new Error("Аккаунт не найден");
    db.raw.prepare("UPDATE accounts SET disabled=1 WHERE id=?").run(user.id);
    db.raw.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    console.log("Вход отключён; проектные записи сохранены");
  } else
    throw new Error(
      'Команды: create EMAIL "Имя" | password EMAIL | disable EMAIL | list',
    );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
