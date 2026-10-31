import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const temp=await mkdtemp(join(tmpdir(),'atlas-analysis-'));
await build({entryPoints:['frontend/src/runAnalysis.ts'],bundle:true,platform:'node',format:'esm',outfile:join(temp,'analysis.mjs')});
const {compareRuns,flakyCandidates,stale,comparisonMarkdown}=await import(pathToFileURL(join(temp,'analysis.mjs')));
function job(id,states,options={}){
 const tests=Object.keys(states).map(id=>({id,title:'Case '+id,code:options.code||'def test_value(): pass',gherkin:'Given state'}));
 return {id,kind:'autorun',status:'succeeded',created_at:`2026-01-01T00:00:0${id}.000Z`,result:{status:Object.values(states).includes('failed')?'failed':'passed',coverage:options.coverage??50,snapshot:{framework:options.framework||'pytest',sources:[{id:options.sourceId||'s',name:'target.py',text:options.source||'x=1'}],tests},testResults:Object.entries(states).map(([caseId,status])=>({caseId,name:'test_'+caseId,status,duration:0.01}))}};
}
test('comparison separates regressions, recoveries, scope and changed tests',()=>{
 const a=job('1',{a:'passed',b:'failed',c:'passed',d:'passed'}),b=job('2',{a:'failed',b:'passed',c:'passed',e:'passed'});
 b.result.snapshot.tests.find(t=>t.id==='c').code='changed assertion';
 const result=compareRuns(a.result,b.result);
 assert.deepEqual(Object.fromEntries(result.rows.map(r=>[r.id,r.change])),{a:'regression',b:'fixed',c:'changed',d:'removed',e:'added'});
});
test('coverage is not compared across source changes/frameworks; metadata does not invalidate source',()=>{
 const a=job('1',{a:'passed'}),b=job('2',{a:'passed'},{sourceId:'reuploaded',coverage:80});
 assert.equal(compareRuns(a.result,b.result).coverageDelta,30);
 b.result.snapshot.sources[0].text='x=2';assert.equal(compareRuns(a.result,b.result).coverageDelta,null);
 b.result.snapshot.framework='playwright';assert.equal(compareRuns(a.result,b.result),null);
});
test('missing evidence, collection errors and skips never count as pass/fix',()=>{
 const a=job('1',{a:'failed'}),b=job('2',{a:'passed'});
 b.result.testResults=[];assert.equal(compareRuns(a.result,b.result).rows[0].change,'unknown');
 b.result=job('2',{a:'skipped'}).result;assert.equal(compareRuns(a.result,b.result).rows[0].change,'unknown');
 b.result=job('2',{a:'passed'}).result;b.result.status='error';assert.equal(compareRuns(a.result,b.result).rows[0].change,'unknown');
});
test('flaky candidates require repeat oscillation on identical snapshots',()=>{
 const runs=[job('1',{a:'passed'}),job('2',{a:'failed'}),job('3',{a:'passed'})];
 const c=flakyCandidates(runs);assert.equal(c.length,1);assert.equal(c[0].transitions,2);assert.equal(c[0].evidence.length,3);
 assert.equal(flakyCandidates(runs.slice(0,2)).length,0);
 assert.equal(flakyCandidates([job('1',{a:'failed'}),job('2',{a:'failed'}),job('3',{a:'passed'})]).length,0);
 runs[1].result.snapshot.sources[0].text='other source';assert.equal(flakyCandidates(runs).length,0);
});
test('test edits, changing parameter sets and skipped execution are not flaky evidence',()=>{
 for(const modify of [r=>r.snapshot.tests[0].code='different',r=>r.testResults[0].name='other param',r=>r.testResults.push({caseId:'a',name:'skipped',status:'skipped'}),r=>r.status='timed_out']){
  const runs=[job('1',{a:'passed'}),job('2',{a:'failed'}),job('3',{a:'passed'})];modify(runs[1].result);assert.equal(flakyCandidates(runs).length,0);
 }
});
test('stale ignores source identifiers and ordering, detects changed executable code',()=>{
 const r=job('1',{a:'passed'}).result,p={sources:[{id:'new',name:'target.py',text:'x=1'}],cases:[{id:'a',framework:'pytest',code:r.snapshot.tests[0].code}]};
 assert.equal(stale(p,r),false);p.cases[0].code='changed';assert.equal(stale(p,r),true);assert.equal(stale(p,null),true);
});
test('Markdown export preserves snapshot identity and escapes table content',()=>{
 const a=job('1',{a:'passed'}),b=job('2',{a:'failed'});b.result.snapshot.tests[0].title='A | B\nC';
 const text=comparisonMarkdown(a,b);assert.ok(text.includes('A \\| B C'));assert.ok(text.includes('Начали падать'));assert.ok(text.includes('Текущий: 2'));
});
test.after(()=>rm(temp,{recursive:true,force:true}));
