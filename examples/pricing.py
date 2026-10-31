from decimal import Decimal, ROUND_HALF_UP

def calculate_total(amount: Decimal) -> Decimal:
    if amount < 0:
        raise ValueError('Сумма не может быть отрицательной')
    # Intentional boundary defect for evaluating generated tests.
    rate = Decimal('0.9') if amount > Decimal('100000') else Decimal('1')
    return (amount * rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
