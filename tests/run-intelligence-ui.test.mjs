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
const output='.test-run-intelligence.mjs';
await build({entryPoints:['frontend/src/RunIntelligence.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',outfile:output});
const {RunIntelligence}=await import('../'+output);
const make=(id,status)=>({id,kind:'autorun',status:'succeeded',created_at:`2026-01-01T00:00:0${id}.000Z`,result:{status,coverage:50,snapshot:{framework:'pytest',sources:[{name:'a.py',text:'x=1'}],tests:[{id:'c',title:'Boundary check',code:'test'}]},testResults:[{caseId:'c',name:'test_boundary',status}]}});
test('comparison selection and flaky evidence navigate to saved runs',async()=>{
 const root=createRoot(document.getElementById('root')),runs=[make('3','passed'),make('2','failed'),make('1','passed')];let selected;
 try{
  await act(async()=>root.render(React.createElement(RunIntelligence,{runs,current:runs[0],onSelect:id=>{selected=id;}})));
  assert.match(document.body.textContent,/Снова проходят: 1/);
  assert.match(document.body.textContent,/переключений 2/);
  const baseline=document.querySelector('[aria-label="Базовый прогон"]');
  await act(async()=>{baseline.value='1';baseline.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.match(document.body.textContent,/Снова проходят: 0/);
  const evidence=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Открыть прогон 2'));
  await act(async()=>evidence.click());assert.equal(selected,'2');
 }finally{await act(async()=>root.unmount());await unlink(output);}
});
