import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../backend/src/database.mjs';
import { createAccount, login, digest } from '../backend/src/auth.mjs';
import { createRecovery } from '../backend/src/recovery.mjs';

test('concurrent registration returns conflict, not SQLite failure', async()=>{
 const db=openDatabase(':memory:');
 try {
  const results=await Promise.allSettled([1,2].map(()=>createAccount(db,'same@example.test','User','long-password-123')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  await assert.rejects(login(db,null,'ip'),{status:400});
 } finally {db.close();}
});
test('recovery uses expiring single-use hashed tokens, revokes sessions and resists replay',async()=>{
 const db=openDatabase(':memory:'); const sent=[];
 try {
  const user=await createAccount(db,'user@example.test','User','old-password-123');
  await login(db,{email:user.email,password:'old-password-123'},'ip');
  const recovery=createRecovery(db,'https://qa.example', async mail=>sent.push(mail));
  const a=await recovery.request({email:user.email},'ip');
  const b=await recovery.request({email:'absent@example.test'},'ip');
  assert.deepEqual(a,b);assert.equal(sent.length,1);
  const token=sent[0].text.match(/#reset=([a-f0-9]{64})/)[1];
  assert.equal(db.raw.prepare('SELECT token_hash FROM account_tokens').get().token_hash,digest(token));
  const input={token,password:'new-password-123',confirmPassword:'new-password-123'};
  const results=await Promise.allSettled([recovery.reset(input),recovery.reset(input)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM sessions').get().n,0);
  await assert.rejects(login(db,{email:user.email,password:'old-password-123'},'ip'),{status:401});
  await login(db,{email:user.email,password:'new-password-123'},'ip');
  await recovery.request({email:user.email},'ip','verify');
  const verify=sent.at(-1).text.match(/#verify=([a-f0-9]{64})/)[1];
  assert.throws(()=>recovery.verify({token}),{status:400});
  recovery.verify({token:verify});
  assert.ok(db.raw.prepare('SELECT email_verified_at FROM accounts WHERE id=?').get(user.id).email_verified_at);
  assert.throws(()=>recovery.verify({token:verify}),{status:400});
  await recovery.request({email:user.email},'ip');
  const expired=sent.at(-1).text.match(/#reset=([a-f0-9]{64})/)[1];
  db.raw.prepare('UPDATE account_tokens SET expires_at=0').run();
  await assert.rejects(recovery.reset({...input,token:expired}),{status:400});
 } finally {db.close();}
});
test('mailer failure exposes no secret and removes undelivered token',async()=>{
 const db=openDatabase(':memory:');
 try {
  await createAccount(db,'user@example.test','User','old-password-123');
  const recovery=createRecovery(db,'https://qa.example',async()=>{throw new Error('smtp-secret');});
  const result=await recovery.request({email:'user@example.test'},'ip');
  assert.equal(result.ok,true);assert.equal(db.raw.prepare('SELECT count(*) n FROM account_tokens').get().n,0);
 } finally{db.close();}
});
