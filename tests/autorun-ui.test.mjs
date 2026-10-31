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
await build({entryPoints:['frontend/src/AutoRuns.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',loader:{'.css':'empty'},outfile:'.auto-ui-test.mjs'});
const {AutoRuns}=await import('../.auto-ui-test.mjs');
test('UI queues selected test, shows immutable coverage and disables viewer writes',async()=>{
 const project={id:'p',name:'P',revision:1,cases:[{id:'c',title:'Check',key:'TC-1',framework:'pytest',code:'code',status:'draft'}],sources:[{id:'s',name:'target.py',text:'x=1\ny=2'}]};
 const report={id:'j',kind:'autorun',status:'succeeded',created_at:new Date().toISOString(),result:{status:'passed',total:1,passed:1,failed:0,skipped:0,coverage:50,logs:'1 passed',snapshot:{framework:'pytest',projectRevision:1,sources:project.sources,tests:[{id:'c',code:'code'}]},files:[{name:'target.py',covered:[1],missing:[2]}]}};
 let posts=[];
 globalThis.fetch=async(url,opts={})=>({ok:true,json:async()=>{if(opts.method==='POST'){posts.push(JSON.parse(opts.body));return report;}return [];}});
 const root=createRoot(document.getElementById('root'));
 const render=(readOnly=false)=>root.render(React.createElement(AutoRuns,{project,connected:true,readOnly,onError:s=>{throw new Error(s);}}));
 try {
 await act(async()=>render());
 await act(async()=>document.querySelector('input[type="checkbox"]').click());
 let start=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Запустить'));
 assert.equal(start.disabled,false);
 await act(async()=>start.click());
 assert.deepEqual(posts,[{framework:'pytest',case_ids:['c']}]);
 assert.equal(document.querySelectorAll('.line-covered').length,1);assert.equal(document.querySelectorAll('.line-missing').length,1);
 assert.match(document.body.textContent,/50%/);
 project.sources=[{id:'s',name:'target.py',text:'changed'}];
 await act(async()=>render(true));
 assert.match(document.body.textContent,/устарел/);
 assert.equal(document.querySelector('input[type="checkbox"]').disabled,true);
 assert.equal(document.querySelector('.auto-code').textContent.includes('x=1'),true);
 } finally {await act(async()=>root.unmount());await fs.unlink('.auto-ui-test.mjs');}
});
