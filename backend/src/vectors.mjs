import {createHash} from 'node:crypto';
import {error} from './auth.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeURL=value=>{
  let u;try{u=new URL(value);}catch{throw error(503,'Некорректный EMBEDDING_BASE_URL');}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw error(503,'EMBEDDING_BASE_URL должен быть HTTPS URL без ключа и параметров');
  return u.href.replace(/\/$/,'');
};
export function embeddingConfig(env=process.env){
  const provider=env.EMBEDDING_PROVIDER||'';
  if(!['openai','yandex'].includes(provider))throw error(503,'Настройте EMBEDDING_PROVIDER: yandex или openai');
  // Reuse credentials only for the same explicitly selected provider.
  const key=env.EMBEDDING_API_KEY||((env.AI_PROVIDER||'openai')===provider?env.OPENAI_API_KEY:'');
  if(!key)throw error(503,'Не задан ключ EMBEDDING_API_KEY');
  const base=safeURL(env.EMBEDDING_BASE_URL||(provider==='yandex'?'https://llm.api.cloud.yandex.net/foundationModels/v1':'https://api.openai.com/v1'));
  const folder=env.YANDEX_FOLDER_ID||'';
  const documentModel=env.EMBEDDING_MODEL||(provider==='yandex'&&folder?`emb://${folder}/text-search-doc/latest`:'');
  const queryModel=provider==='yandex'?(env.EMBEDDING_QUERY_MODEL||(folder?`emb://${folder}/text-search-query/latest`:'')):documentModel;
  if(!documentModel||!queryModel)throw error(503,'Задайте модель эмбеддингов (для Yandex — YANDEX_FOLDER_ID или оба URI моделей)');
  const dimensions=env.EMBEDDING_DIMENSIONS?Number(env.EMBEDDING_DIMENSIONS):null;
  if(dimensions!==null&&(!Number.isInteger(dimensions)||dimensions<1||dimensions>16000))throw error(503,'Некорректная размерность эмбеддингов');
  return {provider,key,base,documentModel,queryModel,dimensions,modelKey:hash([provider,base,documentModel,queryModel,dimensions,'utf8-1800-v1'])};
}
export const requirementsHash=project=>hash(project.requirements.map(r=>[r.id,r.title,r.text]));
// Bound by UTF-8 bytes, not guessed token counts; keep every character.
export function chunks(text,limit=1800){
  const out=[];let current='',bytes=0;
  for(const char of text){const n=Buffer.byteLength(char);if(bytes+n>limit){out.push(current);current='';bytes=0;}current+=char;bytes+=n;}
  if(current.trim())out.push(current);return out;
}
export function validateVector(value,expected){
  if(!Array.isArray(value)||!value.length||value.length>16000||value.some(n=>typeof n!=='number'||!Number.isFinite(n))||!value.some(n=>n!==0))throw error(502,'Провайдер вернул некорректный embedding');
  if(expected&&value.length!==expected)throw error(502,'Размерность эмбеддингов изменилась. Перестройте индекс с согласованной моделью');
  return value;
}
export async function embedTexts(texts,config,{query=false,signal,fetcher=fetch}={}){
  if(!texts.length)return [];
  if(texts.some(t=>typeof t!=='string'||!t.trim()||Buffer.byteLength(t)>1800))throw error(400,'Текст для поиска слишком длинный (максимум 1800 байт UTF-8)');
  const post=async(body)=>{
    let response;
    try{response=await fetcher(config.base+(config.provider==='yandex'?'/textEmbedding':'/embeddings'),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:(config.provider==='yandex'?'Api-Key ':'Bearer ')+config.key},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});}
    catch{throw error(502,'Сервис эмбеддингов недоступен или превысил время ожидания');}
    if(!response.ok)throw error(502,`Сервис эмбеддингов: HTTP ${response.status}. Проверьте ключ, модель и квоту`);
    const raw=await response.text();if(raw.length>8_000_000)throw error(502,'Ответ embeddings API слишком большой');
    try{return JSON.parse(raw);}catch{throw error(502,'Embeddings API вернул не JSON');}
  };
  let vectors;
  if(config.provider==='yandex'){
    // Native Yandex API has paired document/query encoders in one vector space.
    vectors=await Promise.all(texts.map(async text=>{
      const data=await post({modelUri:query?config.queryModel:config.documentModel,text});
      if(!Array.isArray(data.embedding))throw error(502,'Нет embedding в ответе Yandex');
      return data.embedding.map(v=>typeof v==='string'&&v.trim()?Number(v):v);
    }));
  }else{
    const data=await post({model:config.documentModel,input:texts,encoding_format:'float',...(config.dimensions?{dimensions:config.dimensions}:{})});
    if(!Array.isArray(data.data)||data.data.length!==texts.length)throw error(502,'Неполный ответ embeddings API');
    const rows=[...data.data].sort((a,b)=>a.index-b.index);
    if(rows.some((r,i)=>r.index!==i))throw error(502,'Некорректные индексы embeddings API');
    vectors=rows.map(r=>r.embedding);
  }
  const dimensions=config.dimensions||vectors[0]?.length;
  return vectors.map(v=>validateVector(v,dimensions));
}
export function semanticStatus(db,project){
  if(db.dialect!=='postgres')return {ready:false,configured:false,reason:'Семантический поиск требует PostgreSQL + pgvector'};
  let config;try{config=embeddingConfig();}catch(e){return {ready:false,configured:false,reason:e.message};}
  const row=db.raw.prepare('SELECT * FROM semantic_indexes WHERE project_id=?').get(project.id);
  const ready=!!row&&row.model_key===config.modelKey&&row.requirements_hash===requirementsHash(project);
  return {configured:true,ready,reason:ready?'Индекс актуален':row?'Требования или модель изменились: перестройте индекс':'Индекс ещё не построен',model:config.documentModel,queryModel:config.queryModel,dimensions:row?.dimensions||null,chunks:row?.chunk_count||0,updatedAt:row?.updated_at||null};
}
export async function prepareIndex(project,{signal,progress=()=>{},config=embeddingConfig(),fetcher=fetch}={}){
  const rows=project.requirements.flatMap(r=>chunks(r.title+'\n'+r.text).map((content,i)=>({requirementId:r.id,chunkNo:i,content})));
  if(!rows.length)throw error(400,'Нет требований для индексации');
  if(rows.length>10000)throw error(413,'Более 10000 фрагментов: разделите проект');
  const size=config.provider==='yandex'?1:16;let dimensions=config.dimensions;
  for(let start=0;start<rows.length;start+=size){
    signal?.throwIfAborted();
    const batch=rows.slice(start,start+size);
    const vectors=await embedTexts(batch.map(r=>r.content),config,{signal,fetcher});
    dimensions ||= vectors[0].length;
    batch.forEach((r,i)=>{r.embedding=validateVector(vectors[i],dimensions);});
    progress(Math.min(start+size,rows.length),rows.length);
  }
  return {rows,dimensions,modelKey:config.modelKey,requirementsHash:requirementsHash(project)};
}
// Caller owns a transaction and checks permissions, cancellation and revision.
export function storeIndex(db,pid,index){
  db.raw.prepare('DELETE FROM semantic_chunks WHERE project_id=?').run(pid);
  const insert=db.raw.prepare('INSERT INTO semantic_chunks VALUES(?,?,?,?,?::vector)');
  for(const r of index.rows)insert.run(pid,r.requirementId,r.chunkNo,r.content,JSON.stringify(r.embedding));
  db.raw.prepare('INSERT INTO semantic_indexes VALUES(?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET model_key=excluded.model_key,requirements_hash=excluded.requirements_hash,dimensions=excluded.dimensions,chunk_count=excluded.chunk_count,updated_at=excluded.updated_at').run(pid,index.modelKey,index.requirementsHash,index.dimensions,index.rows.length,new Date().toISOString());
}
export async function relatedRequirements(db,project,text){
  const status=semanticStatus(db,project);if(!status.ready)throw error(409,status.reason);
  const config=embeddingConfig();
  const [vector]=await embedTexts([text],config,{query:true});validateVector(vector,status.dimensions);
  // Do not search a new/deleted/changed project using a stale request snapshot.
  const row=db.raw.prepare('SELECT data FROM projects WHERE id=?').get(project.id);
  if(!row||requirementsHash(JSON.parse(row.data))!==requirementsHash(project)||!semanticStatus(db,project).ready)throw error(409,'Требования изменились. Повторите поиск после перестроения индекса');
  return db.raw.prepare('SELECT requirement_id,MAX(1 - (embedding <=> ?::vector)) AS similarity FROM semantic_chunks WHERE project_id=? GROUP BY requirement_id ORDER BY similarity DESC LIMIT 5').all(JSON.stringify(vector),project.id).map(hit=>{
    const r=project.requirements.find(r=>r.id===hit.requirement_id);
    return {requirement_id:r.id,key:r.key,title:r.title,content:r.text,similarity:Number(hit.similarity)};
  });
}

