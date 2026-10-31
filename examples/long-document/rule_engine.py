"""Синтетический модуль для проверки QA Atlas. В двух правилах намеренные дефекты."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

RULE_THRESHOLDS = {f"REQ-{i:03d}": Decimal(100 + 10 * i) for i in range(1, 52)}
CENT = Decimal("0.01")


def evaluate_rule(rule_id: str, amount):
    """Вычисляет комиссию по правилу из requirements_51_pages.pdf."""
    if rule_id not in RULE_THRESHOLDS:
        raise ValueError("Неизвестный идентификатор правила")
    if isinstance(amount, bool) or amount is None:
        raise ValueError("Недопустимая сумма")
    try:
        value = Decimal(str(amount))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("Недопустимая сумма") from exc
    if not value.is_finite() or value < 0:
        raise ValueError("Недопустимая сумма")
    threshold = RULE_THRESHOLDS[rule_id]
    # НАМЕРЕННЫЙ ДЕФЕКТ 1: REQ-025 при равенстве порогу ошибочно остаётся LOW.
    high = value > threshold if rule_id == "REQ-025" else value >= threshold
    status = "HIGH" if high else "LOW"
    fee = (value * Decimal("0.02")).quantize(CENT, rounding=ROUND_HALF_UP) if high else Decimal("0.00")
    # НАМЕРЕННЫЙ ДЕФЕКТ 2: REQ-051 применяет неверную ставку 3%.
    if rule_id == "REQ-051" and high:
        fee = (value * Decimal("0.03")).quantize(CENT, rounding=ROUND_HALF_UP)
    return {"rule_id": rule_id, "status": status, "fee": fee, "total": (value + fee).quantize(CENT, rounding=ROUND_HALF_UP)}
