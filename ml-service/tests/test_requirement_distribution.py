"""Regression: six selected requirements must not become six tests for REQ-001."""
import json

from app import generator


def draft(rid, number):
    return {
        'title': f'{rid}: check {number}',
        'requirementIds': [rid],
        'type': 'boundary', 'priority': 'high',
        'gherkin': (f'Feature: {rid}\nScenario: Проверка {number}\n'
                    f'Given сумма равна {number}\n'
                    f'When рассчитывается уровень для {rid}\n'
                    f'Then возвращается результат {number}'),
        'code': '', 'assumptions': [],
    }


def stub(monkeypatch, responses):
    calls = []
    monkeypatch.setattr(generator, '_config', lambda: ('key', 'model', 'https://example', 'openai'))

    def request(payload, *args, **kwargs):
        calls.append(payload)
        idx = min(len(calls) - 1, len(responses) - 1)
        return json.dumps({'cases': responses[idx], 'questions': []}, ensure_ascii=False), {'total_tokens': 5}

    monkeypatch.setattr(generator, '_request', request)
    return calls


def inputs(count=6, selected=6):
    return {'requirements': [{'id': f'REQ-{i:03}', 'text': f'Порог {100+i}'}
                             for i in range(1, selected + 1)],
            'count': count, 'framework': 'pytest', 'include_code': False}


def test_six_selected_six_requested_incorrect_first_response_is_repaired(monkeypatch):
    first = [draft('REQ-001', n) for n in range(1, 7)]
    repaired = [draft(f'REQ-{n:03}', n) for n in range(2, 7)]
    calls = stub(monkeypatch, [first, repaired])
    result = generator.generate(inputs())
    assert len(result['cases']) == 6
    assert [case['requirementIds'][0] for case in result['cases']] == [f'REQ-{i:03}' for i in range(1, 7)]
    assert len(calls) == 2
    assert calls[0]['generation_plan'] == [
        {'requirementId': f'REQ-{i:03}', 'count': 1} for i in range(1, 7)]
    assert calls[1]['count'] == 5
    assert calls[1]['generation_plan'] == [
        {'requirementId': f'REQ-{i:03}', 'count': 1} for i in range(2, 7)]
    assert result['usage']['total_tokens'] == 10


def test_fair_quota_with_extra_tests(monkeypatch):
    plan = generator._generation_plan(inputs(count=9, selected=6))[2]
    assert [item['count'] for item in plan] == [2, 2, 2, 1, 1, 1]


def test_missing_requirements_are_reported_not_faked(monkeypatch):
    first = [draft('REQ-001', n) for n in range(1, 7)]
    calls = stub(monkeypatch, [first, [draft('REQ-001', 7)]])
    result = generator.generate(inputs())
    assert len(result['cases']) == 1
    assert result['cases'][0]['requirementIds'] == ['REQ-001']
    assert 'REQ-006' in ' '.join(result['questions'])
    assert len(calls) == 2


def test_fewer_test_slots_than_selected_requirements_warns(monkeypatch):
    cases = [draft(f'REQ-{i:03}', i) for i in range(1, 4)]
    calls = stub(monkeypatch, [cases])
    result = generator.generate(inputs(count=3, selected=6))
    assert len(result['cases']) == 3
    assert len(calls) == 1
    assert calls[0]['generation_plan'] == [
        {'requirementId': f'REQ-{i:03}', 'count': 1} for i in range(1, 4)]
    assert 'REQ-006' in ' '.join(result['questions'])


def test_no_response_with_questions_does_not_trigger_useless_retry(monkeypatch):
    calls = stub(monkeypatch, [[]])
    def unanswered(payload, *args, **kwargs):
        calls.append(payload)
        return json.dumps({'cases': [], 'questions': ['Уточните ожидаемый результат']}), {}
    monkeypatch.setattr(generator, '_request', unanswered)
    result = generator.generate(inputs())
    assert result['cases'] == []
    assert len(calls) == 1
    assert 'Уточните' in ' '.join(result['questions'])


def test_rejects_test_linked_to_multiple_selected_requirements(monkeypatch):
    invalid = draft('REQ-001', 1)
    invalid['requirementIds'] = ['REQ-001', 'REQ-002']
    calls = stub(monkeypatch, [[invalid], [draft('REQ-001', 1)]])
    result = generator.generate(inputs(count=1, selected=2))
    assert len(result['cases']) == 1
    assert result['cases'][0]['requirementIds'] == ['REQ-001']
    assert len(calls) == 2
