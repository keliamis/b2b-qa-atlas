# QA Atlas 0.7.2 — результаты проверки в среде подготовки

Дата: 2026-10-30.

| Проверка | Результат |
|---|---|
| `PYTHONPATH=ml-service python -m pytest -q ml-service/tests` | PASS: 18 тестов |
| `node --test tests/long-document-import.test.mjs` | PASS: 4 теста |
| Извлечение настоящего PDF на 51 страницу | PASS: 51 страница, REQ-001/REQ-025/REQ-051 присутствуют |
| Разделение извлечённого текста на атомарные правила | PASS: 51 требование с исходными ключами |
| Проверка синтаксиса изменённых JS файлов `node --check` | PASS |
| Компиляция Python `python -m compileall` | PASS |
| Чтение `compose.yaml` с PyYAML | PASS, но это не тест Docker Compose |
| `npm ci --offline` | НЕ ПРОШЁЛ: недоступен кэш npm-пакетов |
| `npm ci` с сетью | НЕ ПРОШЁЛ: сбой npm и неподходящая версия Node.js 22 (в Dockerfile Node.js 24) |
| Полная сборка frontend/backend | НЕ ПРОВЕРЕНА из-за отсутствующих npm зависимостей |
| `docker compose up --build` | НЕ ПРОВЕРЕНА: нет Docker Engine |
| Реальный браузер, внешний LLM и 504 под нагрузкой | НЕ ПРОВЕРЕНЫ |

Полная приёмка должна проходить на компьютере с Docker Desktop и подключением к реестрам Docker/npm/PyPI.
Не удаляйте тома с существующими данными при обновлении.
