from .generator import generate


def main():
    payload = {
        "requirements": [
            {
                "id": "diagnostic-1",
                "title": "Обязательное поле",
                "text": (
                    "При отправке формы с пустым именем показывается "
                    "ошибка «Введите имя». "
                    "При заполненном имени форма принимается."
                ),
            }
        ],
        "sources": [],
        "framework": "pytest",
        "count": 1,
        "include_code": False,
    }

    print(
        "Проверка модели: один тест-кейс по демонстрационному требованию. "
        "Ожидайте ответа.",
        flush=True,
    )

    try:
        result = generate(payload)
    except ValueError as exc:
        print("ОШИБКА:", str(exc), flush=True)
        return 1
    except Exception as exc:
        print("ОШИБКА сервиса:", type(exc).name, flush=True)
        return 1

    if result["cases"]:
        print(
            "OK: модель ответила, JSON проверен, тест-кейс получен.",
            flush=True,
        )
        return 0

    print(
        "Модель доступна, но вернула уточняющие вопросы вместо теста.",
        flush=True,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())