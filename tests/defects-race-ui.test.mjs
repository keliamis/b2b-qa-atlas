import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import React,{act} from 'react';
import {unlink} from 'node:fs/promises';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:8080'});
for(const key of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const output='.test-defects-race.mjs';
await build({entryPoints:['frontend/src/Defects.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',outfile:output});
const {Defects}=await import('../'+output);await unlink(output);
test('slower refresh cannot overwrite newer defect list',async t=>{
 const pending=[];
 t.mock.method(globalThis,'fetch',url=>url.endsWith('/team')?Promise.resolve(Response.json({members:[],invitations:[],role:'owner'})):new Promise(resolve=>pending.push(resolve)));
 const root=createRoot(document.getElementById('root'));
 const row=title=>[{id:'d',key:'BUG-1',title,status:'open',severity:'medium',actual:'',expected:'',steps:'',createdAt:new Date().toISOString()}];
 try {
  await act(async()=>root.render(React.createElement(Defects,{project:{id:'p',cases:[]},hosted:true,readOnly:false,draft:null,onDraftConsumed(){},onError(){}})));
  await act(async()=>document.querySelector('[aria-label="Обновить дефекты"]').click());
  assert.equal(pending.length,2);
  await act(async()=>pending[1](Response.json(row('New result'))));
  assert.match(document.body.textContent,/New result/);
  await act(async()=>pending[0](Response.json(row('Old result'))));
  assert.match(document.body.textContent,/New result/);assert.doesNotMatch(document.body.textContent,/Old result/);
 }finally{await act(async()=>root.unmount());}
});
