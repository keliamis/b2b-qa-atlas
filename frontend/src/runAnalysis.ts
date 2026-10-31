import type {Job, Project, TestCase, SourceFile} from './types';
export type Framework='pytest'|'playwright';
export type Outcome='passed'|'failed'|'skipped'|'unknown';
export interface RunTest {id:string;title?:string;code:string;gherkin?:string}
export interface Check {caseId?:string;name:string;status:'passed'|'failed'|'skipped';duration:number}
export interface RunReport {
 status:string;coverage:number|null;passed:number;failed:number;skipped:number;
 snapshot:{framework:Framework;projectRevision:number;sources:SourceFile[];tests:RunTest[]};
 testResults?:Check[];
}
export const artifact=(test:TestCase,framework:string)=>test.artifacts?.[framework as Framework]||(test.framework===framework?test.code:'');
// IDs, upload order and display metadata do not change executable source content.
export const sourceSignature=(sources:Pick<SourceFile,'name'|'text'>[])=>JSON.stringify(sources.map(s=>[s.name,s.text]).sort((a,b)=>a[0].localeCompare(b[0])));
export function reportOf(job:Job|undefined):RunReport|null {
 const r=job?.result;
 return job?.kind==='autorun'&&job.status==='succeeded'&&r&&['pytest','playwright'].includes(r.snapshot?.framework)&&Array.isArray(r.snapshot?.sources)&&Array.isArray(r.snapshot?.tests)?r:null;
}
export function stale(project:Project,report:RunReport|null|undefined){
 if(!report?.snapshot||!Array.isArray(report.snapshot.sources)||!Array.isArray(report.snapshot.tests))return true;
 const s=report.snapshot,suffix=s.framework==='pytest'?'.py':'.js';
 return sourceSignature(project.sources.filter(x=>x.name.endsWith(suffix)))!==sourceSignature(s.sources)||s.tests.some(t=>{
  const c=project.cases.find(c=>c.id===t.id);return !c||artifact(c,s.framework)!==t.code;
 });
}
function checks(report:RunReport,id:string){return (report.testResults||[]).filter(t=>t.caseId===id);}
function outcome(report:RunReport,id:string):Outcome {
 if(!['passed','failed'].includes(report.status))return 'unknown';
 const rows=checks(report,id);
 if(!rows.length)return 'unknown';
 if(rows.some(t=>t.status==='failed'))return 'failed';
 if(rows.every(t=>t.status==='passed'))return 'passed';
 return 'skipped';
}
const checkNames=(r:RunReport,id:string)=>JSON.stringify(checks(r,id).map(t=>t.name).sort());
export type Change='regression'|'fixed'|'changed'|'added'|'removed'|'unknown'|'unchanged';
export interface ComparisonRow {id:string;title:string;before:Outcome;after:Outcome;change:Change}
export function compareRuns(before:RunReport,after:RunReport){
 if(before.snapshot.framework!==after.snapshot.framework)return null;
 const old=new Map(before.snapshot.tests.map(t=>[t.id,t])),next=new Map(after.snapshot.tests.map(t=>[t.id,t]));
 const rows:ComparisonRow[]=[...new Set([...old.keys(),...next.keys()])].map(id=>{
  const a=old.get(id),b=next.get(id),previous=outcome(before,id),current=outcome(after,id);
  let change:Change='unchanged';
  if(!a)change='added';else if(!b)change='removed';
  else if(a.code!==b.code||(a.gherkin||'')!==(b.gherkin||''))change='changed';
  else if(previous==='unknown'||current==='unknown'||previous==='skipped'||current==='skipped')change='unknown';
  else if(checkNames(before,id)!==checkNames(after,id))change='changed';
  else if(previous==='passed'&&current==='failed')change='regression';
  else if(previous==='failed'&&current==='passed')change='fixed';
  return {id,title:b?.title||a?.title||id,before:previous,after:current,change};
 });
 const sameSources=sourceSignature(before.snapshot.sources)===sourceSignature(after.snapshot.sources);
 // Coverage deltas only compare the same executable source baseline.
 const coverageDelta=sameSources&&Number.isFinite(before.coverage)&&Number.isFinite(after.coverage)&&before.coverage!==null&&after.coverage!==null?after.coverage-before.coverage:null;
 return {rows,sameSources,coverageDelta,counts:Object.fromEntries((['regression','fixed','changed','added','removed','unknown','unchanged'] as Change[]).map(k=>[k,rows.filter(r=>r.change===k).length])) as Record<Change,number>};
}
export interface FlakyCandidate {caseId:string;title:string;framework:Framework;transitions:number;passed:number;failed:number;evidence:{runId:string;at:string;status:'passed'|'failed'}[]}
export function flakyCandidates(jobs:Job[]):FlakyCandidate[]{
 const versions=new Map<string,Map<string,FlakyCandidate>>();
 const ordered=[...jobs].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 for(const job of ordered){
  const report=reportOf(job);if(!report||!['passed','failed'].includes(report.status))continue;
  const sourceKey=report.snapshot.framework+sourceSignature(report.snapshot.sources);
  let group=versions.get(sourceKey);if(!group){group=new Map();versions.set(sourceKey,group);}
  for(const c of report.snapshot.tests){
   const state=outcome(report,c.id);if(state!=='passed'&&state!=='failed')continue;
   // Exclude incomplete/skipped parameter sets from stability evidence.
   if(checks(report,c.id).some(t=>t.status==='skipped'))continue;
   const key=JSON.stringify([c.id,c.code,c.gherkin||'',checkNames(report,c.id)]);
   let row=group.get(key);if(!row){row={caseId:c.id,title:c.title||c.id,framework:report.snapshot.framework,transitions:0,passed:0,failed:0,evidence:[]};group.set(key,row);}
   const last=row.evidence.at(-1);if(last&&last.status!==state)row.transitions++;
   row[state]++;row.evidence.push({runId:job.id,at:job.created_at,status:state});
  }
 }
 return [...versions.values()].flatMap(g=>[...g.values()]).filter(r=>r.evidence.length>=3&&r.transitions>=2).sort((a,b)=>b.transitions-a.transitions);
}
export const changeLabels:Record<Change,string>={regression:'Начали падать',fixed:'Снова проходят',changed:'Проверка изменена',added:'Добавлены в прогон',removed:'Не вошли в прогон',unknown:'Недостаточно данных',unchanged:'Без изменений'};
export const outcomeLabels:Record<Outcome,string>={passed:'PASS',failed:'FAIL',skipped:'SKIP',unknown:'Нет данных'};
export function comparisonMarkdown(before:Job,after:Job){
 const a=reportOf(before),b=reportOf(after);if(!a||!b)return '';
 const c=compareRuns(a,b);if(!c)return '';
 const cell=(v:string)=>v.replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
 return [`# Сравнение автопрогонов`, `Базовый: ${before.id} (${before.created_at})`, `Текущий: ${after.id} (${after.created_at})`, `Фреймворк: ${a.snapshot.framework}`,c.sameSources?'Исходники совпадают.':'Исходники изменились. Изменение результата не доказывает его причину.',c.coverageDelta===null?'Изменение покрытия не сопоставляется.':`Изменение покрытия: ${c.coverageDelta.toFixed(2)} п.п.`, '', '| Тест-кейс | Было | Стало | Изменение |','|---|---|---|---|',...c.rows.map(r=>`| ${cell(r.title)} (${cell(r.id)}) | ${outcomeLabels[r.before]} | ${outcomeLabels[r.after]} | ${changeLabels[r.change]} |`),'','Отчёт относится к выбранным снимкам, а не ко всему проекту. PASS/FAIL агрегированы по тест-кейсу; изменение кода теста не считается исправлением продукта.'].join('\n\n').replace(/\|\n\n\|/g,'|\n|');
}
