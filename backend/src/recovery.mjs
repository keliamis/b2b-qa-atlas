import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { digest, normalizeEmail, passwordHash, error } from './auth.mjs';

export function createRecovery(db, origin, deliver) {
  const configured = Boolean(deliver || (process.env.SMTP_HOST && process.env.SMTP_FROM));
  const transport = configured && !deliver ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', requireTLS: process.env.SMTP_SECURE !== 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, socketTimeout: 15000,
  }) : null;
  const send = deliver || (message => transport.sendMail({from:process.env.SMTP_FROM,...message}));
  function rate(ip) {
    const now = Date.now(), key = 'recovery:' + digest(ip || 'unknown');
    db.raw.prepare('DELETE FROM login_attempts WHERE expires_at<?').run(now);
    if ((db.raw.prepare('SELECT count FROM login_attempts WHERE key=?').get(key)?.count || 0) >= 10)
      throw error(429, 'Слишком много запросов. Повторите через 15 минут');
    db.raw.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=login_attempts.count+1').run(key,now+900000);
  }
  function tokenRow(input, purpose) {
    if (typeof input?.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token))
      throw error(400,'Ссылка недействительна или истекла');
    const row = db.raw.prepare('SELECT t.* FROM account_tokens t JOIN accounts a ON a.id=t.user_id WHERE token_hash=? AND purpose=? AND expires_at>? AND a.disabled=0').get(digest(input.token),purpose,Date.now());
    if (!row) throw error(400,'Ссылка недействительна или истекла');
    return row;
  }
  return {
    configured,
    async request(input, ip, purpose='reset') {
      if (!configured) throw error(503,'Почтовый сервис не настроен. Обратитесь к администратору');
      if (typeof input?.email !== 'string' || input.email.length > 254) throw error(400,'Укажите корректную почту');
      rate(ip);
      const user = db.raw.prepare('SELECT * FROM accounts WHERE email=? AND disabled=0').get(normalizeEmail(input.email));
      // Same response for existing and absent accounts. No token is returned by API.
      if (user && !(purpose === 'verify' && user.email_verified_at)) {
        const token = randomBytes(32).toString('hex'), hash = digest(token);
        db.raw.prepare('DELETE FROM account_tokens WHERE expires_at<?').run(Date.now());
        db.raw.prepare('INSERT INTO account_tokens VALUES(?,?,?,?)').run(hash,user.id,purpose,Date.now()+1800000);
        const url = origin + '/login#' + purpose + '=' + token;
        try {
          await send({to:user.email,subject:purpose==='reset'?'QA Atlas: восстановление пароля':'QA Atlas: подтверждение почты',
            text:`${purpose==='reset'?'Чтобы задать новый пароль':'Чтобы подтвердить почту'}, откройте ссылку:\n${url}\n\nСсылка действует 30 минут и используется один раз. Если вы не отправляли запрос, проигнорируйте письмо.`});
        } catch {
          db.raw.prepare('DELETE FROM account_tokens WHERE token_hash=?').run(hash);
          // Do not leak account existence or SMTP secrets to an anonymous caller.
          console.error('Account email delivery failed');
        }
      }
      return {ok:true, message:'Если адрес зарегистрирован, письмо отправлено. Проверьте входящие и папку «Спам».'};
    },
    async reset(input) {
      const row = tokenRow(input,'reset');
      if (input.password !== input.confirmPassword) throw error(400,'Пароли не совпадают');
      const hash = await passwordHash(input.password);
      db.raw.exec('BEGIN IMMEDIATE');
      try {
        // Recheck after asynchronous hashing to prevent concurrent token reuse.
        tokenRow(input,'reset');
        db.raw.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(hash,row.user_id);
        db.raw.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
        db.raw.prepare('DELETE FROM account_tokens WHERE user_id=? AND purpose=?').run(row.user_id,'reset');
        db.raw.exec('COMMIT');
      } catch(e) { db.raw.exec('ROLLBACK'); throw e; }
      return {ok:true,message:'Пароль изменён. Войдите с новым паролем.'};
    },
    verify(input) {
      const row=tokenRow(input,'verify');
      db.raw.exec('BEGIN IMMEDIATE');
      try {
        db.raw.prepare('UPDATE accounts SET email_verified_at=? WHERE id=?').run(new Date().toISOString(),row.user_id);
        db.raw.prepare('DELETE FROM account_tokens WHERE user_id=? AND purpose=?').run(row.user_id,'verify');
        db.raw.exec('COMMIT');
      } catch(e) { db.raw.exec('ROLLBACK'); throw e; }
      return {ok:true,message:'Почта подтверждена. Вы можете войти.'};
    },
  };
}
