import { createHash } from 'node:crypto';
import { z } from 'zod';
import { error } from './auth.mjs';
export const fingerprint = (sources, tests) => createHash('sha256').update(JSON.stringify({sources,tests})).digest('hex');
export function snapshot(project, input) {
  const request = z.object({framework:z.enum(['pytest','playwright']),case_ids:z.array(z.string()).min(1).max(50)}).parse(input);
  const cases = project.cases.filter(c=>request.case_ids.includes(c.id));
  if (cases.length !== new Set(request.case_ids).size) throw error(400,'Тест не найден');
  const tests = cases.map(c=>({id:c.id, title:c.title, gherkin:c.gherkin, code:c.artifacts?.[request.framework] || (c.framework===request.framework ? c.code : '')}));
  if (tests.some(t=>!t.code.trim())) throw error(400,'У выбранного теста нет кода для этого фреймворка');
  const suffix = request.framework==='pytest'?'.py':'.js';
  const sources = project.sources.filter(s=>s.name.endsWith(suffix));
  if (!sources.length) throw error(400,'Добавьте исходники '+suffix);
  if (new Set(sources.map(s=>s.name)).size!==sources.length) throw error(400,'Имена исходников должны быть уникальны');
  if (sources.some(s=> !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,150}$/.test(s.name))) throw error(400,'Используйте простые имена исходников латиницей, без пути');
  const value = {framework:request.framework,sources,tests};
  if (JSON.stringify(value).length>1_000_000) throw error(413,'Снимок превышает 1 МБ');
  return {...value, fingerprint:fingerprint(sources,tests), projectRevision:project.revision};
}
const lines = z.array(z.number().int().positive().max(120000)).max(120000);
export const resultSchema = z.object({
  status:z.enum(['passed','failed','error','timed_out']),
  logs:z.string().max(50000), total:z.number().int().nonnegative(), passed:z.number().int().nonnegative(),
  failed:z.number().int().nonnegative(), skipped:z.number().int().nonnegative(),
  coverage:z.number().min(0).max(100).nullable(),
  files:z.array(z.object({name:z.string().max(200),covered:lines,missing:lines})).max(100),
  testResults:z.array(z.object({name:z.string().max(1000),status:z.enum(['passed','failed','skipped']),duration:z.number().finite().nonnegative(),caseId:z.string().max(100).optional(),traceback:z.string().max(12000).optional(),assertion:z.string().max(2000).optional()})).max(1000).optional(),
  exitCode:z.number().optional(),
});
