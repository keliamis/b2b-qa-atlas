import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import fs from 'node:fs/promises';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://qa.test' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'localStorage', 'FormData', 'Event', 'MouseEvent']) {
  globalThis[name] = dom.window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const target = new URL('../.delete-ui-test.mjs', import.meta.url);
await build({ entryPoints: ['frontend/src/App.tsx'], outfile: target.pathname, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external' });
const { default: App } = await import(pathToFileURL(target.pathname).href);
const draft = {
  id: 'p-delete', name: 'Удаляемый проект', revision: 0, description: '', audit: [], sources: [], requirements: [],
  cases: Array.from({ length: 3 }, (_, i) => ({
    id: `case-${i}`, key: `TC-00${i+1}`, title: `Тест ${i+1}`, requirementIds: [], type: 'positive',
    priority: 'medium', status: 'draft', gherkin: 'Feature: X\n Scenario: T\n Given a\n When b\n Then c',
    code: '', framework: 'pytest', assumptions: [], origin: 'manual', updatedAt: ''
  }))
};
function findButton(text) {
  return Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === text);
}
async function click(el) {
  assert.ok(el, 'Missing button');
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
function writeInput(el, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

test('bulk delete, project deletion and empty workspace are available in local mode', async () => {
  localStorage.setItem('qa-atlas-projects-v1', JSON.stringify([draft]));
  const root = createRoot(document.getElementById('root'));
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  try {
    await act(async () => root.render(React.createElement(App)));
    await click(Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent.includes('Тест-кейсы')));
    await click(findButton('Удалить все тесты'));
    let saved = JSON.parse(localStorage.getItem('qa-atlas-projects-v1'));
    assert.equal(saved[0].cases.length, 0);
    assert.equal(saved[0].name, draft.name);
    await click(findButton('Настройки'));
    await click(findButton('Удалить проект'));
    assert.equal(findButton('Удалить безвозвратно').disabled, true);
    await act(async () => writeInput(document.querySelector('[name="confirmProjectName"]'), draft.name));
    assert.equal(findButton('Удалить безвозвратно').disabled, false);
    await click(findButton('Удалить безвозвратно'));
    assert.deepEqual(JSON.parse(localStorage.getItem('qa-atlas-projects-v1')), []);
    assert.match(document.body.textContent, /Пока нет проектов/);
    assert.equal(document.querySelector('.project-switch'), null);
    const form = document.querySelector('.empty-workspace form');
    form.querySelector('input[name="name"]').value = 'Новый проект';
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(JSON.parse(localStorage.getItem('qa-atlas-projects-v1')).length, 1);
    assert.match(document.body.textContent, /Новый проект/);
  } finally {
    window.confirm = originalConfirm;
    await act(async () => root.unmount());
    await fs.unlink(target);
  }
});
