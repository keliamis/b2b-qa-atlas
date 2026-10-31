from pathlib import Path
from app.documents import extract


def test_import_pdf_more_than_50_pages():
    fixture=Path(__file__).resolve().parents[2] / 'examples' / 'long-document' / 'requirements_51_pages.pdf'
    text=extract('requirements_51_pages.pdf',fixture.read_bytes())
    assert '[Страница 1]' in text
    assert '[Страница 25]' in text
    assert '[Страница 51]' in text
    assert 'REQ-001' in text
    assert 'REQ-025' in text
    assert 'REQ-051' in text


def test_authenticated_parse_api_for_large_pdf(monkeypatch):
    import base64
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.setenv('ML_TOKEN', 'test-large-document-secret')
    fixture=Path(__file__).resolve().parents[2] / 'examples' / 'long-document' / 'requirements_51_pages.pdf'
    response=TestClient(app).post('/parse',headers={'Authorization':'Bearer test-large-document-secret'},json={
        'name':'requirements_51_pages.pdf',
        'data':base64.b64encode(fixture.read_bytes()).decode('ascii'),
    })
    assert response.status_code == 200
    assert 'REQ-051' in response.json()['text']
