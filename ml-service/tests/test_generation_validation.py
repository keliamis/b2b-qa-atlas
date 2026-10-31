import json
from app import generator


def case(title='A', code='def test_a():\n    assert 1 == 1', gherkin=None):
    return dict(title=title, requirementIds=['r'],type='positive',priority='high',
                gherkin=gherkin or 'Feature: A\nScenario: '+title+'\nGiven item\nWhen check\nThen valid',
                code=code,assumptions=[])


def test_js_syntax_checked_without_execution(tmp_path):
    marker=tmp_path/'executed'
    assert generator._repair_code("const a = ;",'playwright') == ''
    code=f"import fs from 'node:fs'; fs.writeFileSync({json.dumps(str(marker))}, 'bad');"
    assert generator._repair_code(code,'playwright')
    assert not marker.exists()


def test_retry_preserves_valid_cases(monkeypatch):
    calls=[]
    good=case()
    bad=case('B','def broken(:','Feature: B\nScenario: B\nGiven other\nWhen run\nThen valid')
    fixed={**bad,'code':'def test_b():\n    assert 2 == 2'}
    def request(payload,*args):
        calls.append(payload)
        return json.dumps({'cases':[good,bad] if len(calls)==1 else [fixed],'questions':[]}), {'total_tokens':10}
    monkeypatch.setattr(generator,'_config',lambda:('key','model','https://example','openai'))
    monkeypatch.setattr(generator,'_request',request)
    result=generator.generate({'requirements':[{'id':'r'}],'count':2,'include_code':True,'framework':'pytest'})
    assert len(result['cases']) == 2
    assert calls[1]['count'] == 1
    assert calls[1]['existing_cases'][0]['title'] == 'A'
    assert result['usage']['total_tokens'] == 20


def test_renamed_duplicate_has_same_signature():
    assert generator._signature(case('A')['gherkin']) == generator._signature(case('B')['gherkin'])


def test_document_markdown_cannot_be_disguised_as_gherkin_then():
    import pytest
    with pytest.raises(ValueError, match='конкретное'):
        generator._normalize_gherkin('Feature: Shop\nScenario: A\nGiven выполнены предусловия требования\nWhen выполняется описанная операция\nThen # Документ', 'A')
