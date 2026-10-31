-- Separate tables keep legacy hash vectors and user data intact.
CREATE TABLE IF NOT EXISTS semantic_indexes (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL,
  requirements_hash TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS semantic_chunks (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  chunk_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector NOT NULL,
  PRIMARY KEY(project_id, requirement_id, chunk_no)
);
