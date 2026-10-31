import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';
const output='.test-cloud-client.mjs';
await build({entryPoints:['frontend/src/cloud.ts'],bundle:true,platform:'node',format:'esm',outfile:output});
const {cloud}=await import('../'+output);
await unlink(output);
test('cloud preserves HTTP status on non-JSON auth errors',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('<html>Unauthorized</html>',{status:401}));
 await assert.rejects(cloud('/projects'),e=>e.status===401);
});
test('cloud handles empty responses and sends JSON',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'/workspace-api/projects/p');assert.equal(options.body,'{"name":"Updated"}');assert.ok(options.signal);
  return new Response(null,{status:204});
 });
 assert.equal(await cloud('/projects/p','PUT',{name:'Updated'}),undefined);
});
test('cloud timeout aborts pending fetch and clears timer',async t=>{
 let expire,cleared=false;
 t.mock.method(globalThis,'setTimeout',(fn,ms)=>{assert.equal(ms,15000);expire=fn;return 42;});
 t.mock.method(globalThis,'clearTimeout',id=>{assert.equal(id,42);cleared=true;});
 t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
 const request=cloud('/projects');expire();
 await assert.rejects(request,/время ожидания/);assert.ok(cleared);
});
test('cloud retains structured server error and status',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({detail:'Already running'},{status:409}));
 await assert.rejects(cloud('/jobs','POST',{}),e=>e.status===409&&e.message==='Already running');
});
