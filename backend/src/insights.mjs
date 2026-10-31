import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import Decimal from 'decimal.js';
import {semanticStatus,relatedRequirements} from './vectors.mjs';
import { error } from './auth.mjs';
import { requireProject } from './jobs.mjs';

export function redact(value, limit=60000) {
  let text=String(value ?? '');
  for(const name of ['OPENAI_API_KEY','EMBEDDING_API_KEY','ML_TOKEN','SMTP_PASSWORD'])if(process.env[name]?.length>=6)text=text.split(process.env[name]).join('[REDACTED]');
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[REDACTED KEY]')
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g,'[REDACTED]')
    .replace(/(bearer\s+)[A-Za-z0-9_.=-]+/gi,'$1[REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*["']?\s*[:=]\s*)[^\n,;]+/gi,'$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@').slice(0,limit);
}
const numbers = s => [...String(s).matchAll(/(?<![\p{L}\d])[-+]?\d+(?:[.,]\d+)?(?![\p{L}\d])/gu)].map(m=>Number(m[0].replace(',','.')));
export function boundaries(requirement) {
  // Candidate numeric constraints, not proof of completeness. Ignore percentages and IDs.
  const values=[];let tableInput=-1;
  for(let line of requirement.text.split('\n')){
    if(/^\s*```/.test(line))continue;
    if(line.includes('|')){const cells=line.split('|').map(s=>s.trim()).filter(Boolean);const header=cells.findIndex(c=>/^(вход|сумма|amount|input)/i.test(c));if(header>=0){tableInput=header;continue;}if(tableInput>=0){const value=cells[tableInput];if(value&&/^[-+]?\d+(?:[.,]\d+)?$/.test(value))values.push(Number(value.replace(',','.')));continue;}}
    line=line.replace(/^\s*(?:[-*]|\d+[.)])\s+/,'').replace(/\d+(?:[.,]\d+)?\s*%/g,'');
    if(/ожидаем|итог|результат|output|expected/i.test(line)&&!/от\s+\d|до\s+\d|при сумм/i.test(line))continue;
    if(/сумм|amount|вход|input|миним|максим|порог|границ|от\s+\d|до\s+\d/i.test(line)){
      const input=line.split(/→|->|=>|скидк|возвращает|результат/i)[0];values.push(...numbers(input));
    }
  }
  return [...new Set(values)].filter(Number.isFinite).slice(0,80);
}
export function coverageAdvice(project, latest) {
  const recommendations=[],requirementStates=[];
  for (const r of project.requirements) {
    const linked=project.cases.filter(c=>c.requirementIds.includes(r.id));
    const tokens=text=>new Set(String(text).toLowerCase().match(/[\p{L}]{4,}/gu)||[]);
    const wanted=tokens(r.title+' '+r.text);
    const possible=project.cases.filter(c=>!c.requirementIds.includes(r.id)).filter(c=>{
      const words=tokens(c.title+' '+c.gherkin+' '+c.code);
      return [...wanted].filter(w=>words.has(w)).length>=3;
    });
    const results=(latest?.testResults||[]).filter(t=>linked.some(c=>c.id===t.caseId));
    requirementStates.push({id:r.id,key:r.key,title:r.title,linkStatus:linked.length?'linked':possible.length?'possible':'unlinked',
      execution:results.some(t=>t.status==='failed')?'failed':results.length&&results.every(t=>t.status==='passed')?'passed':'unknown',
      linked:linked.map(c=>c.id),possible:possible.map(c=>c.id)});

    if (!linked.length) recommendations.push({id:`req:${r.id}`,requirementId:r.id,requirement:r.key,kind:'requirement',title:`${possible.length?'Возможное покрытие — требуется подтверждение':'Связь с тестом не установлена'}: ${r.title}`,reason:'Связь с тестом ещё не создана; это не измерение выполнения.',type:'positive',priority:r.priority,scenario:null});
    for (const n of boundaries(r)) {
      // Only input steps count, not a title or an expected result mentioning the threshold.
      const exists=linked.some(c=>c.gherkin.split('\n').filter(l=>/^\s*(Given|When|And|But|Допустим|Когда|И|Но)(?=\s|$)/i.test(l)).some(l=>numbers(l).includes(n)));
      if (!exists) recommendations.push({id:`boundary:${r.id}:${n}`,requirementId:r.id,requirement:r.key,kind:'boundary',value:n,title:`Не найдена проверка значения ровно ${n.toFixed(2)}`,reason:'Числовое условие в требовании; проверьте, что это граница, и уточните ожидаемый результат.',type:'boundary',priority:'high',scenario:null});
    }
  }
  const stale=!!latest && (JSON.stringify(latest.snapshot?.sources)!==JSON.stringify(project.sources.filter(s=>s.name.endsWith(latest.snapshot?.framework==='pytest'?'.py':'.js'))) || (latest.snapshot?.tests||[]).some(t=>{const c=project.cases.find(c=>c.id===t.id);return !c||(c.artifacts?.[latest.snapshot.framework]||(c.framework===latest.snapshot.framework?c.code:''))!==t.code;}));
  if (!stale) for(const f of latest?.files||[]) if(f.missing.length) recommendations.push({id:`code:${f.name}`,kind:'code',requirementId:null,requirement:'Связь не установлена',title:`Не выполнены строки ${f.name}: ${f.missing.slice(0,12).join(', ')}`,reason:'Покрытие строк из последнего прогона; не доказывает покрытие требований или ветвей.',type:'positive',priority:'medium',scenario:null});
  const groups=new Map();
  for(const item of recommendations){const key=item.kind==='boundary'?`boundary:${item.requirementId}`:item.id;if(groups.has(key)){const group=groups.get(key);group.values.push(item.value);group.reason='Не подтверждены проверки входов: '+[...new Set(group.values)].join(', ');}else groups.set(key,item.kind==='boundary'?{...item,id:key,title:'Граничные проверки: требуется ревью',values:[item.value]}:item);}
  return {recommendations:[...groups.values()],requirementStates:requirementStates.map(r=>({...r,execution:stale?'unknown':r.execution})),metrics:{requirementsLinked:project.requirements.filter(r=>project.cases.some(c=>c.requirementIds.includes(r.id))).length,requirementsTotal:project.requirements.length,codeCoverage:latest?.coverage??null,codeStale:stale,boundaryCoverage:null},note:'Эвристический анализ. Связь с тестом и упоминание входа не доказывают корректность проверки. Полнота граничного покрытия не измерена.'};
}
const normalize=s=>String(s).normalize('NFKC').toLowerCase().replace(/^\s*(?:feature|scenario|функционал|сценарий):.*$/gm,'').replace(/[^\p{L}\p{N}\s<>=!+.,-]/gu,' ').replace(/\s+/g,' ').trim();
const semantic=s=>normalize(s).replace(/\b(?:shopping cart|basket)\b/g,'cart').replace(/корзин[а-я]*/g,'cart').replace(/покупател[а-я]*|пользовател[а-я]*|\b(?:customer|user)\b/g,'user').replace(/\b(?:purchase|buy)\b|купить|покупка/g,'purchase').replace(/\b(?:total|amount|sum)\b|сумм[а-я]*/g,'amount');
export function duplicates(cases) {
  const result=[];
  const prepared=cases.map(c=>({c,text:normalize(c.gherkin),nums:numbers(c.gherkin.replace(/^\s*(?:feature|scenario|функционал|сценарий):.*$/gim,'')).join('|'),tokens:new Set(semantic(c.gherkin).split(' ').filter(Boolean))}));
  for(let i=0;i<prepared.length;i++) for(let j=i+1;j<prepared.length;j++) {
    const a=prepared[i],b=prepared[j];
    if(!a.text||!b.text||a.nums!==b.nums)continue;
    const exceptions=s=>[...s.matchAll(/\b[A-Za-z]+(?:Error|Exception)\b/g)].map(m=>m[0]).sort().join('|');
    if(exceptions(a.c.gherkin)!==exceptions(b.c.gherkin))continue; // Different boundary inputs must never be merged.
    const overlap=[...a.tokens].filter(t=>b.tokens.has(t));
    const exact=a.text===b.text;
    const score=exact?1:Math.min(.99,2*overlap.length/(a.tokens.size+b.tokens.size));
    if(score<0.82)continue;
    result.push({a:a.c.id,b:b.c.id,similarity:Math.round(score*100),category:exact?'Одинаковые шаги':'Похожие сценарии — требуется ревью',matching:overlap.slice(0,30),differences:[a.c.title!==b.c.title?'Разные названия':null,a.c.code!==b.c.code?'Разный код':null,a.text!==b.text?'Есть отличия шагов':null].filter(Boolean),action:'Сравните предусловия и ожидаемый результат. Автоматического удаления нет.'});
    if(result.length>=200)return result;
  }
  return result;
}
const fieldSchema=z.object({name:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/),type:z.enum(['number','integer','string','boolean']),required:z.boolean(),minimum:z.number().finite().nullable(),maximum:z.number().finite().nullable(),thresholds:z.array(z.number().finite()).max(30),precision:z.number().int().min(0).max(6).nullable(),format:z.enum(['email','date','text']),min_length:z.number().int().min(0).max(200).nullable(),max_length:z.number().int().min(0).max(200).nullable()});
export const constraintsSchema=z.object({fields:z.array(fieldSchema).min(1).max(20),assumptions:z.array(z.string().max(2000)).max(30)});
export function generateData(spec,mode,count) {
  if(!Number.isInteger(count)||count<1||count>100)throw error(400,'Количество: целое число от 1 до 100');
  const assumptions=[...spec.assumptions];
  const base={};const variations=[];
  for(const f of spec.fields) {
    if(f.minimum!==null&&f.maximum!==null&&f.minimum>f.maximum)throw error(502,'ИИ вернул противоречивые границы');
    if(f.min_length!==null&&f.max_length!==null&&f.min_length>f.max_length)throw error(502,'ИИ вернул противоречивые длины');
    if(['number','integer'].includes(f.type)) {
      const precision=f.type==='integer'?0:f.precision??2, step=10**-precision;
      if(f.precision===null&&f.type==='number')assumptions.push(`${f.name}: точность не задана; шаг ${step} — предположение.`);
      base[f.name]=f.minimum??(f.maximum!==null?Math.min(0,f.maximum):0);
      if(f.minimum===null&&f.maximum===null)assumptions.push(`${f.name}: диапазон не задан; базовое значение 0 — предположение.`);
      const edges=[...new Set([f.minimum,f.maximum,...f.thresholds].filter(x=>x!==null))];
      for(const n of edges)for(const delta of [-step,0,step])variations.push({field:f.name,value:new Decimal(n).plus(delta).toNumber(),category:'boundary',reason:`Окрестность ${n}, шаг ${step}`});
      if(f.minimum!==null)variations.push({field:f.name,value:new Decimal(f.minimum).minus(step).toNumber(),category:'negative',reason:'Ниже минимума'});
      if(f.maximum!==null)variations.push({field:f.name,value:new Decimal(f.maximum).plus(step).toNumber(),category:'negative',reason:'Выше максимума'});
      variations.push({field:f.name,value:'invalid-number',category:'negative',reason:'Неверный тип'});
    } else if(f.type==='boolean') {base[f.name]=true;variations.push({field:f.name,value:'invalid-boolean',category:'negative',reason:'Неверный логический тип'});}
    else {
      base[f.name]=f.format==='email'?'qa-user@example.invalid':f.format==='date'?'2000-01-01':'synthetic';
      if(f.format==='text')base[f.name]='x'.repeat(Math.max(f.min_length??1,Math.min(9,f.max_length??9)));
      else if((f.min_length!==null&&base[f.name].length<f.min_length)||(f.max_length!==null&&base[f.name].length>f.max_length))throw error(422,'Не удалось совместить формат и длину поля '+f.name);
      for(const n of [f.min_length,f.max_length].filter(x=>x!==null))for(const d of [-1,0,1])if(n+d>=0)variations.push({field:f.name,value:'x'.repeat(n+d),category:'boundary',reason:`Длина около ${n}`});
      variations.push({field:f.name,value:f.format==='email'?'not-an-email':f.format==='date'?'not-a-date':123,category:'negative',reason:'Неверный формат или тип'});
    }
    if(f.required)for(const value of [null,''])variations.push({field:f.name,value,category:'negative',reason:'Обязательное поле пусто'});
  }
  const positives=[];
  for(const f of spec.fields) {
    if(['number','integer'].includes(f.type)) {
      const precision=f.type==='integer'?0:f.precision??2,scale=10**precision;
      const lo=new Decimal(f.minimum??Math.min(0,f.maximum??0)).times(scale).ceil().toNumber(),hi=new Decimal(f.maximum??Math.max((Math.max(0,...f.thresholds))*2,100)).times(scale).floor().toNumber();
      if(!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi))throw error(422,'Диапазон слишком велик для точного представления JSON: уменьшите диапазон или точность');
      const cuts=[lo,...f.thresholds.map(n=>new Decimal(n).times(scale).round().toNumber()).filter(n=>n>lo&&n<hi),hi+1].sort((a,b)=>a-b);
      for(let round=0;round<count;round++)for(let j=0;j<cuts.length-1;j++) {
        const left=cuts[j],right=cuts[j+1]-1;
        const value=new Decimal(round===0?Math.floor((left+right)/2):left+round-1).div(scale).toNumber();
        if(new Decimal(value).times(scale).lte(right))positives.push({field:f.name,value,category:'positive',reason:`Допустимый класс ${left/scale} — ${right/scale}`});
      }
    }else if(f.type==='boolean')for(const value of [true,false])positives.push({field:f.name,value,category:'positive',reason:'Допустимое логическое значение'});
    else for(let i=0;i<count;i++) {
      let value=f.format==='email'?`qa-${i}@example.invalid`:f.format==='date'?`2000-01-${String(i%28+1).padStart(2,'0')}`:String(i).padStart(f.min_length??1,'x');
      if((f.min_length===null||value.length>=f.min_length)&&(f.max_length===null||value.length<=f.max_length))positives.push({field:f.name,value,category:'positive',reason:'Уникальное значение допустимого формата'});
    }
  }
  const candidates=mode==='positive'?positives:mode==='mixed'?[...positives.slice(0,3),...variations,...positives.slice(3)]:variations.filter(x=>x.category===mode);
  const seen=new Set(),rows=[];
  for(const v of candidates){const data={...base,[v.field]:v.value};const key=JSON.stringify(data);if(seen.has(key))continue;seen.add(key);rows.push({index:rows.length+1,category:v.category,reason:v.reason,data});if(rows.length===count)break;}
  if(rows.length!==count)throw error(422,`Доступно уникальных записей: ${rows.length}. Уменьшите количество; повторы не добавлялись.`);
  assumptions.push('Синтетические данные по извлечённым ограничениям. Бизнес-зависимости требуют ревью. Повторы исключены.');
  return {fields:spec.fields,assumptions:[...new Set(assumptions)],rows};
}

export function dataCSV(dataset) {
  const cell=v=>'\"'+(/^-?\d+(?:\.\d+)?$/.test(String(v))?String(v):String(v??'').replace(/^[=+@\-\t\r]/,"'$&")).replace(/"/g,'""')+'\"';
  return [['index','category','reason',...dataset.fields.map(f=>f.name)],...dataset.rows.map(r=>[r.index,r.category,r.reason,...dataset.fields.map(f=>typeof r.data[f.name]==='number'&&f.type==='number'?new Decimal(r.data[f.name]).toFixed(f.precision??2):typeof r.data[f.name]==='object'?JSON.stringify(r.data[f.name]):r.data[f.name])])].map(r=>r.map(cell).join(',')).join('\r\n');
}
// Test data describes inputs to a specific rule, not unrelated fields from a whole document.
export function dataRequirementContext(project, requirementId) {
  if (!project.requirements.length) throw error(400, 'Загрузите требования');
  const requirement = requirementId
    ? project.requirements.find(r => r.id === requirementId)
    : project.requirements.length === 1 ? project.requirements[0] : null;
  if (!requirement) throw error(400, requirementId ? 'Выбранное требование не найдено. Обновите проект' : 'Выберите требование для генерации тестовых данных');
  const context = [{title:requirement.title,text:requirement.text}];
  if (JSON.stringify(context).length > 60000)
    throw error(413, 'Выбранное требование превышает 60 000 символов контекста. Разделите его на самостоятельные требования; текст не был обрезан');
  return {requirement,context};
}
export const detectiveSchema=z.object({explanation:z.string().max(3000),probable_cause:z.string().max(3000),defect_location:z.string().max(2000),suggested_fix:z.string().max(3000),confidence:z.enum(['low','medium','high']),insufficient_data:z.boolean()});
// Format validated detective findings as readable Markdown rather than raw JSON.
// Treat model output strictly as text: escape Markdown control characters to
// avoid accidental headings, links, and code fences in generated reports.
export function formatDetectiveFindings(analysis) {
  if (!analysis) return 'Анализ ещё не выполнен.';
  const clean = value => String(value ?? '').replace(/([\\`*_{}\[\]<>!|#])/g, '\\$1').replace(/\r?\n/g, ' ');
  const fields = [
    ['Объяснение', analysis.explanation],
    ['Вероятная причина', analysis.probable_cause],
    ['Возможное место дефекта', analysis.defect_location],
    ['Предлагаемое исправление', analysis.suggested_fix],
  ];
  const lines = fields.map(([label, value]) => `**${label}:** ${clean(value)}`);
  lines.push(`**Уверенность:** ${{low:'Низкая',medium:'Средняя',high:'Высокая'}[analysis.confidence] || 'Не указана'}`);
  lines.push(`**Достаточность данных:** ${analysis.insufficient_data ? 'Недостаточно данных для уверенного вывода' : 'Данные позволяют сформулировать гипотезу; требуется проверка'}`);
  return lines.join('\n\n');
}

export function createInsights(db,{mlUrl,mlToken}) {
  const inFlight=new Set();
  const record=(pid,kind,key)=>{const r=db.raw.prepare('SELECT * FROM ai_feature_records WHERE project_id=? AND kind=? AND record_key=?').get(pid,kind,key);return r?{...r,data:JSON.parse(r.data)}:null;};
  const save=(pid,kind,key,data)=>{db.raw.prepare('INSERT INTO ai_feature_records VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,kind,record_key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(randomUUID(),pid,kind,key,JSON.stringify(data),new Date().toISOString());return record(pid,kind,key);};
  async function ai(pid,kind,payload) {
    if(inFlight.has(pid))throw error(429,'Дождитесь текущего запроса ИИ');
    inFlight.add(pid);
    try {
      const r=await fetch(mlUrl+'/insights',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+mlToken},body:JSON.stringify({kind,payload:(()=>{const text=JSON.stringify(payload);if(text.length>60000)throw error(413,'Слишком большой контекст: выберите меньший документ');return redact(text);})()}),signal:AbortSignal.timeout(115000)});
      if(!r.ok){const failure=await r.json().catch(()=>({}));throw error(502,typeof failure.detail==='string'?failure.detail:'ИИ отклонил запрос');}
      const text=await r.text();if(text.length>100000)throw new Error();return JSON.parse(text);
    }catch(e){if(e.status)throw e;throw error(502,'ИИ недоступен или ответ некорректен. Исходный traceback остаётся в журнале прогона.');}finally{inFlight.delete(pid);}
  }
  // A snapshot case can contain multiple pytest functions. A case-level Gherkin
  // cannot be attributed to one failing function without a reliable mapping.
  function trustedFailureScenario(testcase, testName) {
    if(!testcase?.gherkin || !testcase?.code) return '';
    const names=[...String(testcase.code).matchAll(/^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/gm)].map(x=>x[1]);
    if(names.length>1) return '';
    if(names.length===1 && !String(testName).includes(names[0])) return '';
    return testcase.gherkin;
  }
  function failure(pid,input) {
    const v=z.object({runId:z.string().max(100),index:z.number().int().min(0).max(999)}).parse(input);
    const job=db.raw.prepare("SELECT * FROM jobs WHERE id=? AND project_id=? AND kind='autorun'").get(v.runId,pid);
    if(!job?.result)throw error(404,'Результат прогона не найден');
    const result=JSON.parse(job.result), t=result.testResults?.[v.index];
    if(!t||t.status!=='failed')throw error(400,'Выберите упавшую проверку');
    const testcase=result.snapshot?.tests?.find(c=>c.id===t.caseId);
    return {key:`${v.runId}:${v.index}`,runId:v.runId,test:t,testcase,result,date:job.created_at};
  }
  return async(user,pid,action,method,input={})=>{
    const row=requireProject(db,pid,user.id,method!=='GET'&&action!=='semantic-search'), project=JSON.parse(row.data);
    if(action==='reports'&&method==='GET')return db.raw.prepare("SELECT * FROM ai_feature_records WHERE project_id=? AND kind='report' ORDER BY updated_at DESC").all(pid).map(r=>({...r,data:JSON.parse(r.data)}));
    if(action==='report-save'&&method==='POST') {
      const v=z.object({key:z.string().max(200),markdown:z.string().min(1).max(80000),version:z.string()}).parse(input);
      const old=record(pid,'report',v.key);if(!old)throw error(404,'Отчёт не найден');
      if(old.updated_at!==v.version)throw error(409,'Отчёт изменён. Откройте его заново.');
      return save(pid,'report',v.key,{...old.data,markdown:redact(v.markdown,80000)});
    }
    if(['detective','report'].includes(action)&&method==='POST') {
      const f=failure(pid,input);
      const trustedScenario=trustedFailureScenario(f.testcase,f.test.name);
    const context={test_name:f.test.name,traceback:redact(f.test.traceback||'',12000),assertion:redact(f.test.assertion||'',2000),expected:trustedScenario.split('\n').filter(l=>/^\s*(Then|Тогда)\s/i.test(l)).join('\n')||'Не определено для конкретной упавшей функции; см. assertion в traceback',actual:f.test.assertion||'См. traceback; отдельное значение не извлечено',test_code:redact(f.testcase?.code||'',16000),scenario:redact(trustedScenario,4000),sources:redact(JSON.stringify(f.result.snapshot?.sources||[]),16000),legacy_note:!f.testcase?'Нет достоверного сопоставления с тест-кейсом старого прогона':''};
      if(action==='detective') {
        const data=detectiveSchema.parse(await ai(pid,'detective',context));
        if(!context.traceback){data.insufficient_data=true;data.confidence='low';}
        requireProject(db,pid,user.id,true);
        return save(pid,'detective',f.key,Object.fromEntries(Object.entries(data).map(([k,v])=>[k,typeof v==='string'?redact(v):v])));
      }
      const old=record(pid,'report',f.key);if(old)return old;
      const analysis=record(pid,'detective',f.key)?.data;
      const markdown=`# ${f.test.name}\n\n- Проект: ${project.name}\n- Тест: ${f.testcase?.id||'не сопоставлен'}\n- Прогон: ${f.runId}\n- Дата: ${f.date}\n- Severity: Major (предварительно, уточните)\n- Окружение: ${f.result.snapshot?.framework||'неизвестно'}, изолированный worker; версия ОС не сохранена\n\n## Описание\nПроверка завершилась FAILED. Причина ещё не подтверждена.\n\n## Шаги воспроизведения\n1. Использовать снимок исходников и теста из прогона ${f.runId}.\n2. Запустить тест ${f.test.name} указанным фреймворком.\n\n${context.scenario||'Невозможно достоверно сопоставить Gherkin с этой упавшей функцией; используйте pytest traceback и код теста.'}\n\n## Ожидаемый результат\n${context.expected}\n\n## Фактический результат\n${context.actual}\n\n## Traceback\n\n\`\`\`text\n${context.traceback||'Индивидуальный traceback отсутствует. Изучите общий журнал прогона.'}\n\`\`\`\n\n## Тестовый код\n\n\`\`\`text\n${context.test_code||'Нет достоверного сопоставления'}\n\`\`\`\n\n## Гипотезы ИИ (не факты)\n${formatDetectiveFindings(analysis)}\n`;
      return save(pid,'report',f.key,{markdown:redact(markdown,80000),runId:f.runId});
    }
    if(action==='semantic-status'&&method==='GET')return semanticStatus(db,project);
    if(action==='semantic-search'&&method==='POST') {
      const {query}=z.object({query:z.string().trim().min(1).max(600)}).parse(input);
      const results=await relatedRequirements(db,project,query);
      requireProject(db,pid,user.id);
      return {results};
    }
    if(action==='coverage'&&method==='GET') {
      const latest=db.raw.prepare("SELECT result FROM jobs WHERE project_id=? AND kind='autorun' AND result IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(pid);
      return coverageAdvice(project,latest?JSON.parse(latest.result):null);
    }
    if(action==='scenario'&&method==='POST') {
      const v=z.object({requirementId:z.string(),values:z.array(z.number()).max(80).default([])}).parse(input);
      const requirement=project.requirements.find(r=>r.id===v.requirementId);if(!requirement)throw error(404,'Требование не найдено');
      let related=[],semanticWarning='';
      if(semanticStatus(db,project).ready){try{related=await relatedRequirements(db,project,requirement.title);}catch{semanticWarning='Семантический поиск недоступен: сценарий построен по выбранному требованию без дополнительного контекста.';}}
      const result=z.object({cases:z.array(z.object({title:z.string().min(1).max(300),gherkin:z.string().min(1).max(5000),assumptions:z.array(z.string().max(1000)).max(10)})).max(15),questions:z.array(z.string().max(1000)).max(20)}).parse(await ai(pid,'scenario',{requirement,values:v.values,sources:project.sources,related}));
      if(semanticWarning)result.questions.push(semanticWarning);
      for(const c of result.cases){const lines=c.gherkin.split('\n');if(!['Given','When','Then'].every(k=>lines.some(l=>new RegExp('^\\s*'+k+'\\s+\\S').test(l)))||lines.some(l=>l.length>500||/^\s*#{1,6}\s/.test(l))||/выполняется описанная операция|результат соответствует требованию|выполнены предусловия требования/i.test(c.gherkin))throw error(502,'ИИ вернул неконкретный сценарий. Уточните требование и повторите.');}
      requireProject(db,pid,user.id,true);if(requireProject(db,pid,user.id).revision!==row.revision)throw error(409,'Проект изменился во время анализа. Повторите.');
      if(!result.cases.length)throw error(422,result.questions.join(' ')||'Нужны точные входы и ожидаемые результаты');return result;
    }
    if(action==='data'&&method==='POST') {
      const v=z.object({mode:z.enum(['positive','negative','boundary','mixed']),count:z.number().int().min(1).max(100),requirementId:z.string().min(1).max(100).optional()}).parse(input);
      const {requirement,context}=dataRequirementContext(project,v.requirementId);
      const spec=constraintsSchema.parse(await ai(pid,'constraints',context));
      // Keep only thresholds explicitly present in the requirements; the LLM cannot invent them.
      const explicit=boundaries(requirement);
      for(const f of spec.fields)f.thresholds=f.thresholds.filter(n=>explicit.includes(n));
      requireProject(db,pid,user.id,true);if(requireProject(db,pid,user.id).revision!==row.revision)throw error(409,'Требования изменились. Повторите генерацию.');
      const data=generateData(spec,v.mode,v.count);return {...data,requirement:{id:requirement.id,key:requirement.key,title:requirement.title},csv:dataCSV(data)};
    }
    if(action==='duplicates'&&method==='GET')return duplicates(project.cases).map(pair=>({...pair,decision:(()=>{if(project.cases.find(c=>c.id===pair.b)?.duplicateOf===pair.a)return {decision:'duplicate'};const d=record(pid,'duplicate',[pair.a,pair.b].sort().join(':'))?.data;return d?.signature===createHash('sha256').update(JSON.stringify(project.cases.filter(c=>[pair.a,pair.b].includes(c.id)).sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex')?d:null;})()}));
    if(action==='duplicate-decision'&&method==='POST') {
      const v=z.object({a:z.string(),b:z.string(),decision:z.enum(['keep','duplicate'])}).parse(input);
      if(v.a===v.b||![v.a,v.b].every(id=>project.cases.some(c=>c.id===id)))throw error(400,'Тесты не найдены');
      const primary=project.cases.find(c=>c.id===v.a),target=project.cases.find(c=>c.id===v.b);
      if(v.decision==='duplicate'){
        if(primary.duplicateOf||project.cases.some(c=>c.duplicateOf===target.id))throw error(400,'Недопустимая цепочка дубликатов');
        target.duplicateOf=primary.id;
      }else delete target.duplicateOf;
      project.revision++;project.audit=[...(project.audit||[]).slice(-999),{id:randomUUID(),at:new Date().toISOString(),actor:user.name,action:v.decision==='duplicate'?'Отмечен дубликат':'Отменена отметка дубликата',target:target.key}];
      const updated=db.raw.prepare('UPDATE projects SET data=?,revision=?,updated_at=? WHERE id=? AND revision=?').run(JSON.stringify(project),project.revision,new Date().toISOString(),pid,row.revision);
      if(!updated.changes)throw error(409,'Проект изменился; обновите данные');
      return save(pid,'duplicate',[v.a,v.b].sort().join(':'),{decision:v.decision,actor:user.name,signature:createHash('sha256').update(JSON.stringify(project.cases.filter(c=>[v.a,v.b].includes(c.id)).sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex')});
    }
    throw error(405,'Метод не поддерживается');
  };
}
