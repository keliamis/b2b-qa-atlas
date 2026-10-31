import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../backend/src/database.mjs';
import { createAccount } from '../backend/src/auth.mjs';
import { createServer } from '../backend/src/index.mjs';
import { snapshot } from '../backend/src/autorun.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('autorun HTTP: session, queue, snapshot, viewer, reports, cancellation',async t=>{
 let release,hold=false,received=false;
 const runner=http.createServer(async(req,res)=>{
   const chunks=[];for await(const c of req)chunks.push(c);
   res.setHeader('Content-Type','application/json');
   if(req.method==='DELETE'){if(release)release();return res.end('{}');}
   assert.equal(req.headers.authorization,'Bearer runner-secret');
   const data=JSON.parse(Buffer.concat(chunks));assert.equal(data.sources[0].name,'target.py');received=true;
   if(hold)await new Promise(r=>release=r);
   res.end(JSON.stringify({status:'passed',logs:'1 passed',total:1,passed:1,failed:0,skipped:0,coverage:50,files:[{name:'target.py',covered:[1],missing:[2]}]}));
 });runner.listen(0,'127.0.0.1');await once(runner,'listening');
 const db=openDatabase(':memory:');
 const user=await createAccount(db,'test@example.test','Tester','test-password-long');
 const viewer=await createAccount(db,'viewer@example.test','Viewer','test-password-long');
 const app=createServer({db,mlToken:'runner-secret',runnerUrl:`http://127.0.0.1:${runner.address().port}`});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const base=`http://127.0.0.1:${app.server.address().port}`;
 async function request(path,method='GET',data,cookie=''){
 const r=await fetch(base+path,{method,headers:{Origin:'http://localhost:8080','Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try {
 const cookie=(await request('/auth/login','POST',{email:'test@example.test',password:'test-password-long'})).cookie;
 const vCookie=(await request('/auth/login','POST',{email:'viewer@example.test',password:'test-password-long'})).cookie;
 let p={id:'auto-project',name:'Run demo',description:'',revision:0,requirements:[{id:'r',key:'R1',title:'R',text:'R',priority:'medium',source:''}],sources:[{id:'s',name:'target.py',text:'x=1\ny=2'}],cases:[{id:'c',key:'C1',title:'test',requirementIds:['r'],type:'positive',priority:'medium',status:'draft',gherkin:'Given x\nWhen y\nThen z',code:'def test_ok(): assert True',framework:'pytest',assumptions:[],origin:'manual',updatedAt:''}],audit:[]};
 p=(await request('/api/projects/'+p.id,'PUT',p,cookie)).data;
 db.raw.prepare('INSERT INTO members(project_id,user_id,role) VALUES(?,?,?)').run(p.id,viewer.id,'viewer');
 const path='/api/projects/'+p.id+'/auto-runs';
 assert.equal((await request(path,'POST',{framework:'pytest',case_ids:['c']})).status,401);
 assert.equal((await request(path,'POST',{framework:'pytest',case_ids:['c']},vCookie)).status,403);
 assert.equal((await request(path,'POST',{framework:'junit',case_ids:['c']},cookie)).status,400);
 assert.equal((await request(path,'POST',{framework:'pytest',case_ids:['missing']},cookie)).status,400);
 hold=true;received=false;
 const start=await request(path,'POST',{framework:'pytest',case_ids:['c']},cookie);assert.equal(start.status,202);
 for(let i=0;i<100&&!received;i++)await pause(10);assert.ok(received);
 assert.equal((await request(path,'POST',{framework:'pytest',case_ids:['c']},cookie)).status,409);
 p.sources[0].text='changed=123';p=(await request('/api/projects/'+p.id,'PUT',p,cookie)).data;
 release();hold=false;
 let runs;for(let i=0;i<100;i++){runs=(await request(path,'GET',undefined,cookie)).data;if(runs[0]?.result)break;await pause(10);}
 assert.equal(runs[0].result.snapshot.sources[0].text,'x=1\ny=2');assert.equal(runs[0].result.coverage,50);
 assert.equal((await request('/api/projects','GET',undefined,cookie)).data.find(x=>x.id===p.id).sources[0].text,'changed=123');
 assert.equal((await request(path,'GET',undefined,vCookie)).status,200);
 hold=true;received=false;
 const next=await request(path,'POST',{framework:'pytest',case_ids:['c']},cookie);
 for(let i=0;i<100&&!received;i++)await pause(10);
 assert.equal((await request('/api/jobs/'+next.data.id+'/cancel','POST',{},cookie)).status,200);await pause(50);
 const cancelled=(await request(path,'GET',undefined,cookie)).data.find(x=>x.id===next.data.id);
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.result,null);
 }finally{if(release)release();await app.close();await new Promise(r=>runner.close(r));}
});
