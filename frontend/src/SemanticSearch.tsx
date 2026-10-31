import {useEffect,useRef,useState} from 'react';
import {cloud} from './cloud';
import type {Project} from './types';
import './semantic-search.css';
type Status={ready:boolean;configured:boolean;reason:string;model?:string;dimensions?:number;chunks?:number};
type Hit={requirement_id:string;key:string;title:string;content:string;similarity:number};
export function SemanticSearch({project,readOnly}:{project:Project;readOnly:boolean}) {
 const [status,setStatus]=useState<Status|null>(null),[query,setQuery]=useState(''),[hits,setHits]=useState<Hit[]>([]),[searched,setSearched]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[job,setJob]=useState<any>(null);
 const active=useRef(true),base=`/projects/${project.id}`;
 useEffect(()=>{active.current=true;let disposed=false,pending=false;
  const refresh=async()=>{if(pending)return;pending=true;try{
   const [s,jobs]=await Promise.all([cloud<Status>(base+'/insights/semantic-status'),cloud<any[]>(base+'/jobs')]);
   if(disposed)return;setStatus(s);setJob(jobs.find(j=>j.kind==='embeddings')||null);
  }catch(e){if(!disposed)setMessage((e as Error).message);}finally{pending=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),4000);
  return()=>{disposed=true;active.current=false;clearInterval(timer);};
 },[base]);
 async function build(){setBusy(true);setMessage('');try{const j=await cloud<any>(base+'/semantic-index','POST',{});if(active.current){setJob(j);setMessage('Построение индекса добавлено в фоновые задачи.');}}catch(e){if(active.current)setMessage((e as Error).message);}finally{if(active.current)setBusy(false);}}
 async function search(){setBusy(true);setMessage('');setHits([]);setSearched(false);try{const r=await cloud<{results:Hit[]}>(base+'/insights/semantic-search','POST',{query});if(active.current){setHits(r.results);setSearched(true);}}catch(e){if(active.current)setMessage((e as Error).message);}finally{if(active.current)setBusy(false);}}
 const running=job&&['queued','running'].includes(job.status);
 return <section aria-label="Семантический поиск" className="card auto-panel"><h3>Поиск требований по смыслу</h3>
  <p>Например, «восстановить доступ к аккаунту» найдёт близкие по смыслу требования, даже если они сформулированы иначе.</p>
  <p>{status?.reason||'Проверка индекса…'}{status?.ready&&` · ${status.chunks} фрагментов · ${status.dimensions} измерений`}</p>
  <button className="button semantic-index-button" type="button" disabled={busy||readOnly||running||!status?.configured||!project.requirements.length} onClick={()=>void build()}>Построить / обновить индекс</button>
  {job&&<p role="status">{job.error||job.progress}</p>}
  {!status?.configured&&status&&<p>Администратору нужно настроить embeddings API на сервере. Генерация тестов работает независимо от этого поиска.</p>}
  <form className="semantic-search-form" onSubmit={e=>{e.preventDefault();if(!busy&&status?.ready&&query.trim())void search();}}>
   <label className="semantic-search-label">Что найти?<input value={query} maxLength={400} onChange={e=>setQuery(e.target.value)} placeholder="Восстановление доступа к аккаунту"/></label>
   <button className="button" disabled={busy||!status?.ready||!query.trim()}>Найти по смыслу</button>
  </form>
  {message&&<p role="status">{message}</p>}
  {searched&&<p>Найдено: {hits.length}. Сходство — подсказка для поиска, не доказательство соответствия требования.</p>}
  {hits.map(hit=><details key={hit.requirement_id}><summary>{hit.key} · {hit.title} · сходство {hit.similarity.toFixed(3)}</summary><pre style={{whiteSpace:'pre-wrap'}}>{hit.content}</pre></details>)}
 </section>;
}
