import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';
import React, { act } from 'react';
const dom=new JSDOM('<div id="root"></div>',{url:'https://qa.test/login'});
for(const key of ['window','document','HTMLElement','FormData','Event','MouseEvent','location','history'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let finish;
let requests=0;
globalThis.fetch=async url=>url==='/auth/config'?{json:async()=>({email_enabled:false})}:new Promise(resolve=>{requests++;finish=()=>resolve({ok:false,json:async()=>({detail:'Почта занята'})});});
const file=new URL('../.login-ui-test.mjs',import.meta.url);
await build({entryPoints:['frontend/src/Login.tsx'],outfile:file.pathname,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external'});
const {default:Login}=await import(file.href);
const {createRoot}=await import('react-dom/client');
const find=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
const click=async b=>act(async()=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));
test('registration validates passwords and locks mode during submit',async()=>{
 const root=createRoot(document.getElementById('root'));
 try {
  await act(async()=>root.render(React.createElement(Login)));
  await click(find('Зарегистрироваться'));
  for(const [name,value] of Object.entries({name:'Анна',email:'anna@example.test',password:'test-password-123',confirmPassword:'mismatch'}))document.querySelector(`[name="${name}"]`).value=value;
  const submit=()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await act(async()=>submit());assert.match(document.body.textContent,/Пароли не совпадают/);assert.equal(requests,0);
  await click(find('Показать пароль'));assert.equal(document.querySelector('[name="password"]').type,'text');
  document.querySelector('[name="confirmPassword"]').value='test-password-123';
  await act(async()=>{submit();submit();});
  assert.equal(requests,1);assert.equal(find('Уже есть аккаунт').disabled,true);
  assert.equal(document.querySelector('fieldset').disabled,true);
  await act(async()=>finish());assert.match(document.body.textContent,/Почта занята/);assert.equal(find('Уже есть аккаунт').disabled,false);
 } finally {await act(async()=>root.unmount());await unlink(file);}
});
