# QA Atlas 0.7.5 — диагностика входа

В backend исправлено недостаточное логирование ошибок HTTP 500: теперь `docker compose logs backend` содержит SQLSTATE и сообщение ошибки без HTTP-тела запроса, cookie и параметров SQL. Ранее выводилось только `Error`.

Это **диагностическое обновление**, а не подтверждённое исправление причины отказа авторизации. Логи прежней версии не содержали фактической причины. Изменение не затрагивает данные или схему базы.

Проверить схему существующего PostgreSQL:

```powershell
docker compose exec postgres psql -U atlas -d atlas -c "SELECT table_name, data_type FROM information_schema.columns WHERE table_name IN ('sessions','login_attempts','account_tokens') AND column_name='expires_at' ORDER BY table_name;"
```

Ожидается `bigint` для всех трёх таблиц. Если осталось `integer`, версия 0.7.4+ выполняет миграцию при запуске. Не удаляйте тома БД.

После обновления и повторения ошибки:

```powershell
docker compose logs --since=2m backend
```

По `SQLSTATE` и `reason` можно установить первопричину и исправить её. Если файл `.env` содержит пароли или токены, не публикуйте его.
