import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {openDatabase} from '../backend/src/database.mjs';
import {createAccount} from '../backend/src/auth.mjs';
import {createServer} from '../backend/src/index.mjs';
import {coverageAdvice,duplicates,generateData,dataCSV,redact} from '../backend/src/insights.mjs';
const c=(id,amount=5000)=>({id,key:'TC-'+id,title:'Test '+id,requirementIds:['r'],type:'boundary',priority:'high',status:'draft',gherkin:`Feature: Price\nScenario: ${id}\nGiven cart exists\nWhen amount is ${amount.toFixed(2)}\nThen total is 4500`,code:'def test_price(): assert 4750 == 4500',framework:'pytest',assumptions:[],origin:'manual',updatedAt:''});
const p={id:'p',name:'Shop',description:'',revision:0,requirements:[{id:'r',key:'REQ-1',title:'Discount',text:'При сумме 5000.00 скидка 10%.',priority:'high',source:''}],sources:[{id:'s',name:'price.py',text:'def price(n): return n * .95'}],cases:[c('a',4999.99)],audit:[]};
const spec={fields:[{name:'amount',type:'number',required:true,minimum:0,maximum:null,thresholds:[1000,5000],precision:2,format:'text',min_length:null,max_length:null}],assumptions:[]};
test('advisor finds exactly 5000, ignores expected-only mentions and closes after input test',()=>{
 assert.ok(coverageAdvice(p).recommendations.some(r=>r.value===5000));
 assert.ok(coverageAdvice({...p,cases:[{...c('b',4999.99),gherkin:'Given cart\nWhen amount 4999.99\nThen 5000.00'}]}).recommendations.some(r=>r.value===5000));
 assert.ok(!coverageAdvice({...p,cases:[c('b')]}).recommendations.some(r=>r.value===5000));
 assert.equal(coverageAdvice(p).metrics.codeCoverage,null);
});
test('deduplicator detects same steps and near matches but preserves different boundaries',()=>{
 const exact=duplicates([c('a'),c('b')]);assert.equal(exact[0].similarity,100);
 assert.ok(duplicates([c('a'),{...c('b'),gherkin:c('b').gherkin.replace('cart exists','shopping cart exists')}]).length);
 assert.equal(duplicates([c('a',4999.99),c('b',5000)]).length,0);
 const operators=duplicates([{...c('a'),gherkin:'Given amount > 5000\nWhen calculate\nThen discount'},{...c('b'),gherkin:'Given amount < 5000\nWhen calculate\nThen discount'}]);
 assert.ok(!operators.some(p=>p.similarity===100));
});
test('deterministic data, bounds, modes and safe CSV/JSON',()=>{
 const data=generateData(spec,'boundary',9);assert.deepEqual(data.rows.map(r=>r.data.amount),[-.01,0,.01,999.99,1000,1000.01,4999.99,5000,5000.01]);
 assert.ok(generateData(spec,'positive',3).rows.every(r=>typeof r.data.amount==='number'&&r.data.amount>=0));
 assert.ok(generateData(spec,'negative',4).rows.every(r=>r.category==='negative'));
 assert.equal(generateData(spec,'mixed',20).rows.length,20);
 assert.match(dataCSV(data),/5000.01/);assert.equal(JSON.parse(JSON.stringify(data)).rows.length,9);
 assert.ok(generateData({...spec,fields:[{...spec.fields[0],precision:null}]},'boundary',3).assumptions.some(a=>a.includes('точность')));
 const malicious={...data,rows:[{index:1,category:'positive',reason:'=CMD()',data:{amount:1}}]};assert.match(dataCSV(malicious),/'=CMD/);
 assert.throws(()=>generateData({fields:[{...spec.fields[0],minimum:null,thresholds:[]}],assumptions:[]},'boundary',1),/Доступно уникальных/);
});
test('secrets are removed before LLM submission',()=>{assert.ok(!redact('API_KEY=private-value\nBearer secretvalue\npassword: pass123').includes('private-value'));assert.ok(!redact('API_KEY=private-value\nBearer secretvalue\npassword: pass123').includes('pass123'));});
test('HTTP feature lifecycle: auth, failed analysis, missing traceback, provider failure, reports, data and decisions',async()=>{
 let fail=false,seen;
 const ml=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;seen=JSON.parse(raw);res.setHeader('Content-Type','application/json');if(fail){res.writeHead(503);return res.end('{}');}res.end(JSON.stringify(seen.kind==='constraints'?spec:{explanation:'4750 != 4500',probable_cause:'Возможно скидка 5%',defect_location:'price.py',suggested_fix:'Проверить порог',confidence:'medium',insufficient_data:false}));});
 ml.listen(0,'127.0.0.1');await once(ml,'listening');
 const db=openDatabase(':memory:');await createAccount(db,'owner@example.test','Owner','test-password-long');const other=await createAccount(db,'other@example.test','Other','test-password-long');
 const app=createServer({db,mlUrl:`http://127.0.0.1:${ml.address().port}`,mlToken:'test'});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const base=`http://127.0.0.1:${app.server.address().port}`;
 async function req(url,method='GET',body,cookie=''){const r=await fetch(base+url,{method,headers:{Origin:'http://localhost:8080','Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try {
 const owner=(await req('/auth/login','POST',{email:'owner@example.test',password:'test-password-long'})).cookie;
 const stranger=(await req('/auth/login','POST',{email:'other@example.test',password:'test-password-long'})).cookie;
 let project=(await req('/api/projects/p','PUT',{...p,cases:[c('a'),c('b')]},owner)).data;
 const report={status:'failed',logs:'AssertionError',testResults:[{name:'test_price',caseId:'a',status:'failed',duration:.01,traceback:'AssertionError: 4750 != 4500\nAPI_KEY=private-value',assertion:'4750 != 4500'},{name:'test_legacy',status:'failed',duration:0},{name:'test_pass',status:'passed',duration:0}],snapshot:{framework:'pytest',sources:p.sources,tests:[c('a')],projectRevision:1},files:[],coverage:null};
 db.raw.prepare("INSERT INTO jobs VALUES('job','p','owner','autorun','succeeded','','{}',?,NULL,?)").run(JSON.stringify(report),new Date().toISOString());
 const feature=(a)=>'/api/projects/p/insights/'+a;
 assert.equal((await req(feature('coverage'))).status,401);
 for(const a of ['coverage','reports','duplicates'])assert.equal((await req(feature(a),'GET',undefined,stranger)).status,404);
 assert.equal((await req(feature('detective'),'POST',{runId:'job',index:0},stranger)).status,404);
 let r=await req(feature('detective'),'POST',{runId:'job',index:0},owner);assert.equal(r.status,200);assert.equal(r.data.data.confidence,'medium');assert.ok(!seen.payload.includes('private-value'));
 r=await req(feature('detective'),'POST',{runId:'job',index:1},owner);assert.equal(r.data.data.insufficient_data,true);assert.equal(r.data.data.confidence,'low');
 assert.equal((await req(feature('detective'),'POST',{runId:'job',index:2},owner)).status,400);
 fail=true;assert.equal((await req(feature('detective'),'POST',{runId:'job',index:0},owner)).status,502);fail=false;
 r=await req(feature('report'),'POST',{runId:'job',index:0},owner);assert.equal(r.status,200);assert.match(r.data.data.markdown,/Гипотезы ИИ/);assert.match(r.data.data.markdown,/\*\*Объяснение:\*\*/);assert.match(r.data.data.markdown,/\*\*Вероятная причина:\*\*/);assert.match(r.data.data.markdown,/\*\*Уверенность:\*\* Средняя/);assert.ok(!r.data.data.markdown.includes('\"probable_cause\"'));assert.match(r.data.data.markdown,/4750/);assert.ok(!r.data.data.markdown.includes('private-value'));
 const saved=await req(feature('report-save'),'POST',{key:r.data.record_key,version:r.data.updated_at,markdown:r.data.data.markdown+'\nEdited'},owner);assert.equal(saved.status,200);
 assert.match((await req(feature('reports'),'GET',undefined,owner)).data[0].data.markdown,/Edited/);
 assert.equal((await req(feature('report'),'POST',{runId:'job',index:0},owner)).data.id,r.data.id);
 for(const mode of ['positive','negative','boundary','mixed']){const generated=await req(feature('data'),'POST',{mode,count:10},owner);if(generated.status===422){assert.match(generated.data.detail,/Уменьшите количество/);}else{assert.equal(generated.status,200);assert.equal(generated.data.rows.length,10);assert.match(generated.data.csv,/amount/);}}
 assert.equal((await req(feature('data'),'POST',{mode:'mixed',count:501},owner)).status,400);
 const pairs=(await req(feature('duplicates'),'GET',undefined,owner)).data;assert.equal(pairs.length,1);
 assert.equal((await req(feature('duplicate-decision'),'POST',{a:'a',b:'b',decision:'duplicate'},owner)).status,200);
 assert.equal((await req(feature('duplicates'),'GET',undefined,owner)).data[0].decision.decision,'duplicate');
 assert.equal(JSON.parse(db.raw.prepare('SELECT data FROM projects WHERE id=?').get('p').data).cases.length,2);
 // Duplicate metadata is persisted without deleting either case; undo restores it.
 let persisted=JSON.parse(db.raw.prepare('SELECT data FROM projects WHERE id=?').get('p').data);
 assert.equal(persisted.cases.find(c=>c.id==='b').duplicateOf,'a');
 assert.equal((await req(feature('duplicate-decision'),'POST',{a:'a',b:'b',decision:'keep'},owner)).status,200);
 persisted=JSON.parse(db.raw.prepare('SELECT data FROM projects WHERE id=?').get('p').data);
 assert.equal(persisted.cases.find(c=>c.id==='b').duplicateOf,undefined);
 const advice=(await req(feature('coverage'),'GET',undefined,owner)).data;
 assert.ok(advice.recommendations.every(r=>r.scenario===null));
 db.raw.prepare("INSERT INTO members VALUES('p',?,'viewer')").run(other.id);
 assert.equal((await req(feature('report-save'),'POST',{key:r.data.record_key,version:saved.data.updated_at,markdown:'x'},stranger)).status,403);
 } finally {await app.close();await new Promise(resolve=>ml.close(resolve));}
});
