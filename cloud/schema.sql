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

-- Escudo de risco: ultimo snapshot por moeda. Sem trades ou carteiras.
CREATE TABLE IF NOT EXISTS risk_watch (
 mint TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',symbol TEXT NOT NULL DEFAULT '',
 assessed_at INTEGER NOT NULL,level TEXT NOT NULL DEFAULT 'unverified',
 market_score INTEGER NOT NULL DEFAULT 0,organic_score REAL,is_verified INTEGER NOT NULL DEFAULT 0,
 top_holders REAL,buy_usd REAL,sell_usd REAL,flow_ratio REAL,
 pool_price REAL,pool_liquidity REAL,jupiter_liquidity REAL,
 change_price REAL,change_liquidity REAL,reasons TEXT NOT NULL DEFAULT '[]',
 exit_quote_verified INTEGER NOT NULL DEFAULT 0,entry_allowed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_risk_watch_time ON risk_watch(assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_watch_level ON risk_watch(level,assessed_at DESC);

-- Estimativas de rota (Jupiter): uma amostra por rodada, nao ordens executaveis.
CREATE TABLE IF NOT EXISTS exit_quotes (
 mint TEXT PRIMARY KEY,checked_at INTEGER NOT NULL,stake_usd REAL NOT NULL,
 status TEXT NOT NULL,estimated_sol REAL,estimated_usd REAL,recovery_pct REAL,
 router TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_exit_quotes_time ON exit_quotes(checked_at DESC);

-- Registro imutavel da triagem no instante do sinal (evita viés retrospectivo).
CREATE TABLE IF NOT EXISTS signal_evidence (
 signal_id TEXT PRIMARY KEY,mint TEXT NOT NULL,captured_at INTEGER NOT NULL,
 risk_level TEXT NOT NULL,organic_score REAL,buy_usd REAL,sell_usd REAL,
 liquidity REAL,reasons TEXT NOT NULL DEFAULT '[]',quote_status TEXT NOT NULL DEFAULT 'not_checked'
);
CREATE INDEX IF NOT EXISTS idx_signal_evidence_time ON signal_evidence(captured_at DESC);

-- Backoff entre ciclos, evitando 429 repetidos da mesma API.
CREATE TABLE IF NOT EXISTS source_health (
 source TEXT PRIMARY KEY,
 next_attempt INTEGER NOT NULL DEFAULT 0,
 failures INTEGER NOT NULL DEFAULT 0,
 last_status INTEGER,
 last_success INTEGER,
 last_error TEXT NOT NULL DEFAULT ''
);

-- Isolated paper experiment; no wallets or live orders.
CREATE TABLE IF NOT EXISTS paper_accounts(
 strategy TEXT PRIMARY KEY,initial_usd REAL NOT NULL,cash_usd REAL NOT NULL,updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_positions(
 strategy TEXT NOT NULL,mint TEXT NOT NULL,symbol TEXT NOT NULL DEFAULT '',
 quantity REAL NOT NULL,invested_usd REAL NOT NULL,entry_price REAL NOT NULL,
 opened_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,last_price REAL,last_quote_at INTEGER,PRIMARY KEY(strategy,mint)
);
CREATE TABLE IF NOT EXISTS paper_trades(
 id TEXT PRIMARY KEY,strategy TEXT NOT NULL,mint TEXT NOT NULL,symbol TEXT NOT NULL DEFAULT '',
 action TEXT NOT NULL,quantity REAL NOT NULL,price_usd REAL NOT NULL,fee_usd REAL NOT NULL,
 cash_usd REAL NOT NULL,pnl_usd REAL,reason TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_trades_time ON paper_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy_time ON paper_trades(strategy,created_at DESC);
CREATE TABLE IF NOT EXISTS paper_decisions(
 id TEXT PRIMARY KEY,strategy TEXT NOT NULL,mint TEXT NOT NULL,decision TEXT NOT NULL,
 reason TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_decisions_time ON paper_decisions(created_at DESC);
CREATE TABLE IF NOT EXISTS paper_ai_usage(
 day TEXT PRIMARY KEY,calls INTEGER NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,
 output_tokens INTEGER NOT NULL DEFAULT 0,last_status TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_cycle_runs(minute_at INTEGER PRIMARY KEY);

-- Observational risk evidence is separate from trade execution and is never treated as authorization.
CREATE TABLE IF NOT EXISTS paper_entry_evidence(
 buy_id TEXT PRIMARY KEY,strategy TEXT NOT NULL,mint TEXT NOT NULL,created_at INTEGER NOT NULL,
 tier TEXT NOT NULL,risk_level TEXT NOT NULL,quote_status TEXT NOT NULL,
 score INTEGER NOT NULL DEFAULT 0,liquidity REAL
);
CREATE INDEX IF NOT EXISTS idx_paper_evidence_time ON paper_entry_evidence(created_at DESC);
CREATE TABLE IF NOT EXISTS paper_diagnostics(
 id INTEGER PRIMARY KEY CHECK(id=1),checked_at INTEGER NOT NULL,candidates INTEGER NOT NULL DEFAULT 0,
 eligible INTEGER NOT NULL DEFAULT 0,exploratory INTEGER NOT NULL DEFAULT 0,audited INTEGER NOT NULL DEFAULT 0,
 without_price INTEGER NOT NULL DEFAULT 0,critical INTEGER NOT NULL DEFAULT 0,
 low_liquidity INTEGER NOT NULL DEFAULT 0,weak_activity INTEGER NOT NULL DEFAULT 0,
 too_new INTEGER NOT NULL DEFAULT 0,bad_exit INTEGER NOT NULL DEFAULT 0
);

-- Edge Scalp transient monitoring; separate from existing baseline and AI histories.
-- Explicit snapshot timestamps are collector receipt times, not exchange execution times.
CREATE TABLE IF NOT EXISTS paper_scalp_tracking (
  strategy TEXT NOT NULL DEFAULT 'scalp',
  mint TEXT NOT NULL,
  peak_price REAL NOT NULL,
  last_price REAL NOT NULL,
  weak_ticks INTEGER NOT NULL DEFAULT 0,
  sample_at INTEGER NOT NULL,
  PRIMARY KEY(strategy,mint)
);
CREATE INDEX IF NOT EXISTS idx_scalp_tracking_time ON paper_scalp_tracking(sample_at DESC);

-- Read-only latest scalp filter summary; never alters prior collected signals.
CREATE TABLE IF NOT EXISTS paper_scalp_diagnostics (
 id INTEGER PRIMARY KEY CHECK(id=1),checked_at INTEGER NOT NULL,
 candidates INTEGER NOT NULL DEFAULT 0, eligible INTEGER NOT NULL DEFAULT 0,
 volume_score INTEGER NOT NULL DEFAULT 0, pressure INTEGER NOT NULL DEFAULT 0,
 stretched INTEGER NOT NULL DEFAULT 0, too_new INTEGER NOT NULL DEFAULT 0,
 weakening INTEGER NOT NULL DEFAULT 0
);

-- Common launch instant for apples-to-apples completed-trade comparisons.
-- Existing baseline history is preserved; reported comparison metrics start here.
CREATE TABLE IF NOT EXISTS paper_comparison_start (
 id INTEGER PRIMARY KEY CHECK(id=1),
 started_at INTEGER NOT NULL
);

-- Add-only telemetry. Historical rows have unknown feature values, never backfilled from current quotes.
CREATE TABLE IF NOT EXISTS paper_entry_features (
 buy_id TEXT PRIMARY KEY, strategy TEXT NOT NULL, mint TEXT NOT NULL,
 opened_at INTEGER NOT NULL, score REAL, liquidity REAL, volume5m REAL,
 change5m REAL, buys5m INTEGER, sells5m INTEGER,
 age_minutes REAL, organic REAL, top_holders REAL, quote_status TEXT,
 tier TEXT
);
CREATE INDEX IF NOT EXISTS idx_paper_features_strategy_time ON paper_entry_features(strategy,opened_at);
CREATE TABLE IF NOT EXISTS paper_exit_observations (
 sell_id TEXT PRIMARY KEY, strategy TEXT NOT NULL, mint TEXT NOT NULL,
 entry_at INTEGER NOT NULL, closed_at INTEGER NOT NULL,
 elapsed_ms INTEGER NOT NULL, previous_quote_lag_ms INTEGER,
 price_return_pct REAL, stop_overshoot_pct REAL,
 reason_group TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_quote_samples (
 strategy TEXT NOT NULL, mint TEXT NOT NULL, opened_at INTEGER NOT NULL,
 observed_at INTEGER NOT NULL, price_usd REAL NOT NULL,
 PRIMARY KEY(strategy,mint,opened_at,observed_at)
);
CREATE INDEX IF NOT EXISTS idx_paper_quote_samples_time ON paper_quote_samples(observed_at);
CREATE TABLE IF NOT EXISTS paper_strategy_inception (
 strategy TEXT PRIMARY KEY, started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_v2_diagnostics (
 id INTEGER PRIMARY KEY CHECK(id=1),checked_at INTEGER NOT NULL,
 base_candidates INTEGER NOT NULL DEFAULT 0, eligible INTEGER NOT NULL DEFAULT 0,
 score_liquidez_volume INTEGER NOT NULL DEFAULT 0,
 pressao_compradora INTEGER NOT NULL DEFAULT 0,
 movimento_excessivo_ou_fraco INTEGER NOT NULL DEFAULT 0,
 idade_do_pool_indisponivel_ou_nova INTEGER NOT NULL DEFAULT 0,
 alerta_de_auditoria INTEGER NOT NULL DEFAULT 0,
 perda_de_forca INTEGER NOT NULL DEFAULT 0
);

-- Pool address directory only, never an assumed live price.
CREATE TABLE IF NOT EXISTS gecko_pool_watch (
 mint TEXT PRIMARY KEY,
 pool TEXT NOT NULL,
 seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gecko_pool_watch_seen ON gecko_pool_watch(seen_at DESC);
-- Provider monitoring for the free simulated radar.
CREATE TABLE IF NOT EXISTS price_source_state(
 id INTEGER PRIMARY KEY CHECK(id=1),
 checked_at INTEGER NOT NULL,
 dex_count INTEGER NOT NULL DEFAULT 0,
 gecko_count INTEGER NOT NULL DEFAULT 0,
 missing_count INTEGER NOT NULL DEFAULT 0,
 watched_pools INTEGER NOT NULL DEFAULT 0,
 dex_next_attempt INTEGER NOT NULL DEFAULT 0
);

-- Persistent discovery universe. List visibility is independent of transient entry eligibility.
-- Quotes are observations only; stale prices never become simulated fills.
CREATE TABLE IF NOT EXISTS token_universe (
 mint TEXT PRIMARY KEY,
 name TEXT NOT NULL DEFAULT '',
 symbol TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL DEFAULT '',
 first_seen INTEGER NOT NULL,
 first_pool_at INTEGER,
 last_observed_at INTEGER,
 last_seen INTEGER NOT NULL,
 pool_address TEXT,
 dex TEXT NOT NULL DEFAULT '',
 price_usd REAL,
 liquidity_usd REAL,
 volume5m_usd REAL,
 volume24h_usd REAL,
 change5m_pct REAL,
 change1h_pct REAL,
 change24h_pct REAL,
 market_cap_usd REAL,
 buys5m INTEGER,
 sells5m INTEGER,
 score INTEGER NOT NULL DEFAULT 0,
 best_score INTEGER NOT NULL DEFAULT 0,
 stage TEXT NOT NULL DEFAULT 'waiting',
 risk_level TEXT NOT NULL DEFAULT 'unverified',
 price_source TEXT NOT NULL DEFAULT '',
 observations INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_token_universe_recent ON token_universe(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_token_universe_score ON token_universe(score DESC,last_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_universe_pool_age ON token_universe(first_pool_at);

-- One-time import of authentic already-recorded risk snapshots. No fabricated pool age,
-- volume, or recent price; older records keep their actual assessed_at timestamp.
-- INSERT OR IGNORE preserves better data acquired by the new discovery engine.
INSERT OR IGNORE INTO token_universe
(mint,name,symbol,source,first_seen,first_pool_at,last_observed_at,last_seen,
 pool_address,dex,price_usd,liquidity_usd,volume5m_usd,change5m_pct,
 buys5m,sells5m,score,best_score,stage,risk_level,price_source,observations)
SELECT mint,name,symbol,'historico_real',assessed_at,NULL,assessed_at,assessed_at,
 NULL,'',pool_price,pool_liquidity,NULL,NULL,NULL,NULL,
 market_score,market_score,
 CASE WHEN market_score>=70 THEN 'priority' ELSE 'watch' END,
 level,'risk_watch_legacy',1
FROM risk_watch WHERE pool_price>0
 AND assessed_at>unixepoch('now')*1000-14*24*60*60*1000
 ORDER BY assessed_at DESC LIMIT 400;
