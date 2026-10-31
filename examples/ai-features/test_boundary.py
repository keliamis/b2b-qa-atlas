from pricing import total

def test_exact_5000():
    assert total(5000.00) == 4500.00
