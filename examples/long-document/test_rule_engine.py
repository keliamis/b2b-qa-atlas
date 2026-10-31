"""51 параметризованная проверка порога плюс негативные тесты.
Ожидается 2 падения: REQ-025 и REQ-051 (демонстрационные дефекты).
"""
from decimal import Decimal
import pytest
from rule_engine import evaluate_rule, RULE_THRESHOLDS

@pytest.mark.parametrize("rule_id,threshold", list(RULE_THRESHOLDS.items()))
def test_exact_boundary(rule_id, threshold):
    result = evaluate_rule(rule_id, threshold)
    expected_fee = (threshold * Decimal("0.02")).quantize(Decimal("0.01"))
    assert result["status"] == "HIGH"
    assert result["fee"] == expected_fee

@pytest.mark.parametrize("rule_id,threshold", list(RULE_THRESHOLDS.items()))
def test_just_below_boundary(rule_id, threshold):
    result = evaluate_rule(rule_id, threshold - Decimal("0.01"))
    assert result["status"] == "LOW"
    assert result["fee"] == Decimal("0.00")

@pytest.mark.parametrize("bad", [-1, None, True, "oops", "NaN", "Infinity"])
def test_invalid_amount(bad):
    with pytest.raises(ValueError):
        evaluate_rule("REQ-001", bad)
