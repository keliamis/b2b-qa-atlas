ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;
CREATE TABLE account_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('reset','verify')),
 expires_at INTEGER NOT NULL
);
CREATE INDEX account_tokens_user ON account_tokens(user_id, purpose);
