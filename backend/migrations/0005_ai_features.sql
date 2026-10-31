CREATE TABLE ai_feature_records (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 record_key TEXT NOT NULL,
 data TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(project_id,kind,record_key)
);
CREATE INDEX ai_feature_project ON ai_feature_records(project_id,kind);
