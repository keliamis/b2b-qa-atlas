"""Worker protocol: one JSON line on stdin, one bounded JSON report on stdout."""
import ast
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import xml.etree.ElementTree as ET


def safe_name(name, suffix):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,150}', name) or not name.endswith(suffix):
        raise ValueError('Исходники: допустимы простые имена файлов латиницей с расширением ' + suffix)
    if name.startswith('test_') or name in {'conftest.py','sitecustomize.py','usercustomize.py','playwright.config.js'}:
        raise ValueError('Имя исходного файла зарезервировано: ' + name)
    return name


def command(args, cwd, env, timeout=55):
    with open(cwd / 'console.log', 'wb') as log:
        p = subprocess.Popen(args, cwd=cwd, env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            code = p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            p.wait()
            code = -9
        finally:
            try: os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError: pass
    return code, (cwd / 'console.log').read_bytes()[-24000:].decode('utf-8', 'replace')


def normalize_test_code(raw, framework):
    """Repair old model-escaped tests while preventing pytest collection failure."""
    if not isinstance(raw,str) or not raw.strip():
        raise ValueError('Пустой код автотеста')
    code = raw.strip().lstrip('\ufeff')
    if framework == 'pytest':
        try:
            ast.parse(code)
            return code + '\n'
        except SyntaxError:
            pass
    if '\n' not in code and r'\n' in code:
        candidate = code.replace(r'\r\n','\n').replace(r'\n','\n').replace(r'\t','\t')
        candidate = candidate.replace(r'\"','"')
        if framework == 'pytest':
            try:
                ast.parse(candidate)
                return candidate.rstrip() + '\n'
            except SyntaxError as exc:
                raise ValueError(f'Невалидный Python-код автотеста: строка {exc.lineno}: {exc.msg}') from exc
        return candidate.rstrip() + '\n'
    if framework == 'pytest':
        raise ValueError('Невалидный Python-код автотеста: ошибка синтаксиса')
    return code.rstrip() + '\n'


def execute(data, cwd):
    modules = Path(os.getenv('RUNNER_NODE_MODULES', '/opt/runner/node_modules'))
    framework = data['framework']
    suffix = '.py' if framework == 'pytest' else '.js'
    sources = [s for s in data['sources'] if s['name'].endswith(suffix)]
    if not sources: raise ValueError('Нет исходников для выбранного языка')
    names = [safe_name(s['name'], suffix) for s in sources]
    if len(set(names)) != len(names): raise ValueError('Повторяются имена исходников')
    src = cwd / 'src'
    tests = cwd / 'tests'
    src.mkdir()
    tests.mkdir()
    for s in sources: (src / s['name']).write_text(s['text'], encoding='utf-8')
    for i, t in enumerate(data['tests']):
        try:
            code = normalize_test_code(t['code'], framework)
        except ValueError as exc:
            raise ValueError(f'Автотест {i+1} ({t.get("title","без названия")}): {exc}') from exc
        (tests / (f'test_{i:03}.py' if framework == 'pytest' else f'case_{i:03}.spec.js')).write_text(code, encoding='utf-8')
    env = {**os.environ, 'PYTHONPATH':str(src), 'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1'}
    files = []
    total = passed = failed = skipped = 0
    test_results = []
    if framework == 'pytest':
        code, logs = command([sys.executable, '-m', 'coverage', 'run', '--source=src', '-m', 'pytest', 'tests', '-q', '--import-mode=importlib', '--junitxml=results.xml'], cwd, env)
        # A collection error is not a test failure and cannot count as a valid
        # coverage run. Flag it explicitly instead of showing a misleading %.
        if 'ERROR collecting ' in logs or 'Interrupted:' in logs:
            return {'status':'error','exitCode':code,
                    'logs':'Ошибка сбора тестов. Код автотестов необходимо исправить.\n'+logs,
                    'total':0,'passed':0,'failed':0,'skipped':0,'coverage':None,'files':[]}
        if (cwd / 'results.xml').exists():
            for case in ET.parse(cwd / 'results.xml').iter('testcase'):
                failure = case.find('failure')
                if failure is None: failure = case.find('error')
                match = re.search(r'test_(\d+)', case.get('classname',''))
                index = int(match.group(1)) if match else -1
                test_results.append({'caseId': data['tests'][index]['id'] if 0 <= index < len(data['tests']) else '',
                    'traceback': (failure.text or '')[:12000] if failure is not None else '',
                    'assertion': failure.get('message','')[:2000] if failure is not None else '',
                    'name': case.get('name',''), 'status':
                    'failed' if case.find('failure') is not None or case.find('error') is not None
                    else 'skipped' if case.find('skipped') is not None else 'passed',
                    'duration': float(case.get('time','0'))})
                total += 1
                if case.find('failure') is not None or case.find('error') is not None: failed += 1
                elif case.find('skipped') is not None: skipped += 1
                else: passed += 1
        report = subprocess.run([sys.executable,'-m','coverage','json','-o','coverage.json'],cwd=cwd,env=env,capture_output=True,timeout=10)
        if report.returncode == 0:
            coverage = json.loads((cwd/'coverage.json').read_text())
            for name in names:
                info = coverage['files'].get('src/'+name)
                if info:
                    files.append({'name':name,'covered':info['executed_lines'],'missing':info['missing_lines']})
    else:
        (cwd/'node_modules').symlink_to(modules, target_is_directory=True)
        # CommonJS test files may also use Playwright's supported import syntax.
        (cwd/'playwright.config.js').write_text("module.exports={testDir:'./tests',workers:1,retries:0,timeout:15000,reporter:[['json',{outputFile:'results.json'}]],use:{headless:true,launchOptions:{args:['--no-sandbox']}}};")
        code, logs = command([str(modules/'.bin/c8'),'--all','--src=src','--include=src/**','--reporter=json','--reports-dir=coverage',str(modules/'.bin/playwright'),'test'],cwd,env)
        if (cwd/'results.json').exists():
            report = json.loads((cwd/'results.json').read_text())
            stats = report.get('stats',{})
            passed = stats.get('expected',0)
            failed = stats.get('unexpected',0)
            skipped = stats.get('skipped',0)
            total = passed + failed + skipped
            def collect(suites):
                for suite in suites:
                    for spec in suite.get('specs', []):
                        for test in spec.get('tests', []):
                            outcomes = test.get('results', [])
                            last = outcomes[-1] if outcomes else {}
                            match = re.search(r'case_(\d+)', spec.get('file',suite.get('file','')))
                            index = int(match.group(1)) if match else -1
                            test_results.append({'caseId': data['tests'][index]['id'] if 0 <= index < len(data['tests']) else '',
                                'traceback': str(last.get('error',{}).get('stack',''))[:12000],
                                'assertion': str(last.get('error',{}).get('message',''))[:2000],
                                'name': spec.get('title',''),
                                'status': 'passed' if test.get('status') == 'expected' else 'skipped' if test.get('status') == 'skipped' else 'failed',
                                'duration': last.get('duration',0)/1000})
                    collect(suite.get('suites', []))
            collect(report.get('suites', []))
        if (cwd/'coverage/coverage-final.json').exists():
            report = json.loads((cwd/'coverage/coverage-final.json').read_text())
            for name in names:
                info = report.get(str(src/name))
                if not info: continue
                lines = {}
                for k, location in info['statementMap'].items():
                    line = location['start']['line']
                    lines[line] = max(lines.get(line,0),info['s'][k])
                files.append({'name':name,'covered':[k for k,v in lines.items() if v>0], 'missing':[k for k,v in lines.items() if v==0]})
    # Partial execution, setup errors and an empty suite are not measurements.
    if code == -9 or total == 0 or (code != 0 and failed == 0):
        files = []
    hit = sum(len(f['covered']) for f in files)
    count = hit + sum(len(f['missing']) for f in files)
    return {'status':'timed_out' if code == -9 else 'passed' if code == 0 and total>0 else 'failed' if failed else 'error',
            'testResults':test_results[:1000],
            'exitCode':code,'logs':logs,'total':total,'passed':passed,'failed':failed,'skipped':skipped,
            'coverage':round(100*hit/count,2) if count else None,'files':files}

if __name__ == '__main__':
    try:
        result = execute(json.loads(sys.stdin.buffer.readline(1_500_001)), Path.cwd())
    except Exception as exc:
        result = {'status':'error','logs':str(exc)[:2000],'total':0,'passed':0,'failed':0,'skipped':0,'coverage':None,'files':[]}
    print(json.dumps(result, ensure_ascii=True), flush=True)
