import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import pytest

spec=importlib.util.spec_from_file_location('worker',Path(__file__).with_name('worker.py'))
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

def execute(framework, code, sources=None):
    suffix='py' if framework=='pytest' else 'js'
    default='def classify(n):\n    if n > 0:\n        return "positive"\n    return "other"\n' if suffix=='py' else 'exports.classify = n => {\n if (n > 0) {\n return "positive";\n }\n return "other";\n};\n'
    with tempfile.TemporaryDirectory() as temp:
        return worker.execute({'framework':framework,'sources':sources or [{'name':'target.'+suffix,'text':default}],'tests':[{'id':'a','code':code}]},Path(temp))

def test_python_pass_partial_and_untouched():
    r=execute('pytest','from target import classify\ndef test_positive():\n assert classify(1)=="positive"\n',[
        {'name':'target.py','text':'def classify(n):\n if n>0:\n  return "positive"\n return "other"\n'},
        {'name':'unused.py','text':'def unused():\n return 123\n'}])
    assert r['status']=='passed',r
    assert r['passed']==1
    assert 0<r['coverage']<100
    assert next(f for f in r['files'] if f['name']=='unused.py')['missing']==[1,2]

def test_python_failure():
    r=execute('pytest','from target import classify\ndef test_wrong():\n assert classify(1)=="wrong"\n')
    assert r['failed']==1 and r['status']=='failed'
    assert 'AssertionError' in r['logs']

def test_empty_and_import_failure_not_success():
    for code in ['# no tests','import nonexistent_module']:
        r=execute('pytest',code)
        assert r['status']!='passed' and r['passed']==0

@pytest.mark.parametrize('name',['../bad.py','/bad.py','conftest.py','test_x.py','sitecustomize.py','a/b.py'])
def test_names(name):
    with pytest.raises(ValueError):worker.safe_name(name,'.py')

def test_javascript_pass_and_failure():
    good="const {test,expect}=require('@playwright/test'); const {classify}=require('../src/target.js'); test('positive',()=>{expect(classify(1)).toBe('positive')});"
    r=execute('playwright',good)
    assert r['status']=='passed',r
    assert 0<r['coverage']<100,r
    assert r['files'][0]['missing'],r
    r=execute('playwright',good.replace("toBe('positive')","toBe('wrong')"))
    assert r['status']=='failed' and r['failed']==1,r

def test_duplicate_sources_rejected():
    with pytest.raises(ValueError,match='Повторяются'):
        execute('pytest','', [{'name':'a.py','text':'x=1'},{'name':'a.py','text':'x=2'}])

def test_timeout_kills_group(tmp_path):
    code,logs=worker.command([sys.executable,'-c','while True: pass'],tmp_path,dict(os.environ),timeout=.2)
    assert code==-9


def test_literal_newlines_in_generated_pytest_are_repaired():
    raw = r'from target import classify\n\ndef test_positive():\n    assert classify(1) == \"positive\"'
    r = execute('pytest', raw)
    assert r['status'] == 'passed', r
    assert r['total'] == 1, r
    assert r['coverage'] is not None, r


def test_invalid_generated_python_fails_before_pytest_collection():
    try:
        execute('pytest', 'def test_broken(:')
    except ValueError as e:
        assert 'Невалидный Python' in str(e)
    else:
        assert False, 'invalid code should be rejected'


def test_empty_suite_has_no_measured_coverage():
    report=execute('pytest','# no tests')
    assert report['coverage'] is None
    assert report['files'] == []


def test_individual_results_are_reported():
    report=execute('pytest','def test_ok():\n assert True\ndef test_bad():\n assert False')
    assert [t['status'] for t in report['testResults']] == ['passed','failed']

def test_failure_evidence_maps_snapshot_case():
    report=execute('pytest','def test_price():\n assert 4750 == 4500')
    result=report['testResults'][0]
    assert result['caseId']=='a'
    assert '4750' in result['traceback']
    assert '4500' in result['assertion']
