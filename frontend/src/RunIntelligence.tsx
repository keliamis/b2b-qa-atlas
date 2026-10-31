import {useMemo,useState} from 'react';
import type {Job} from './types';
import {reportOf,compareRuns,flakyCandidates,comparisonMarkdown,changeLabels,outcomeLabels,type Change} from './runAnalysis';
import {downloadText} from './download';
const stamp=(j:Job)=>`${new Date(j.created_at).toLocaleString()} · ${j.id.slice(0,8)}`;
export function RunIntelligence({runs,current,onSelect}:{runs:Job[];current?:Job;onSelect:(id:string)=>void}){
 const [baseline,setBaseline]=useState(''),[filter,setFilter]=useState('changes');
 const report=reportOf(current);
 const choices=runs.filter(j=>j.id!==current?.id&&reportOf(j)?.snapshot.framework===report?.snapshot.framework);
 const before=choices.find(j=>j.id===baseline)||choices.find(j=>j.created_at<(current?.created_at||''))||choices[0];
 const comparison=useMemo(()=>{const previous=reportOf(before);return previous&&report?compareRuns(previous,report):null;},[before,report]);
 const candidates=useMemo(()=>flakyCandidates(runs),[runs]);
 const rows=comparison?.rows.filter(r=>filter==='all'||filter==='changes'&&r.change!=='unchanged'||r.change===filter)||[];
 return <>
 <details className="card auto-panel" aria-label="Сравнение прогонов"><summary>Что изменилось между прогонами{comparison ? ` · регрессий: ${comparison.counts.regression}, исправлений: ${comparison.counts.fixed}` : ""}</summary>
  <p className="text-muted">Сравнение отдельных тест-кейсов по сохранённым результатам. Текущий прогон выбирается в истории ниже.</p>
  {!comparison?<p>Нужны два завершённых прогона одного фреймворка с сохранёнными снимками.</p>:<>
   <div className="auto-actions"><label>Базовый прогон <select aria-label="Базовый прогон" value={before.id} onChange={e=>setBaseline(e.target.value)}>{choices.map(j=><option key={j.id} value={j.id}>{stamp(j)}</option>)}</select></label><span>Текущий: {current&&stamp(current)}</span>
    <button className="button" onClick={()=>downloadText(`comparison-${before.id}-${current!.id}.md`,comparisonMarkdown(before,current!),'text/markdown;charset=utf-8')}>Скачать сравнение .md</button></div>
   {!comparison.sameSources&&<p>Исходники изменились. Сравниваем результаты; разницу процентов покрытия не вычисляем.</p>}
   {comparison.coverageDelta!==null&&<p>Покрытие на одинаковых исходниках: {comparison.coverageDelta>=0?'+':''}{comparison.coverageDelta.toFixed(2)} п.п.</p>}
   <div className="run-analysis-counts">{(['regression','fixed','changed','unknown'] as Change[]).map(k=><span key={k} className={`run-analysis-count ${k}`}>{changeLabels[k]}: <strong>{comparison.counts[k]}</strong></span>)}</div>
   <label>Показать <select aria-label="Изменения прогонов" value={filter} onChange={e=>setFilter(e.target.value)}><option value="changes">Все изменения</option><option value="all">Все проверки</option>{Object.entries(changeLabels).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
   <div className="run-analysis-table"><table><thead><tr><th>Тест-кейс</th><th>Было</th><th>Стало</th><th>Изменение</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.title}</td><td>{outcomeLabels[r.before]}</td><td>{outcomeLabels[r.after]}</td><td>{changeLabels[r.change]}</td></tr>)}</tbody></table></div>
   {!rows.length&&<p>Нет проверок для выбранного фильтра.</p>}
   <small>Изменённый код теста не считается исправлением продукта. Отсутствующие результаты не считаются PASS. «Не вошли в прогон» не означает удаление теста из проекта.</small>
  </>}
 </details>
 <details className="card auto-panel" aria-label="Нестабильные тесты"><summary>Кандидаты на нестабильность · {candidates.length}</summary>
  <p className="text-muted">Анализ доступной истории (до 50 последних автопрогонов): минимум 3 выполнения и 2 переключения PASS/FAIL при одинаковых исходниках, коде, сценарии и составе проверок. Ошибки инфраструктуры и пропуски исключены.</p>
  {!candidates.length?<p>Кандидатов не обнаружено. Если одинаковых повторных прогонов мало, это ещё не подтверждает стабильность.</p>:<>
   <button className="button" onClick={()=>downloadText('flaky-candidates.json',JSON.stringify({scope:'Доступные последние 50 автопрогонов',note:'Кандидаты, не подтверждённые дефекты',candidates},null,2),'application/json')}>Скачать доказательства .json</button>
   {candidates.map((c,i)=><details key={`${c.caseId}-${i}`}><summary>{c.title} · {c.framework} · PASS {c.passed} / FAIL {c.failed} · переключений {c.transitions}</summary>
    <p>Это наблюдение, а не диагноз. Проверьте зависимость от времени, порядка выполнения и окружения.</p>
    <ul>{c.evidence.map(e=><li key={e.runId}>{new Date(e.at).toLocaleString()} · {e.status.toUpperCase()} <button className="button" onClick={()=>onSelect(e.runId)}>Открыть прогон {e.runId.slice(0,8)}</button></li>)}</ul>
   </details>)}
  </>}
 </details>
 </>;
}
