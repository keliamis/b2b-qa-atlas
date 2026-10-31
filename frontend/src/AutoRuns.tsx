import { useState, useEffect } from 'react';
import { Play, Download, Upload } from 'lucide-react';
import { cloud } from './cloud';
import { FailureTools } from './Insights';
import type { Project, Job, TestCase } from './types';
import './autoruns.css';
import {artifact,stale,sourceSignature} from './runAnalysis';
import {RunIntelligence} from './RunIntelligence';
import {downloadText as download} from './download';
export {artifact} from './runAnalysis';
export function Artifacts({test}:{test:TestCase}) {
  return <div className="auto-actions"><button className="button" onClick={()=>download(test.key+'.feature',test.gherkin)}><Download size={14}/> .feature</button>{(['pytest','playwright'] as const).map(f=><button className="button" key={f} disabled={!artifact(test,f)} onClick={()=>download(test.key+(f==='pytest'?'.py':'.spec.js'),artifact(test,f))}><Download size={14}/>{f==='pytest'?'.py':'.js'}</button>)}</div>;
}
export function RunMetrics({project,jobs}:{project:Project,jobs:Job[]}) {
  const latest=jobs.find(j=>j.kind==='autorun'&&j.result)?.result;
  const old=stale(project,latest);
  const count=latest ? latest.passed+latest.failed : 0;
  return <div className="auto-metrics">
    <div className="card"><small>Всего тест-кейсов</small><strong>{project.cases.length}</strong></div>
    <div className="card"><small>Покрытие строк · последний прогон</small><strong>{latest?.coverage==null?'—':latest.coverage+'%'}</strong><small>{old?'Устарело: код или тесты изменились':latest?latest.snapshot?.framework:'Ещё не измерялось'}</small></div>
    <div className="card"><small>Успешные проверки · последний прогон</small><strong>{count?Math.round(latest.passed/count*100)+'%':'—'}</strong><small>{latest?`${latest.passed} успешно · ${latest.failed} ошибок · ${latest.skipped} пропущено`:'Нет результатов'}</small></div>
  </div>;
}
export function SourcePanel({project,connected,readOnly,onError,onUploaded}:{project:Project,connected:boolean,readOnly:boolean,onError:(s:string)=>void,onUploaded:()=>void}) {
  const [selected,setSelected]=useState('');
  const [uploading,setUploading]=useState(false);
  const source=project.sources.find(s=>s.id===selected)||project.sources[0];
  async function upload(file:File|undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const form=new FormData();form.append('file',file);
      const r=await fetch('/api/projects/'+project.id+'/documents',{method:'POST',body:form});
      const data=await r.json();if(!r.ok)throw new Error(data.detail||'Ошибка загрузки');
      onUploaded();
    } catch(e) {onError((e as Error).message);} finally {setUploading(false);}
  }
  return <section className="card auto-panel">
    <h3>Материалы проекта</h3>
    <div className="auto-uploads">{[{label:'Требования и спецификации',accept:'.pdf,.docx,.md,.txt'},{label:'Исходный код приложения',accept:'.py,.js,.ts,.java'}].map(x=><label className="auto-upload" key={x.label}><Upload size={20}/><strong>{x.label}</strong><small>{x.accept}</small><input aria-label={x.label} type="file" accept={x.accept} disabled={!connected||readOnly||uploading} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label>)}</div>
    <p className="text-muted">{uploading?'Загрузка…':'Импорт выполняется в очереди. Повторная загрузка с тем же именем обновляет исходник.'}</p>
    {source?<><label>Исходный файл <select value={source.id} onChange={e=>setSelected(e.target.value)}>{project.sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><CodeView text={source.text}/></>:<p className="text-muted">Загрузите исходники — здесь появится их содержимое.</p>}
  </section>;
}
function CodeView({text,covered=[],missing=[]}:{text:string,covered?:number[],missing?:number[]}) {
  const hit=new Set(covered),miss=new Set(missing);
  return <pre className="auto-code">{text.split('\n').map((line,i)=><div key={i} className={miss.has(i+1)?'line-missing':hit.has(i+1)?'line-covered':''}><span aria-hidden="true">{i+1}</span><b aria-label={miss.has(i+1)?'Не покрыта':hit.has(i+1)?'Покрыта':'Не измеряется'}>{miss.has(i+1)?'−':hit.has(i+1)?'+':' '}</b><code>{line||' '}</code></div>)}</pre>;
}
const labels:Record<string,string>={queued:'В очереди',running:'Выполняется',succeeded:'Завершён',failed:'Ошибка',cancelled:'Отменён',passed:'Все проверки пройдены',error:'Ошибка исполнения',timed_out:'Превышен лимит времени'};
export function AutoRuns({project,connected,readOnly,coverageOnly=false,onError}:{project:Project,connected:boolean,readOnly:boolean,coverageOnly?:boolean,onError:(s:string)=>void}) {
  const [runs,setRuns]=useState<Job[]>([]),[active,setActive]=useState(''),[framework,setFramework]=useState('pytest'),[chosen,setChosen]=useState<string[]>([]),[pending,setPending]=useState(false),[file,setFile]=useState('');
  useEffect(()=>{setRuns([]);setActive('');setChosen([]);setFile('');if(!connected)return;let alive=true,pending=false;const poll=async()=>{if(pending)return;pending=true;try {const r=await cloud<Job[]>(`/projects/${project.id}/auto-runs`);if(alive)setRuns(r);}catch(e){if(alive)onError((e as Error).message);}finally{pending=false;}};void poll();const id=setInterval(poll,2000);return()=>{alive=false;clearInterval(id);};},[project.id,connected]);
  const [target,setTarget]=useState(80);
  const run=runs.find(r=>r.id===active)||runs[0];const report=run?.result;
  const previous = report?.coverage == null ? null : runs.slice(runs.findIndex(r=>r.id===run?.id)+1).map(r=>r.result).find(r=>r?.coverage!=null && r.snapshot?.framework===report.snapshot?.framework && sourceSignature(r.snapshot?.sources||[])===sourceSignature(report.snapshot?.sources||[]));
  const runnable=project.cases.filter(c=>artifact(c,framework));
  const noCode=project.cases.filter(c=>!artifact(c,framework));
  const ids=chosen.filter(id=>runnable.some(c=>c.id===id));
  const busy=pending||runs.some(r=>['queued','running'].includes(r.status));
  const sources=report?.snapshot?.sources||[];
  const source=sources.find((s:any)=>s.name===file)||sources[0];
  const cov=report?.files?.find((f:any)=>f.name===source?.name);
  async function start(){setPending(true);try{const j=await cloud<Job>(`/projects/${project.id}/auto-runs`,'POST',{framework,case_ids:ids});setRuns(r=>[j,...r]);setActive(j.id);}catch(e){onError((e as Error).message);}finally{setPending(false);}}
  return <div className="auto-workspace">
    {!coverageOnly&&<section className="card auto-panel"><h3>Запуск автотестов</h3><p className="text-muted">Выберите проверки. Прогон выполняется на сервере в отдельном контейнере, до 75 секунд. Поддерживаются Python и JavaScript модули без внешних зависимостей.</p>
      <div className="auto-actions"><select aria-label="Фреймворк" value={framework} onChange={e=>{setFramework(e.target.value);setChosen([]);}}><option value="pytest">Python · pytest</option><option value="playwright">JavaScript · Playwright</option></select><button className="button" onClick={()=>setChosen(runnable.filter(c=>!c.duplicateOf).slice(0,50).map(c=>c.id))}>Выбрать все (до 50)</button><button className="button primary" disabled={!connected||readOnly||busy||!ids.length} onClick={()=>void start()}><Play size={16}/>{busy?'Выполняется…':`Запустить (${ids.length})`}</button></div>
      {!connected&&<p>Войдите в серверную версию для запуска.</p>}
      {!!noCode.length&&<details><summary>Без кода для {framework}: {noCode.length}</summary><p>«Оставить оба» сохраняет сценарии, но не создаёт исполняемый код. Сгенерируйте код для выбранного фреймворка в тест-кейсе.</p>{noCode.map(c=><p key={c.id}>{c.key} · {c.title}</p>)}</details>}
      {!runnable.length&&<p>Нет кода для этого фреймворка. Создайте тесты с включённой генерацией кода или вставьте код в редакторе тест-кейса.</p>}
      <div className="auto-test-list">{runnable.map(c=><label key={c.id}><input type="checkbox" checked={ids.includes(c.id)} disabled={busy||readOnly} onChange={e=>setChosen(v=>e.target.checked?[...v,c.id]:v.filter(x=>x!==c.id))}/><span>{c.key} · {c.title}{c.duplicateOf?' · Дубликат':''}</span><small>{c.status==='approved'?'Утверждён':'Черновик / ревью'}</small></label>)}</div>
    </section>}
    <RunMetrics project={project} jobs={runs}/>
    {!coverageOnly&&<RunIntelligence key={project.id} runs={runs} current={run} onSelect={setActive}/>}
    <section className="card auto-panel"><div className="auto-actions"><h3>{coverageOnly?'Покрытие кода':'История автопрогонов'}</h3>{run&&<select aria-label="Прогон" value={run.id} onChange={e=>setActive(e.target.value)}>{runs.map(r=><option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} · {labels[r.status]}</option>)}</select>}</div>
      {!run&&<p>Запустите автотесты, чтобы получить отчёт. Покрытие требований доступно отдельно во вкладке «Связи и покрытие».</p>}
      {run&&<><p role="status">{labels[run.status]}{report?' · '+(labels[report.status]||report.status):''}</p>{run.error&&<p role="alert">{run.error}</p>}{['queued','running'].includes(run.status)&&<button className="button" disabled={readOnly} onClick={async()=>{try{await cloud(`/jobs/${run.id}/cancel`,'POST');setRuns(await cloud<Job[]>(`/projects/${project.id}/auto-runs`));}catch(e){onError((e as Error).message);}}}>Отменить прогон</button>}</>}
      {report&&<><p>{stale(project,report)?'⚠ Отчёт устарел: исходники или тесты изменились. Ниже показан сохранённый снимок.':'Сохранённый снимок прогона'} · версия {report.snapshot.projectRevision} · {report.snapshot.framework}</p><button className="button" onClick={()=>download('run-'+run.id+'.json',JSON.stringify(report,null,2))}><Download size={14}/> Скачать отчёт</button>
        <p>Проверок: {report.total} · успешно: {report.passed} · ошибок: {report.failed} · пропущено: {report.skipped}. Покрытие: {report.coverage==null?'нет данных':report.coverage+'%'}.</p>
        {report.coverage != null && <p className="text-muted">Строк исходников выполнено: {report.files.reduce((n:number,f:any)=>n+f.covered.length,0)} из {report.files.reduce((n:number,f:any)=>n+f.covered.length+f.missing.length,0)}. Строки комментариев и пустые строки не учитываются.</p>}
        {report.coverage != null && report.coverage < 70 && <p className="text-muted">Низкое покрытие строк: изучите непокрытые участки ниже, добавьте целевые сценарии для неисполненных ветвей и запустите повторный прогон. Количество тестов само по себе не повышает покрытие.</p>}
        {report.status==='error' && <p role="alert">Прогон завершён ошибкой подготовки или сбора тестов. Процент покрытия в таком случае не рассчитывается.</p>}
        {report.coverage != null && <div className="auto-actions"><label>Целевое покрытие: <input aria-label="Целевое покрытие" type="number" min={0} max={100} value={target} onChange={e=>setTarget(Math.max(0,Math.min(100,Number(e.target.value))))} style={{width:80}}/> %</label><span>{report.coverage>=target?'Цель достигнута':`До цели: ${(target-report.coverage).toFixed(2)} п.п.`}</span><span>{previous?`Изменение к предыдущему измерению: ${report.coverage-previous.coverage>=0?'+':''}${(report.coverage-previous.coverage).toFixed(2)} п.п.`:'Нет предыдущего измерения на тех же исходниках'}</span></div>}
        {report.testResults?.length>0&&<details><summary>Результаты отдельных проверок ({report.testResults.length})</summary><ul>{report.testResults.map((t:any,i:number)=><li key={i}>{t.name} · {t.status==='passed'?'Успешно':t.status==='skipped'?'Пропущено':'Ошибка'} · {t.duration.toFixed(3)} с{t.status==='failed'&&<FailureTools key={run.id+':'+i} project={project} runId={run.id} index={i} readOnly={readOnly} onError={onError}/>}</li>)}</ul></details>}
        <details open={!coverageOnly}><summary>Журнал выполнения</summary><pre className="auto-log">{report.logs||'Журнал пуст'}</pre></details>
        {source&&<><div className="auto-actions"><select aria-label="Файл покрытия" value={source.name} onChange={e=>setFile(e.target.value)}>{sources.map((s:any)=><option key={s.name}>{s.name}</option>)}</select><span>+ зелёный — покрыто · − красный — не покрыто</span></div>{!cov&&<p>Для этого файла данные покрытия не получены.</p>}<CodeView text={source.text} covered={cov?.covered} missing={cov?.missing}/></>}
        <small>Измеряется покрытие строк исходников. Для Playwright — выполнение JS в Node; покрытие кода внутри браузера здесь не измеряется.</small>
      </>}
    </section>
  </div>;
}
