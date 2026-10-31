"""Regression for the missing 51st-page requirement, including 120k+ chars."""
from pathlib import Path
import base64
from app.documents import extract, requirements_from_text
from app.main import app
from fastapi.testclient import TestClient

FIXTURE = Path(__file__).parent / 'fixtures' / 'requirements_51_pages.pdf'

def test_51_page_document_not_truncated():
    raw = FIXTURE.read_bytes()
    text = extract(FIXTURE.name, raw)
    requirements = requirements_from_text(text)
    assert len(text) > 120_000
    assert text.count('[Страница ') == 51
    assert len(requirements) == 51
    assert [(r['originalId'], r['page']) for r in (requirements[0],requirements[24],requirements[50])] == [
        ('REQ-001', 1), ('REQ-025', 25), ('REQ-051', 51)]

def test_51_page_parse_api(monkeypatch):
    monkeypatch.setenv('ML_TOKEN','test-pdf-token')
    response = TestClient(app).post('/parse',
        json={'name':FIXTURE.name, 'data':base64.b64encode(FIXTURE.read_bytes()).decode()},
        headers={'Authorization':'Bearer test-pdf-token'})
    assert response.status_code == 200, response.text[:200]
    assert response.json()['characters'] > 120_000
    assert response.json()['requirements'][-1]['originalId'] == 'REQ-051'

def test_multiple_requirements_one_page_and_page_metadata():
    body = '[Страница 1]\nREQ-001 Сервис должен работать.\nREQ-002 Данные должны сохраняться.\n[Страница 2]\nREQ-003 Ошибка должна отображаться.'
    units = requirements_from_text(body)
    assert [u['originalId'] for u in units] == ['REQ-001','REQ-002','REQ-003']
    assert [u['page'] for u in units] == [1,1,2]
