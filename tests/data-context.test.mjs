import test from 'node:test';
import assert from 'node:assert/strict';
import {dataRequirementContext} from '../backend/src/insights.mjs';
test('large document sends full selected requirement including REQ-051, not first 100 entries',()=>{
 const requirements=Array.from({length:151},(_,i)=>({id:'r'+(i+1),key:'REQ-'+String(i+1).padStart(3,'0'),title:'Rule '+(i+1),text:'Full condition. '.repeat(200)}));
 assert.ok(JSON.stringify(requirements).length>60000);
 for(const n of [1,51,151]){
  const {requirement,context}=dataRequirementContext({requirements},'r'+n);
  assert.equal(requirement.id,'r'+n);assert.deepEqual(context,[{title:requirements[n-1].title,text:requirements[n-1].text}]);
 }
});
test('unknown/ambiguous selection is rejected rather than silently truncated',()=>{
 const project={requirements:[{id:'a',title:'A',text:'a'},{id:'b',title:'B',text:'b'}]};
 assert.throws(()=>dataRequirementContext(project),e=>e.status===400);
 assert.throws(()=>dataRequirementContext(project,'missing'),e=>e.status===400);
 assert.throws(()=>dataRequirementContext({requirements:[{id:'a',title:'A',text:'x'.repeat(60001)}]},'a'),e=>e.status===413);
 assert.equal(dataRequirementContext({requirements:[project.requirements[0]]}).requirement.id,'a');
});
