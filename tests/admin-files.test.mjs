import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {openDatabase} from '../backend/src/database.mjs';
import {createAccount} from '../backend/src/auth.mjs';
test('offline administration imports a copy, backs it up and restores it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'atlas-admin-')),path=join(dir,'db.sqlite'),snapshot=join(dir,'copy.sqlite');
 const run=(script,...args)=>{const r=spawnSync(process.execPath,['backend/src/'+script,...args],{encoding:'utf8',env:{...process.env,DB_PATH:path,PUBLIC_ORIGIN:'http://localhost:8080'}});assert.equal(r.status,0,r.stderr);return r};
 try{
  let db=openDatabase(path);await createAccount(db,'owner@example.test','Владелец','a-long-safe-password');db.close();
  const input=join(dir,'project.json');await writeFile(input,JSON.stringify({id:'old',revision:3,name:'Перенос',description:'',requirements:[],cases:[],sources:[],audit:[],role:'owner'}));
  run('import-project.mjs','owner@example.test',input);
  db=openDatabase(path);const project=JSON.parse(db.raw.prepare('SELECT data FROM projects').get().data);assert.notEqual(project.id,'old');assert.equal(project.revision,1);db.close();
  run('backup.mjs',snapshot);
  db=openDatabase(path);db.raw.prepare("UPDATE accounts SET name='Изменено'").run();db.close();
  run('restore.mjs',snapshot);
  db=openDatabase(path);assert.equal(db.raw.prepare('SELECT name FROM accounts').get().name,'Владелец');assert.equal(db.raw.prepare('SELECT count(*) n FROM projects').get().n,1);db.close();
 }finally{await rm(dir,{recursive:true,force:true})}
});
