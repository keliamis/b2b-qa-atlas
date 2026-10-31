"""P0 regression: list conditions and decimals are not main requirements."""
from io import BytesIO
from docx import Document
from app.documents import extract, requirements_from_text


def content_51():
    parts = []
    for page in range(1, 52):
        parts.append(f'[Страница {page}]')
        parts.append(f'REQ-{page:03d} — Проверка лимита операции номер {page}')
        parts.append('1. Сумма 109.99 возвращает LOW и комиссию 0.00.')
        parts.append('2. Сумма 110.00 возвращает HIGH и комиссию 2.20.')
        parts.append('3. Отрицательная сумма вызывает ValueError.')
    return '\n'.join(parts)


def test_51_main_not_153_fragments():
    units = requirements_from_text(content_51())
    assert len(units) == 51
    assert [r['originalId'] for r in units] == [f'REQ-{n:03d}' for n in range(1, 52)]
    assert all(r['extraction'] == 'explicit' for r in units)
    assert all(len(r['conditions']) == 3 for r in units)
    assert units[0]['page'] == units[0]['pageEnd'] == 1
    assert units[24]['page'] == 25
    assert units[-1]['page'] == units[-1]['pageEnd'] == 51
    assert all('109.99' in r['text'] and '110.00' in r['text'] and '2.20' in r['text'] for r in units)


def test_requirement_continues_on_next_page():
    content = ('[Страница 1]\nREQ-001 — Возвраты\n1. Сумма 109.99 возвращает LOW.\n'
               '[Страница 2]\n2. Сумма 110.00 возвращает HIGH.\n'
               '3. Отрицательная сумма вызывает ValueError.\n'
               'REQ-002 — Следующее требование\n1. Система должна быть доступна.')
    units = requirements_from_text(content)
    assert len(units) == 2
    assert (units[0]['page'], units[0]['pageEnd']) == (1, 2)
    assert len(units[0]['conditions']) == 3
    assert (units[1]['page'], units[1]['pageEnd']) == (2, 2)


def test_repeated_heading_is_merged_not_doubled():
    content = ('[Страница 1]\nREQ-001 — Обработка\n1. Сумма 109.99 возвращает LOW.\n'
               '[Страница 2]\nREQ-001 — Обработка\n2. Сумма 110.00 возвращает HIGH.\n'
               'REQ-002 — Другое\n3. Условие должно выполняться.')
    units = requirements_from_text(content)
    assert len(units) == 2
    assert units[0]['text'].count('REQ-001') == 1
    assert units[0]['text'].count('109.99') == 1
    assert units[0]['text'].count('110.00') == 1
    assert units[0]['pageEnd'] == 2


def test_no_ids_numbered_list_is_reviewed_as_one_block():
    content = ('Руководство\n1. Система принимает сумму 109.99.\n'
               '2. Система возвращает 2.20 и должна рассчитать комиссию.\n'
               '3. Отрицательная сумма вызывает ValueError.')
    units = requirements_from_text(content)
    assert len(units) == 1
    assert units[0]['extraction'] in {'heuristic', 'review'}
    assert '109.99' in units[0]['text']
    assert '2.20' in units[0]['text']


def test_markdown_and_txt_preserve_nested_conditions():
    content = 'REQ-001 — Правило\n1. Система должна вернуть 109.99.\n2. Значение 2.20 допустимо.'
    for name in ('rules.md', 'rules.txt'):
        parsed = requirements_from_text(extract(name, content.encode()))
        assert len(parsed) == 1
        assert len(parsed[0]['conditions']) == 2


def test_docx_preserves_nested_conditions():
    doc = Document()
    doc.add_paragraph('REQ-001 — Правило')
    doc.add_paragraph('1. Система должна вернуть 109.99.')
    doc.add_paragraph('2. Значение 2.20 допустимо.')
    file = BytesIO()
    doc.save(file)
    parsed = requirements_from_text(extract('rule.docx', file.getvalue()))
    assert len(parsed) == 1
    assert len(parsed[0]['conditions']) == 2


def test_real_pdf_51_pages_three_conditions_each():
    from pathlib import Path
    fixture = Path(__file__).parent / 'fixtures' / 'requirements_51_with_conditions.pdf'
    source = extract(fixture.name, fixture.read_bytes())
    units = requirements_from_text(source)
    assert source.count('[Страница ') == 51
    assert len(units) == 51
    assert [(u['originalId'], u['page']) for u in [units[0], units[24], units[-1]]] == [
        ('REQ-001', 1), ('REQ-025', 25), ('REQ-051', 51)]
    assert all('109.99' in u['text'] and '110.00' in u['text'] and '2.20' in u['text'] for u in units)
    assert all(len(u['conditions']) == 3 for u in units)


def test_docx_table_remains_between_requirement_headings():
    doc = Document()
    doc.add_paragraph('REQ-001 — First rule')
    table = doc.add_table(rows=1, cols=1)
    table.cell(0, 0).text = '1. System must return 109.99.'
    doc.add_paragraph('REQ-002 — Second rule')
    doc.add_paragraph('2. Other operation must return 2.20.')
    output = BytesIO()
    doc.save(output)
    units = requirements_from_text(extract('mixed.docx', output.getvalue()))
    assert len(units) == 2
    assert '109.99' in units[0]['text']
    assert '109.99' not in units[1]['text']
    assert '2.20' in units[1]['text']
