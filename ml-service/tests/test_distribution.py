"""Provider is mocked: verifies allocation/repair, not live AI quality."""
import json
from app import generator


def case(rid, n=1):
    return dict(title=f'Check {rid}/{n}', requirementIds=[rid], type='positive', priority='medium',
                gherkin=f'Given input {rid}/{n}\nWhen rule {rid} runs\nThen result is {n}',
                code='', assumptions=[])


def test_six_requirements_targeted_repair(monkeypatch):
    requests = []
    def request(payload, *args):
        requests.append(payload)
        cases = [case('r1', n) for n in range(6)] if len(requests) == 1 else [case(r['id']) for r in payload['requirements']]
        return json.dumps({'cases':cases, 'questions':[]}), {}
    monkeypatch.setattr(generator, '_config', lambda: ('key','model','https://test','openai'))
    monkeypatch.setattr(generator, '_request', request)
    result = generator.generate(dict(requirements=[{'id':f'r{i}'} for i in range(1,7)],count=6,include_code=False))
    assert len(requests) == 2
    assert {r['id'] for r in requests[1]['requirements']} == {f'r{i}' for i in range(2,7)}
    assert [c['requirementIds'][0] for c in result['cases']] == [f'r{i}' for i in range(1,7)]


def test_partial_survives_repair_failure(monkeypatch):
    calls=[]
    def request(payload, *args):
        calls.append(payload)
        if len(calls)>1: raise ValueError('provider unavailable')
        return json.dumps({'cases':[case('r1')], 'questions':[]}), {}
    monkeypatch.setattr(generator, '_config', lambda: ('key','model','https://test','openai'))
    monkeypatch.setattr(generator, '_request', request)
    result=generator.generate(dict(requirements=[{'id':'r1'},{'id':'r2'}],count=2,include_code=False))
    assert len(result['cases']) == 1
    assert 'r2' in ' '.join(result['questions'])


def test_req051_is_sent_in_full(monkeypatch):
    from app.documents import extract, requirements_from_text
    from pathlib import Path
    f=Path(__file__).parent/'fixtures/requirements_51_pages.pdf'
    last=requirements_from_text(extract(f.name,f.read_bytes()))[-1]
    req={**last,'id':'r51','key':'REQ-051'}
    def request(payload,*args):
        assert payload['requirements'][0]['text'] == last['text']
        assert payload['requirements'][0]['originalId'] == 'REQ-051'
        return json.dumps({'cases':[case('r51')], 'questions':[]}), {}
    monkeypatch.setattr(generator,'_config',lambda:('key','model','https://test','openai'))
    monkeypatch.setattr(generator,'_request',request)
    result=generator.generate(dict(requirements=[req],count=1,include_code=False))
    assert result['cases'][0]['requirementIds']==['r51']


def test_no_code_never_exposes_playwright_warnings(monkeypatch):
    calls=[]
    def request(payload,*args):
        calls.append(payload)
        items=[{**case('r1'), 'code':'// unwanted', 'artifacts': {'pytest': 'x', 'playwright': 'broken'}}]
        return json.dumps({'cases':items,'questions':['Не удалось создать Playwright-тест без браузера','Уточните тестовые данные']}), {}
    monkeypatch.setattr(generator,'_config',lambda:('key','model','https://test','openai'))
    monkeypatch.setattr(generator,'_request',request)
    result=generator.generate(dict(requirements=[{'id':'r1'}],count=1,framework='pytest',include_code=False))
    assert result['cases'][0]['code']==''
    assert result['cases'][0].get('artifacts') is None
    assert result['questions']==['Уточните тестовые данные']
    assert len(calls)==1


def test_pytest_ignores_invalid_unrequested_playwright_artifact(monkeypatch):
    def request(payload,*args):
        item={**case('r1'), 'code':'def test_valid():\n    assert True',
              'artifacts': {'pytest':'def test_valid():\n    assert True','playwright':'const bad = ;'}}
        return json.dumps({'cases':[item], 'questions':['Playwright test impossible']}), {}
    monkeypatch.setattr(generator,'_config',lambda:('key','model','https://test','openai'))
    monkeypatch.setattr(generator,'_request',request)
    result=generator.generate(dict(requirements=[{'id':'r1'}],count=1,framework='pytest',include_code=True))
    assert len(result['cases'])==1
    assert result['cases'][0]['artifacts']['playwright']==''
    assert result['cases'][0]['artifacts']['pytest'].startswith('def test_valid')
    assert not result['questions']
