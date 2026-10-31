"""Real local worker execution. Does not validate Docker isolation or live AI."""
import importlib.util
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location('submission_worker',Path(__file__).with_name('worker.py'))
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
ROOT=Path(__file__).resolve().parents[1]

def test_rule_engine_real_failure_and_coverage(tmp_path):
    source=(ROOT/'examples/submission/rule_engine.py').read_text()
    code=(ROOT/'examples/submission/test_rule_engine.py').read_text()
    report=worker.execute({'framework':'pytest','sources':[{'name':'rule_engine.py','text':source}],
                           'tests':[{'id':'boundary-demo','code':code}]},tmp_path)
    assert report['status']=='failed'
    assert report['passed']==2 and report['failed']==1
    assert '4500' in report['logs'] and '4750' in report['logs']
    assert 0 < report['coverage'] <= 100
    assert report['testResults'][1]['caseId']=='boundary-demo'
    assert 'AssertionError' in report['testResults'][1]['traceback']
    assert any(f['name']=='rule_engine.py' for f in report['files'])
