import {Worker} from 'node:worker_threads';
export function postgresRaw(){
 const worker=new Worker(new URL('./pg-worker.mjs',import.meta.url));worker.unref();
 function query(sql,args=[]){
  if(/^PRAGMA/i.test(sql.trim()))return {rows:[],changes:0};
  let index=0;sql=sql.replace(/`([^`]+)`/g,'"$1"').replace(/BEGIN IMMEDIATE/g,'BEGIN').replace(/\?/g,()=>'$'+(++index));
  const shared=new SharedArrayBuffer(32*1024*1024+8),state=new Int32Array(shared,0,2);
  worker.postMessage({sql,args,shared});
  if(Atomics.wait(state,0,0,30000)==='timed-out')throw new Error('PostgreSQL request timed out');
  const result=JSON.parse(new TextDecoder().decode(new Uint8Array(shared,8,Atomics.load(state,1))));
  if(result.error)throw Object.assign(new Error(result.error),{code:result.code});return result;
 }
 return {
  exec:sql=>query(sql),
  prepare:sql=>({get:(...args)=>query(sql,args).rows[0],all:(...args)=>query(sql,args).rows,run:(...args)=>query(sql,args)}),
  close:()=>{void worker.terminate();}
 };
}
