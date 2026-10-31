import os,base64,io
os.environ['ML_TOKEN']='test-secret'
os.environ.pop('OPENAI_API_KEY',None)
from fastapi.testclient import TestClient
from app.main import app
from app.documents import extract
from docx import Document
from pypdf import PdfWriter
client=TestClient(app)
headers={'Authorization':'Bearer test-secret'}
def test_service_requires_its_own_secret():
    assert client.post('/parse',json={'name':'x.txt','data':'eA=='}).status_code==401
    assert client.get('/health').status_code==200

def test_text_import():
    r=client.post('/parse',json={'name':'x.txt','data':base64.b64encode('Настоящее требование'.encode()).decode()},headers=headers)
    assert r.status_code==200
    assert r.json()['text']=='Настоящее требование'

def test_docx_import():
    doc=Document();doc.add_paragraph('Проверка документа');raw=io.BytesIO();doc.save(raw)
    assert 'Проверка документа' in extract('spec.docx',raw.getvalue())

def test_blank_pdf_is_not_reported_as_success():
    writer=PdfWriter();writer.add_blank_page(width=100,height=100);raw=io.BytesIO();writer.write(raw)
    r=client.post('/parse',json={'name':'scan.pdf','data':base64.b64encode(raw.getvalue()).decode()},headers=headers)
    assert r.status_code==400
    assert 'OCR' in r.json()['detail']

def test_unconfigured_ai_does_not_fake_generation():
    r=client.post('/generate',json={},headers=headers)
    assert r.status_code==400
    assert 'ИИ не подключён' in r.json()['detail']
