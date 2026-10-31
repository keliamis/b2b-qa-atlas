import json
from unittest.mock import patch
import httpx
import pytest

from app.generator import _config, _request, generate


def test_yandex_auth_and_chat_completions(monkeypatch):
    seen = {}

    def handler(request):
        seen['url'] = str(request.url)
        seen['auth'] = request.headers.get('Authorization')
        seen['data'] = json.loads(request.content)
        return httpx.Response(200, json={
            'choices': [{'message': {'content': json.dumps({'cases': [], 'questions': ['Нужен пример']})},
                         'finish_reason': 'stop'}],
            'usage': {'total_tokens': 10},
        })

    original = httpx.Client
    monkeypatch.setattr(httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setenv('AI_PROVIDER', 'yandex')
    monkeypatch.setenv('OPENAI_API_KEY', 'test-secret')
    monkeypatch.setenv('OPENAI_MODEL', 'gpt://folder/deepseek-v4-flash')
    monkeypatch.setenv('OPENAI_BASE_URL', 'https://ai.api.cloud.yandex.net/v1')
    result = generate({'requirements': [{'id': 'REQ-1', 'text': 'Проверка'}], 'count': 1, 'include_code': False,
                       'framework': 'pytest', 'sources': []})
    assert result['cases'] == []
    assert result['usage'] == {'total_tokens': 10}
    assert seen['url'].endswith('/v1/chat/completions')
    assert seen['auth'] == 'Api-Key test-secret'
    assert seen['data']['model'] == 'gpt://folder/deepseek-v4-flash'


def test_403_is_sanitized(monkeypatch):
    original = httpx.Client
    monkeypatch.setattr(httpx, 'Client', lambda **kwargs: original(
        transport=httpx.MockTransport(lambda req: httpx.Response(403, json={'detail':'secret-in-body'})), **kwargs))
    with pytest.raises(ValueError, match='HTTP 403') as exc:
        _request({'x': 1}, 'key', 'model', 'https://example.org/v1', 'yandex')
    assert 'secret-in-body' not in str(exc.value)


def test_missing_model(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test')
    monkeypatch.delenv('OPENAI_MODEL', raising=False)
    with pytest.raises(ValueError, match='OPENAI_MODEL'):
        _config()


def test_repair_escaped_python_code():
    from app.generator import _repair_code
    bad = r'import pytest\nfrom tasks import TaskManager\n\ndef test_create_task():\n    m = TaskManager()\n    assert m.create_task(\"Report\")[\"status\"] == \"new\"'
    repaired = _repair_code(bad, 'pytest')
    assert 'def test_create_task():' in repaired
    assert '\\n' not in repaired
    compile(repaired, 'generated.py', 'exec')
    assert _repair_code('def test_bad(:', 'pytest') == ''
    assert _repair_code('assert "\\n"', 'pytest') == 'assert "\\n"\n'


def test_deduplicate_generated_scenarios(monkeypatch):
    from app import generator
    gherkin = 'Feature: Task\nScenario: valid\nGiven task manager\nWhen task created\nThen state is new'
    raw = {'cases': [{'title': 'Task', 'requirementIds': ['r1'], 'type': 'positive',
                      'priority': 'high', 'gherkin': gherkin, 'code': r'def test_1():\n    assert 1==1',
                      'assumptions': []}], 'questions': []}
    monkeypatch.setattr(generator, '_config', lambda: ('key', 'model', 'https://test', 'openai'))
    monkeypatch.setattr(generator, '_request', lambda *args: (json.dumps(raw), {}))
    result = generator.generate({'requirements': [{'id': 'r1'}], 'count': 1,
                                 'framework': 'pytest', 'include_code': True})
    assert len(result['cases']) == 1
    assert result['cases'][0]['code'].startswith('def test_1():\n')
    result = generator.generate({'requirements': [{'id': 'r1'}], 'count': 1,
                                 'framework': 'pytest', 'include_code': True,
                                 'existing_cases': [{'gherkin': gherkin}]})
    assert result['cases'] == []
    assert 'повторяет' in str(result['questions'])
