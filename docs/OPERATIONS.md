# Запуск, обновления и восстановление

Команды выполняются из корня `qa-atlas-selfhost`. Если требуется sudo для Docker, добавляйте его перед `docker`.

## Статус и диагностика

```bash
docker compose ps
docker compose logs --tail=100 backend
docker compose logs --tail=100 ml-service
curl http://127.0.0.1:8080/health
```

Для HTTPS-прокси: `docker compose logs --tail=100 proxy`. `/health` должен возвращать JSON со статусом `ok`. Это проверяет backend и базу; готовность ML видна отдельно в `docker compose ps`. Не выкладывайте в публичный чат содержимое `.env` или полный вывод `docker compose config`: в них могут быть ключи. Для проверки конфигурации используйте `docker compose config --quiet`.

| Проблема | Что проверить |
|---|---|
| `docker: command not found` | Установлен ли Docker; откройте новый терминал после установки |
| `Cannot connect to Docker daemon` | Запущен ли Docker Desktop/служба Docker |
| `permission denied` для Docker socket | Используйте sudo или попросите администратора выдать права |
| `PUBLIC_ORIGIN` / `ML_TOKEN` required | Выполните `python3 scripts/init_env.py` в корне проекта |
| Ошибка «.env уже существует» | Это защита от случайной замены. Отредактируйте существующий файл |
| `address already in use` | Порт 8080, 80 или 443 занят другим приложением; не останавливайте чужой сервис вслепую |
| 403 при входе/сохранении | Адрес браузера должен в точности совпадать с `PUBLIC_ORIGIN`: протокол, домен, порт |
| Неверная почта или пароль | Можно зарегистрироваться самостоятельно на странице входа; для старых аккаунтов также работает CLI. Проверьте пароль и не отключён ли аккаунт |
| 429 при входе | Достигнут лимит попыток; подождите 15 минут |
| 401 после нескольких дней | Сессия действует 7 дней; войдите заново |
| Ссылка приглашения не принимается | Войдите под почтой из приглашения; ссылка действует 7 дней и может быть отозвана |
| Генерация не подключена | Заполнены ли `OPENAI_API_KEY`, `OPENAI_MODEL`; пересозданы ли оба контейнера |
| Импорт/генерация завершились ошибкой | См. сообщение в фоновых задачах; проверьте `ml-service`, формат документа, сеть и доступ к модели |
| Конфликт версий | Обновите проект и повторите изменения; новые данные команды не перезаписываются автоматически |
| PDF пустой | Если это скан без текстового слоя, нужен OCR; он не входит в сборку |
| Нет HTTPS-сертификата | DNS A/AAAA, доступность портов 80/443, логи Caddy, отсутствие другого прокси на тех же портах |
| Исчезли проекты после переноса | Новая установка создаёт новую базу. Используйте восстановление полного backup или импорт `project.json` |

## Повседневные команды

Запустить существующие контейнеры:

```bash
docker compose up -d
```

Для полного запуска с HTTPS: `docker compose --profile https up -d`.

Остановить приложение, сохранив тома данных:

```bash
docker compose --profile https down
```

**Не добавляйте `-v`: `down -v` удаляет тома с базой и резервными копиями.** Резервную копию дополнительно храните вне этого сервера.

## Резервная копия

Пример имени ниже заменяйте на новое при каждом сохранении. Скрипт откажется перезаписывать существующую копию.

```bash
docker compose exec backend node backend/src/backup.mjs /backups/qa-atlas-2026-10-21.sqlite
mkdir -p backups
docker compose cp backend:/backups/qa-atlas-2026-10-21.sqlite ./backups/qa-atlas-2026-10-21.sqlite
```

Первый шаг создаёт согласованный снимок SQLite, включая аккаунты, проекты, участников, комментарии, прогоны, дефекты, представления и задания. Второй копирует его из Docker-тома в папку на сервере. API-ключи находятся отдельно в `.env` и в базе не хранятся. Защитите и сохраните `.env` отдельно.

На своём компьютере скопируйте файл с сервера:

```bash
scp USER@SERVER_IP:/opt/qa-atlas/qa-atlas-selfhost/backups/qa-atlas-2026-10-21.sqlite .
```

Backup содержит приватные данные и хеши паролей. Храните его в закрытом месте. Не добавляйте `backups/` в Git. Не копируйте только живой файл `qa-atlas.sqlite` вручную: SQLite использует WAL, поэтому применяйте скрипт backup.

## Восстановление

Сначала убедитесь, что backup действительно доступен в контейнере по `/backups/ИМЯ.sqlite`. Если копия у вас на компьютере, передайте её серверу через scp, затем в существующий контейнер:

```bash
docker compose cp ./backups/qa-atlas-2026-10-21.sqlite backend:/backups/restore.sqlite
```

Для восстановления:

```bash
docker compose stop backend
docker compose run --rm --no-deps backend node backend/src/restore.mjs /backups/restore.sqlite
docker compose up -d backend
```

Если используете уже созданный backup из тома, укажите его настоящее имя вместо `restore.sqlite`. Скрипт сначала проверяет целостность и основные таблицы, сохраняет предыдущую базу рядом с меткой `before-restore`, затем заменяет рабочую. Изменения после момента backup в восстановленной базе отсутствуют. Старый файл не удаляется автоматически.

Если остались `-wal`/`-shm`, скрипт остановится: убедитесь, что backend корректно завершён и никакая другая программа не открыла базу. Не удаляйте WAL вручную. На полностью новом сервере сначала разверните контейнеры, чтобы появился сервис и тома, затем скопируйте backup и выполните восстановление. Копию нужно хранить отдельно, а не только в Docker-томе старого сервера.

## Обновление кода

1. Сделайте backup и скопируйте его за пределы Docker-тома.
2. Получите согласованные изменения из Git. Не заменяйте рабочий `.env` на `.env.example`.
3. Пересоберите и перезапустите:

```bash
docker compose --profile https up -d --build
```

4. Проверьте `docker compose ps`, вход, проект и ручной прогон.

Существующие миграции SQL не редактируют после использования. Для изменения схемы добавляют следующий файл, например `0004_...sql`. Новые миграции применяются при старте backend транзакционно. Возвращение старого кода после изменения схемы не равно откату базы: при несовместимой миграции нужен соответствующий backup.

Если изменили только `.env`, для применения значений нужен `up -d --force-recreate`, а не обычный `restart`.

## Перенос проектов из прежней версии QA Atlas

В старом интерфейсе экспортируйте проект в ZIP и извлеките `project.json`. Создайте аккаунт будущего владельца на новом сервере. Передайте JSON в контейнер:

```bash
docker compose cp ./project.json backend:/data/import-project.json
docker compose exec backend node backend/src/import-project.mjs anna@example.ru /data/import-project.json
```

Создаётся отдельная копия с новым ID, с сохранением требований, тестов, исходников и связей. Назначения старых пользователей и журнал изменений сбрасываются, потому что учётные записи на новом сервере имеют другие ID. Данные старого сайта не удаляются. Экспорт `project.json` не содержит историю командных прогонов, комментарии и дефекты; их автоматический перенос из Sites не реализован. Для переносов между экземплярами этой self-hosted сборки используйте полный backup SQLite.

## Разработка без Docker

Нужны Node.js 24.12+ в ветке 24 и Python 3.12. Все npm-команды запускаются из корня, один lockfile обслуживает frontend и backend.

```bash
npm ci
python3 scripts/init_env.py
npm run typecheck
npm run build
npm run user -- create anna@example.ru "Анна"
npm start
```

`npm start` запускает собранный интерфейс и backend на http://localhost:8080. База создаётся в `data/`, если не задан `DB_PATH`.

Для ML на Linux/macOS, во втором терминале:

```bash
python3 -m venv .venv
.venv/bin/pip install -r ml-service/requirements.lock.txt
.venv/bin/pip install python-dotenv
.venv/bin/python -m uvicorn app.main:app --app-dir ml-service --env-file .env --host 127.0.0.1 --port 8000
```

На Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r ml-service/requirements.lock.txt
.venv\Scripts\python -m pip install python-dotenv
.venv\Scripts\python -m uvicorn app.main:app --app-dir ml-service --env-file .env --host 127.0.0.1 --port 8000
```

Этот сервис должен получить тот же `ML_TOKEN`, что backend; `--env-file .env` загружает его. Ключ для импорта TXT/PDF/DOCX не нужен.

Для живого редактирования frontend остановите backend, измените в локальном `.env` **только** `PUBLIC_ORIGIN=http://localhost:5173`, запустите backend снова, затем в третьем терминале:

```bash
npm run dev:frontend
```

Открывайте http://localhost:5173. Vite проксирует API-запросы на порт 8080. Если вернётесь к собранной версии на 8080, верните `PUBLIC_ORIGIN` и перезапустите backend. Изменения backend TS требуют повторного `npm run build`; изменения JS требуют перезапуска backend. Это локальный режим разработки, не команда production-запуска.

Проверки:

```bash
npm run typecheck
npm run build
npm test
```

Python-проверки после установки `pytest` в виртуальное окружение:

```bash
PYTHONPATH=ml-service .venv/bin/python -m pytest ml-service/tests -q
```

Windows: `$env:PYTHONPATH="ml-service"`, затем `.venv\Scripts\python -m pytest ml-service/tests -q`.

Отмена фоновой задачи запрещает применить её результат к проекту. Уже начатый запрос к провайдеру не обязательно останавливается; это не гарантирует отмену списания API-бюджета. После перезапуска backend прерванные задачи помечаются ошибкой и могут быть запущены вручную повторно, а ещё не начатые остаются в очереди.
