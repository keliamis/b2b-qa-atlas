"""Intentional boundary defect for the AI Features walkthrough only."""
def total(amount):
    if not isinstance(amount, (int, float)) or isinstance(amount, bool) or amount < 0:
        raise ValueError('amount must be nonnegative')
    if amount > 5000:  # Deliberate defect: the specification says >=.
        return round(amount * .9, 2)
    if amount >= 1000:
        return round(amount * .95, 2)
    return round(amount, 2)
