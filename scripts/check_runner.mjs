// Run inside backend: docker compose exec backend node scripts/check_runner.mjs
import { randomUUID } from 'node:crypto';
const url=process.env.RUNNER_URL;
if(!url)throw new Error('RUNNER_URL is not configured');
const health=await fetch(url+'/health',{signal:AbortSignal.timeout(10000)});
if(!health.ok)throw new Error('Worker image unavailable. Run: docker compose --profile build-worker build worker-image');
for(const framework of ['pytest','playwright']) {
 const python=framework==='pytest';
 const response=await fetch(url+'/run',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.ML_TOKEN},signal:AbortSignal.timeout(100000),body:JSON.stringify({id:randomUUID(),framework,sources:[{name:python?'target.py':'target.js',text:python?'def double(x):\n return x*2\n':'exports.double=x=>x*2;\n'}],tests:[{id:'smoke',code:python?'from target import double\ndef test_double():\n assert double(3)==6\n':"const {test,expect}=require('@playwright/test'); const {double}=require('../src/target.js'); test('double',()=>expect(double(3)).toBe(6));"}]})});
 const r=await response.json();
 if(!response.ok||r.status!=='passed'||r.total!==1||r.coverage!==100)throw new Error(framework+': '+JSON.stringify(r));
 console.log(framework+': OK, 1 test passed, coverage 100%');
}
