"""Hand-written verification fixture; intentionally exposes the demo defect."""
from rule_engine import total

def test_below_discount():
    assert total(950) == 950

def test_boundary_defect():
    assert total(5000) == 4500

def test_above_discount():
    assert total(10000) == 9000
