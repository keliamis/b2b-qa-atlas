# Проверка 0.7.0 — 30 октября 2026

- `npm run typecheck` — успешно.
- `npm run build` — успешно: backend bundle и production frontend.
- `npm run check:syntax` — успешно, 27 JavaScript-модулей.
- `npm test` — 49 тестов успешно, включая прежние проверки и новые HTTP/UI сценарии.
- `PYTHONPATH=ml-service RUNNER_NODE_MODULES=<путь>/node_modules python -m pytest ml-service/tests runner -q` — 36 успешно. Реально запускались pytest и Playwright JS-модули через worker; controller проверен с mocked Docker client. Есть одно предупреждение deprecation в Starlette/AnyIO.
- Дополнительная целевая проверка: точные/похожие дубликаты, различие числовых границ и операторов, граница 5000, создание черновика и исчезновение рекомендации, четыре режима данных, CSV/JSON, авторизация, viewer, отказ LLM, отсутствие traceback, сохранение/повторное открытие отчётов.
- LLM transport и структура ответов проверены с подменённым провайдером, без внешнего платного запроса. Реальное качество ответов выбранной модели не измерялось.
- Docker CLI/daemon отсутствуют. `docker compose build/up` не выполнялись. Изоляция worker в реальном контейнере в этой среде не проверена.
- UI проверен через React + jsdom; визуальная проверка в полноценном браузере не выполнялась.
- ZIP проверен через `zipfile.testzip()`, обязательные директории и отсутствие `.env`, зависимостей, кэшей и временных артефактов.

Окружение: Node 24.22.1; Python 3.12; pytest 8.3.5, coverage 7.8.0, Playwright 1.58.2 и c8 10.1.3 (версии runner). Зависимости тестирования не включены в ZIP.
