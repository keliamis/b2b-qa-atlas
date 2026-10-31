/** Deterministic generation quotas: cover distinct requirements before repeats. */
export function quotaForRequirements(requirements, count) {
  if (!Array.isArray(requirements) || !requirements.length ||
      !Number.isInteger(count) || count < 1 || count > 15 ||
      requirements.some(r => !r?.id) ||
      new Set(requirements.map(r => r.id)).size !== requirements.length)
    throw new Error('Invalid requirement selection or requested count');
  const quota = new Map(requirements.map(r => [r.id, 0]));
  for (let i = 0; i < count; i++) {
    const id = requirements[i % requirements.length].id;
    quota.set(id, quota.get(id) + 1);
  }
  return quota;
}

/** Validate links independently from ML. Partial results are allowed but flagged. */
export function inspectGeneratedCases(cases, requirements, count) {
  if (!Array.isArray(cases) || cases.length > count)
    throw new Error('Incorrect number of generated cases');
  const quota = quotaForRequirements(requirements, count);
  const covered = new Map();
  for (const c of cases) {
    if (!Array.isArray(c?.requirementIds) || c.requirementIds.length !== 1 ||
        !quota.has(c.requirementIds[0]))
      throw new Error('Invalid case requirement link');
    const id = c.requirementIds[0];
    covered.set(id, (covered.get(id) || 0) + 1);
    if (covered.get(id) > quota.get(id))
      throw new Error('Test cases are concentrated on one requirement');
  }
  return {
    coveredRequirementIds: [...covered.keys()],
    incompleteRequirementIds: [...quota.keys()].filter(id => (covered.get(id) || 0) < quota.get(id)),
  };
}
