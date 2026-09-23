CREATE TABLE IF NOT EXISTS calendar_connect_attempts (
  attempt_id TEXT PRIMARY KEY,
  request_id_hash TEXT NOT NULL UNIQUE,
  profile_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  user_id TEXT NOT NULL UNIQUE,
  connected_account_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('creating', 'link_opened', 'callback_ready', 'verifying', 'completion_unknown', 'verified', 'cancelled', 'expired', 'failed')),
  callback_count INTEGER NOT NULL DEFAULT 0 CHECK (callback_count BETWEEN 0 AND 3),
  expires_at INTEGER NOT NULL,
  session_cipher TEXT,
  ticket_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS calendar_connect_profile_lookup
  ON calendar_connect_attempts(profile_id, plugin_id, provider, created_at DESC);

CREATE TABLE IF NOT EXISTS calendar_connect_lock (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  attempt_id TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_connect_cancellations (
  request_id_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  expires_at INTEGER NOT NULL
);
