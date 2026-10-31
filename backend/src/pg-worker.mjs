import {parentPort} from 'node:worker_threads';
import pg from 'pg';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
let connected;
parentPort.on('message',async ({sql,args,shared})=>{
 const state=new Int32Array(shared,0,2),bytes=new Uint8Array(shared,8);
 let output;
 try{connected??=client.connect();await connected;const r=await client.query(sql,args);output={rows:r.rows||[],changes:r.rowCount||0};}
 catch(e){output={error:e.message,code:e.code};}
 const data=new TextEncoder().encode(JSON.stringify(output));
 const final=data.length>bytes.length?new TextEncoder().encode(JSON.stringify({error:'Database response exceeds 32 MB'})):data;
 bytes.set(final);Atomics.store(state,1,final.length);Atomics.store(state,0,1);Atomics.notify(state,0);
});
