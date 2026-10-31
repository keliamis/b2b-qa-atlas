import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import React,{act} from 'react';
import fs from 'node:fs/promises';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:8080'});
for(const key of ['window','document','HTMLElement','Event','MouseEvent'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
await build({entryPoints:['frontend/src/Insights.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',outfile:'.insights-ui-test.mjs'});
const {ProjectInsights,FailureTools}=await import('../.insights-ui-test.mjs');
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
test('UI creates recommendation draft, shows analysis and editable report, closes panels and recovers from errors',async()=>{
 const project={id:'p',name:'Shop',revision:1,cases:[],sources:[],requirements:[{id:'r'}],audit:[]};let next,fail=false;const errors=[];
 globalThis.fetch=async(url)=>({ok:!fail,json:async()=>fail?{detail:'ИИ недоступен'}:url.endsWith('/coverage')?{recommendations:[{id:'boundary:r:5000',title:'5000.00',requirementId:'r',type:'boundary',priority:'high',scenario:'Given cart\nWhen amount 5000.00\nThen correct'}],metrics:{requirementsLinked:0,requirementsTotal:1,codeCoverage:null}}:url.endsWith('/scenario')?{cases:[{title:'Boundary',gherkin:'Given amount 5000\nWhen calculate_total\nThen result 4500',assumptions:[]}],questions:[]}:url.endsWith('/detective')?{data:{explanation:'Mismatch',confidence:'low',insufficient_data:true}}:{id:'report',record_key:'j:0',updated_at:'now',data:{markdown:'# Failure\nTraceback'}}});
 const root=createRoot(document.getElementById('root'));const props={project,connected:true,readOnly:false,onError:e=>errors.push(e),onCommit:async p=>{next=p;return true;},onOpen:()=>{}};
 try{
 await act(async()=>root.render(React.createElement(ProjectInsights,{...props,section:'coverage'})));
 await act(async()=>button('Проверить пробелы').click());await act(async()=>button('Создать атомарные черновики').click());assert.equal(next.cases[0].status,'draft');assert.deepEqual(next.cases[0].requirementIds,['r']);
 await act(async()=>root.render(React.createElement(FailureTools,{...props,runId:'j',index:0})));
 await act(async()=>button('Анализировать ошибку с ИИ').click());assert.match(document.body.textContent,/Mismatch/);await act(async()=>button('Закрыть анализ').click());assert.ok(!document.body.textContent.includes('Mismatch'));
 await act(async()=>button('Создать баг-репорт').click());assert.equal(document.querySelector('textarea').value,'# Failure\nTraceback');await act(async()=>button('Закрыть').click());assert.equal(document.querySelector('textarea'),null);
 fail=true;await act(async()=>button('Анализировать ошибку с ИИ').click());assert.equal(errors.at(-1),'ИИ недоступен');assert.equal(button('Анализировать ошибку с ИИ').disabled,false);
 await act(async()=>root.render(React.createElement(FailureTools,{...props,runId:'j',index:0,readOnly:true})));assert.equal(button('Создать баг-репорт').disabled,true);
 }finally{await act(async()=>root.unmount());}
});

test('test data UI sends the selected requirement and clears prior results on selection change',async()=>{
 const project={id:'p',name:'Large document',revision:1,cases:[],sources:[],audit:[],requirements:Array.from({length:51},(_,i)=>({id:'r'+(i+1),key:'REQ-'+String(i+1).padStart(3,'0'),title:'Rule '+(i+1),text:'Full rule '.repeat(200)}))};
 let payload;
 globalThis.fetch=async(url,opts)=>({ok:true,json:async()=>{payload=JSON.parse(opts.body);return {requirement:project.requirements.find(r=>r.id===payload.requirementId),fields:[],rows:[],assumptions:[],csv:''};}});
 const root=createRoot(document.getElementById('root'));
 try{
  await act(async()=>root.render(React.createElement(ProjectInsights,{project,section:'requirements',connected:true,readOnly:false,onCommit:async()=>true,onOpen:()=>{},onError:s=>{throw new Error(s);}})));
  const select=document.querySelector('[aria-label="Требование для генерации данных"]');
  await act(async()=>{select.value='r51';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>button('Сгенерировать тестовые данные').click());
  assert.equal(payload.requirementId,'r51');assert.equal(payload.count,20);
  assert.match(document.body.textContent,/Данные для REQ-051/);
  await act(async()=>{select.value='r1';select.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.ok(!document.body.textContent.includes('Данные для REQ-051'));
 }finally{await act(async()=>root.unmount());}
});
test.after(()=>fs.unlink('.insights-ui-test.mjs'));
