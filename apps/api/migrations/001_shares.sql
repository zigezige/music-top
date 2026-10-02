CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  revoke_token_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT shares_snapshot_size CHECK (pg_column_size(snapshot) <= 262144),
  CONSTRAINT shares_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS shares_expires_at_idx ON shares (expires_at);

CREATE TABLE IF NOT EXISTS catalog_issues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_id text NOT NULL,
  track_id text,
  kind text NOT NULL CHECK (kind IN ('missing', 'duplicate', 'misattributed')),
  details text,
  created_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status = 'pending')
);

CREATE INDEX IF NOT EXISTS catalog_issues_pending_created_at_idx
  ON catalog_issues (created_at) WHERE status = 'pending';
