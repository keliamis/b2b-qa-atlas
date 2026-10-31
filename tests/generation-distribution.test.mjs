import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaForRequirements, inspectGeneratedCases } from '../backend/src/generation-distribution.mjs';

const requirements = Array.from({length:6}, (_, i) => ({id:`REQ-${String(i+1).padStart(3,'0')}`}));
const scenario = id => ({requirementIds:[id]});

test('6 selected / 6 requested => exactly one slot per requirement', () => {
  const quota = quotaForRequirements(requirements, 6);
  assert.deepEqual([...quota.values()], [1,1,1,1,1,1]);
  const result = inspectGeneratedCases(requirements.map(r=>scenario(r.id)), requirements, 6);
  assert.deepEqual(result.incompleteRequirementIds, []);
});

test('6 tests linked only to first requirement are rejected without saving', () => {
  assert.throws(() => inspectGeneratedCases(Array.from({length:6},()=>scenario('REQ-001')),
                                            requirements,6), /concentrated/);
});

test('partial batch reports uncovered requirements', () => {
  const result = inspectGeneratedCases([scenario('REQ-001')],requirements,6);
  assert.deepEqual(result.coveredRequirementIds,['REQ-001']);
  assert.equal(result.incompleteRequirementIds.length, 5);
});

test('extra tests are distributed evenly and multi-linking is rejected', () => {
  assert.deepEqual([...quotaForRequirements(requirements, 9).values()], [2,2,2,1,1,1]);
  assert.throws(() => inspectGeneratedCases([{requirementIds:['REQ-001','REQ-002']}], requirements,6), /link/);
});
