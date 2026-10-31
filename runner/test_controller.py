import importlib.util
from pathlib import Path
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
import pytest
spec=importlib.util.spec_from_file_location('service',Path(__file__).with_name('service.py'))
service=importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

def test_private_routes_and_limits(monkeypatch):
    monkeypatch.setenv('RUNNER_TOKEN','secret')
    client=TestClient(service.app)
    assert client.post('/run',json={}).status_code==401
    assert client.delete('/runs/x').status_code==401
    assert client.post('/run',headers={'Authorization':'Bearer secret'},json={'id':'x','framework':'shell','sources':[{}],'tests':[{}]}).status_code==422

def test_container_policy_and_cleanup(monkeypatch):
    monkeypatch.setenv('RUNNER_TOKEN','secret')
    docker=MagicMock();container=docker.containers.create.return_value
    container.status='exited'
    container.logs.return_value=b'{"status":"passed","coverage":100}'
    monkeypatch.setattr(service,'client',lambda:docker)
    r=TestClient(service.app).post('/run',headers={'Authorization':'Bearer secret'},json={'id':'test-policy','framework':'pytest','sources':[{'name':'a.py','text':'x=1'}],'tests':[{'code':'test'}]})
    assert r.status_code==200
    options=docker.containers.create.call_args.kwargs
    assert options['network_mode']=='none'
    assert options['read_only'] is True
    assert options['user']=='1000:1000'
    assert options['cap_drop']==['ALL']
    assert 'volumes' not in options and 'environment' not in options
    assert options['pids_limit']==128
    container.remove.assert_called_once_with(force=True)

def test_cancel_before_start(monkeypatch):
    monkeypatch.setenv('RUNNER_TOKEN','secret')
    docker=MagicMock();monkeypatch.setattr(service,'client',lambda:docker)
    client=TestClient(service.app);headers={'Authorization':'Bearer secret'}
    client.delete('/runs/early-cancel',headers=headers)
    r=client.post('/run',headers=headers,json={'id':'early-cancel','framework':'pytest','sources':[{}],'tests':[{}]})
    assert r.status_code == 409
    docker.containers.create.assert_not_called()
