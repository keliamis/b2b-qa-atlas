// Real FastAPI parser + backend HTTP; SQLite test adapter, NOT PostgreSQL/Docker validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import {openDatabase} from '../backend/src/database.mjs';
import {createServer} from '../backend/src/index.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('51-page PDF: HTTP async import, links, export and restart persistence', {timeout:30000}, async()=>{
 const temp=await mkdtemp(join(tmpdir(),'atlas-pdf-'));
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
 const port=probe.address().port;await new Promise(r=>probe.close(r));
 const ml=spawn('python',['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(port)],{cwd:'ml-service',env:{...process.env,ML_TOKEN:'local-test-token'},stdio:'ignore'});
 const mlExit=once(ml,'exit');
 let app,db,cookie,base;
 const origin='http://localhost:8080';
 const start=async()=>{db=openDatabase(join(temp,'test.sqlite'));app=createServer({db,origin,mlUrl:`http://127.0.0.1:${port}`,mlToken:'local-test-token',model:'',apiKeyConfigured:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base=`http://127.0.0.1:${app.server.address().port}`;};
 const api=async(path,method='GET',data)=>{const r=await fetch(base+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data instanceof FormData?{}:data?{'Content-Type':'application/json'}:{})},body:data instanceof FormData?data:data?JSON.stringify(data):undefined});assert.ok(r.ok,`${path}: ${r.status} ${r.ok?'':await r.text()}`);return r;};
 try{
  let ready=false;for(let i=0;i<100;i++){assert.equal(ml.exitCode,null,"FastAPI exited before becoming ready; install ml-service/requirements.txt");try{ready=(await fetch(`http://127.0.0.1:${port}/health`)).ok;if(ready)break;}catch{}await sleep(50);}assert.ok(ready,'FastAPI starts');
  await start();
  const credentials={email:'submission@example.test',name:'Submission',password:'submission-test-password',confirmPassword:'submission-test-password'};
  assert.equal((await api('/auth/register','POST',credentials)).status,201);
  cookie=(await api('/auth/login','POST',credentials)).headers.get('set-cookie').split(';')[0];
  const project={id:'submission',revision:0,name:'PDF verification',description:'',requirements:[],cases:[],sources:[],audit:[]};
  await api('/api/projects/submission','PUT',project);
  const f=new FormData();f.set('file',new Blob([await readFile('ml-service/tests/fixtures/requirements_51_pages.pdf')]),'requirements_51_pages.pdf');
  const before=Date.now();const response=await api('/api/projects/submission/documents','POST',f);assert.equal(response.status,202);assert.ok(Date.now()-before<5000,'import returns promptly');
  const jobId=(await response.json()).id;let job;
  for(let i=0;i<200;i++){job=(await(await api('/api/projects/submission/jobs')).json()).find(j=>j.id===jobId);if(['failed','succeeded'].includes(job.status))break;await sleep(50);}
  assert.equal(job.status,'succeeded',job.error);assert.equal(job.result.count,51);
  let saved=(await(await api('/api/projects')).json())[0];
  assert.equal(saved.requirements.length,51);
  for(const key of ['REQ-001','REQ-025','REQ-051'])assert.ok(saved.requirements.some(r=>r.key===key&&r.text.length>1000));
  saved.cases=[{id:'last-case',key:'TC-001',title:'Export fixture',requirementIds:[saved.requirements[50].id],type:'positive',priority:'medium',gherkin:'Feature: Export\nScenario: Last requirement\nGiven requirement 51\nWhen exported\nThen its ID is retained',code:'def test_export():\n assert True\n',artifacts:{pytest:'def test_export():\n assert True\n',playwright:'// export fixture only'},framework:'pytest',status:'draft',origin:'manual',assumptions:[],updatedAt:new Date().toISOString()}];
  await api('/api/projects/submission','PUT',saved);
  const zip=await JSZip.loadAsync(await(await api('/api/projects/submission/export')).arrayBuffer());
  for(const ext of ['.feature','.py','.js'])assert.ok(Object.keys(zip.files).some(n=>n.endsWith(ext)),ext);
  await app.close();app=null;await start();
  saved=(await(await api('/api/projects')).json())[0];
  assert.equal(saved.requirements.length,51);assert.equal(saved.cases[0].requirementIds[0],saved.requirements[50].id);
  assert.equal((await(await api('/api/projects/submission/jobs')).json()).find(j=>j.id===jobId).status,'succeeded');
 }finally{if(app)await app.close();if(ml.exitCode===null)ml.kill();await mlExit.catch(()=>{});await rm(temp,{recursive:true,force:true});}
});
