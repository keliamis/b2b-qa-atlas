"""Trusted controller; uploaded code runs only in short-lived Docker containers."""
import hmac
import json
import os
import socket
import threading
import time
from contextlib import asynccontextmanager
import docker
from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Literal

IMAGE = 'qa-atlas-worker:1'
LABEL = 'qa-atlas.executor'
lock = threading.Lock()
active = {}
cancelled = {}
client = lambda: docker.from_env(timeout=10)

def auth(authorization: str = Header(default='')):
    token = os.getenv('RUNNER_TOKEN', '')
    if not token or not hmac.compare_digest(authorization, 'Bearer ' + token):
        raise HTTPException(401, 'Нет доступа')

@asynccontextmanager
async def lifespan(app):
    # Clean up interrupted work after controller restart.
    c = client()
    for container in c.containers.list(all=True, filters={'label': LABEL}):
        container.remove(force=True)
    c.close()
    yield

app = FastAPI(lifespan=lifespan)
class Run(BaseModel):
    id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,100}$')
    framework: Literal['pytest', 'playwright']
    sources: list[dict] = Field(min_length=1, max_length=100)
    tests: list[dict] = Field(min_length=1, max_length=50)

@app.get('/health')
def health():
    try:
        c = client()
        c.images.get(IMAGE)
        c.ping()
        c.close()
        return {'ready': True}
    except Exception:
        raise HTTPException(503, 'Соберите образ qa-atlas-worker:1')

@app.delete('/runs/{run_id}', dependencies=[Depends(auth)])
def cancel(run_id: str):
    cancelled[run_id] = time.monotonic()
    container = active.get(run_id)
    if container:
        try: container.kill()
        except docker.errors.APIError: pass
    return {'ok': True}

@app.post('/run', dependencies=[Depends(auth)])
def run(data: Run):
    payload = data.model_dump_json().encode() + b'\n'
    if len(payload) > 1_500_000:
        raise HTTPException(413, 'Слишком большой снимок')
    if not lock.acquire(blocking=False):
        raise HTTPException(429, 'Исполнитель занят')
    c = None
    container = None
    try:
        for key, at in list(cancelled.items()):
            if time.monotonic()-at > 300: cancelled.pop(key,None)
        if data.id in cancelled: raise HTTPException(409, 'Прогон отменён')
        c = client()
        container = c.containers.create(
            IMAGE, stdin_open=True, network_mode='none', read_only=True,
            user='1000:1000', cap_drop=['ALL'], security_opt=['no-new-privileges:true'],
            mem_limit='768m', memswap_limit='768m', nano_cpus=1_000_000_000,
            pids_limit=128, tmpfs={'/work': 'rw,nosuid,size=128m,uid=1000,gid=1000',
                                  '/tmp': 'rw,nosuid,size=128m,uid=1000,gid=1000'},
            shm_size='128m', labels={LABEL: 'true'},
            ulimits=[docker.types.Ulimit(name='fsize', soft=8_388_608, hard=8_388_608)],
            log_config=docker.types.LogConfig(type='json-file', config={'max-size':'2m','max-file':'1'}),
        )
        active[data.id] = container
        stream = container.attach_socket(params={'stdin': 1, 'stream': 1})
        if data.id in cancelled: raise HTTPException(409, "Прогон отменён")
        container.start()
        stream._sock.settimeout(10)
        stream._sock.sendall(payload)
        stream.close()
        deadline = time.monotonic() + 75
        while True:
            container.reload()
            if container.status not in ('running', 'created'): break
            if time.monotonic() > deadline:
                container.kill()
                return {'status':'timed_out', 'logs':'Превышен лимит 75 секунд', 'files':[], 'total':0, 'passed':0, 'failed':0, 'skipped':0, 'coverage':None}
            time.sleep(.2)
        raw = container.logs(tail=1).decode('utf-8', errors='replace')
        try:
            result = json.loads(raw)
            if not isinstance(result, dict) or 'status' not in result: raise ValueError()
            return result
        except ValueError:
            return {'status':'error', 'logs':'Исполнитель завершился без отчёта (отмена, лимит памяти или ошибка процесса).', 'files':[], 'total':0, 'passed':0, 'failed':0, 'skipped':0, 'coverage':None}
    except HTTPException:
        raise
    except docker.errors.ImageNotFound:
        raise HTTPException(503, 'Сначала соберите образ qa-atlas-worker:1')
    except Exception:
        raise HTTPException(502, 'Ошибка Docker-исполнителя. Проверьте его журнал.')
    finally:
        active.pop(data.id, None)
        if container:
            try: container.remove(force=True)
            except docker.errors.APIError: pass
        if c: c.close()
        lock.release()
