# Targeted generation corrections (0.8.3 hotfix)

- AI generation system instructions now explicitly honor `include_code=false`: return Gherkin only and do not produce or diagnose pytest/Playwright artifacts.
- When code is requested, request and validate only the selected framework. Invalid unused Playwright artifacts cannot reject a pytest scenario (and vice versa).
- Suppress irrelevant model warnings for unrequested frameworks, while retaining useful requirement and input-data warnings.
- Retain strict per-requirement quotas, targeted recovery of missing requirements and truthful partial-result reporting. No synthetic test cases are invented.
- Completed background-job summaries include selected framework, code flag, selected requirement keys and requested count; the UI shows generation mode and date for completed jobs.
- Duplicate detection code was not modified.

Verification: 33 ML-service Python tests pass, including two new regression tests. Node backend syntax passes. Full Node tests / Docker builds not confirmed in this environment (Node 22; project requires Node >=24.12; dependencies absent; Docker unavailable). Live LLM behavior remains to be verified with provider credentials.
