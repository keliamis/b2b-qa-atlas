import test from 'node:test';
import assert from 'node:assert/strict';
import {embeddingConfig,chunks,embedTexts,prepareIndex,requirementsHash,semanticStatus,relatedRequirements} from '../backend/src/vectors.mjs';
const env={EMBEDDING_PROVIDER:'openai',EMBEDDING_MODEL:'embedding-test',EMBEDDING_API_KEY:'test-only',EMBEDDING_BASE_URL:'https://provider.test/v1'};
const cfg=()=>embeddingConfig(env);
const project={id:'p',requirements:[{id:'r1',key:'REQ-001',title:'Login',text:'Вход в аккаунт'},{id:'r2',key:'REQ-002',title:'Basket',text:'Добавление товара'}]};
test('chunks preserve all text and respect UTF-8 budget',()=>{const text='Юникод🙂\n'.repeat(1200);const parts=chunks(text);assert.equal(parts.join(''),text);assert.ok(parts.every(p=>Buffer.byteLength(p)<=1800));});
test('OpenAI uses embedding model, sorts index and validates dimensions',async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return Response.json({data:[{index:1,embedding:[0,1,0]},{index:0,embedding:[1,0,0]}]});};
 assert.deepEqual(await embedTexts(['a','b'],cfg(),{fetcher}),[[1,0,0],[0,1,0]]);
 assert.equal(calls[0].url,'https://provider.test/v1/embeddings');assert.equal(JSON.parse(calls[0].options.body).model,'embedding-test');
 await assert.rejects(embedTexts(['a','b'],{...cfg(),dimensions:4},{fetcher}),/Размерность/);
});
test('Yandex uses native API and paired models in one vector space',async()=>{
 const config=embeddingConfig({EMBEDDING_PROVIDER:'yandex',AI_PROVIDER:'yandex',OPENAI_API_KEY:'fake',YANDEX_FOLDER_ID:'folder'});
 const bodies=[];const fetcher=async(url,opt)=>{assert.equal(url,'https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding');assert.equal(opt.headers.Authorization,'Api-Key fake');bodies.push(JSON.parse(opt.body));return Response.json({embedding:['0.5','0.8']});};
 await embedTexts(['document'],config,{fetcher});await embedTexts(['query'],config,{fetcher,query:true});
 assert.equal(bodies[0].modelUri,'emb://folder/text-search-doc/latest');assert.equal(bodies[1].modelUri,'emb://folder/text-search-query/latest');
});
test('no fallback to hashes on missing config or provider failure',async()=>{
 assert.throws(()=>embeddingConfig({}),/EMBEDDING_PROVIDER/);
 assert.throws(()=>embeddingConfig({...env,EMBEDDING_BASE_URL:'http://unsafe.test'}),/HTTPS/);
 await assert.rejects(embedTexts(['a'],cfg(),{fetcher:async()=>new Response('secret body',{status:403})}),e=>e.status===502&&!e.message.includes('secret body'));
 await assert.rejects(embedTexts(['a'],cfg(),{fetcher:async()=>Response.json({data:[{index:0,embedding:[0,0]}]})}),/некорректный embedding/);
});
test('index preparation uses full text and never writes partial provider output',async()=>{
 const source={id:'p',requirements:[{id:'r',title:'REQ-051',text:'длинное требование '.repeat(4000)}]};let calls=0;
 const result=await prepareIndex(source,{config:cfg(),fetcher:async(_,opt)=>{calls++;return Response.json({data:JSON.parse(opt.body).input.map((_,i)=>({index:i,embedding:[1,0]}))});}});
 assert.ok(calls>1);assert.equal(result.rows.map(r=>r.content).join(''),'REQ-051\n'+source.requirements[0].text);assert.equal(result.dimensions,2);
});
test('dimension drift across provider batches rejects index',async()=>{
 let calls=0;await assert.rejects(prepareIndex({id:'p',requirements:[{id:'r',title:'Long',text:'x'.repeat(40000)}]},{config:cfg(),fetcher:async(_,opt)=>{calls++;return Response.json({data:JSON.parse(opt.body).input.map((_,i)=>({index:i,embedding:calls===1?[1,0]:[1,0,0]}))});}}),/Размерность/);
});
test('stale requirements/model disable search; query goes through same model and pgvector',async(t)=>{
 for(const [key,value]of Object.entries(env)){const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}
 const config=cfg(),meta={model_key:config.modelKey,requirements_hash:requirementsHash(project),dimensions:2,chunk_count:2};let querySQL;
 const db={dialect:'postgres',raw:{prepare(sql){return {get(){return sql.includes('FROM projects')?{data:JSON.stringify(project)}:meta;},all(...args){querySQL={sql,args};return [{requirement_id:'r1',similarity:.91}];}};}}};
 assert.equal(semanticStatus(db,project).ready,true);
 assert.equal(semanticStatus(db,{...project,requirements:[...project.requirements,{id:'new',text:'new'}]}).ready,false);
 meta.model_key='old-hash-index';assert.equal(semanticStatus(db,project).ready,false);meta.model_key=config.modelKey;
 t.mock.method(globalThis,'fetch',async(_,options)=>{assert.equal(JSON.parse(options.body).model,config.documentModel);return Response.json({data:[{index:0,embedding:[1,0]}]});});
 const found=await relatedRequirements(db,project,'Авторизация пользователя');assert.equal(found[0].key,'REQ-001');assert.ok(querySQL.sql.includes('<=>'));assert.equal(querySQL.args[1],'p');
});
