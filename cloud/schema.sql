-- Edge Radar Crypto Cloud - Cloudflare D1.
-- Prices and checkpoint returns are observational only; not trade execution quotes.
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  symbol TEXT NOT NULL DEFAULT '',
  triggered_at INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  last_price REAL,
  last_quote_at INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  liquidity REAL,
  volume REAL,
  change5 REAL,
  buys INTEGER,
  sells INTEGER,
  source TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  m1_status TEXT,m1_at INTEGER,m1_price REAL,m1_return REAL,
  m5_status TEXT,m5_at INTEGER,m5_price REAL,m5_return REAL,
  m15_status TEXT,m15_at INTEGER,m15_price REAL,m15_return REAL,
  m30_status TEXT,m30_at INTEGER,m30_price REAL,m30_return REAL
);
CREATE INDEX IF NOT EXISTS idx_signals_time ON signals(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_pending ON signals(completed,triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_mint_time ON signals(mint,triggered_at DESC);
CREATE TABLE IF NOT EXISTS collector_state (
  name TEXT PRIMARY KEY,
  last_run INTEGER,
  last_ok INTEGER NOT NULL DEFAULT 0,
  scanned INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  checkpoints INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);

-- Pre-aggregated daily counters keep public dashboard queries within D1 Free limits.
CREATE TABLE IF NOT EXISTS daily_metrics (
  day TEXT PRIMARY KEY,
  signals INTEGER NOT NULL DEFAULT 0,
  measured5 INTEGER NOT NULL DEFAULT 0,
  positive5 INTEGER NOT NULL DEFAULT 0,
  sum5 REAL NOT NULL DEFAULT 0
);
