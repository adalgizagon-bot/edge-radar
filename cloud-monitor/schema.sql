-- Separate staging D1 only. Never apply to the legacy production database.
CREATE TABLE IF NOT EXISTS monitor_state(id INTEGER PRIMARY KEY CHECK(id=1),lease_until INTEGER NOT NULL DEFAULT 0,last_run INTEGER NOT NULL DEFAULT 0,gecko_after INTEGER NOT NULL DEFAULT 0,dex_after INTEGER NOT NULL DEFAULT 0,day INTEGER NOT NULL DEFAULT 0,writes_reserved INTEGER NOT NULL DEFAULT 0,samples_reserved INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO monitor_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS catalog(mint TEXT PRIMARY KEY,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,next_at INTEGER NOT NULL,priority INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS catalog_due ON catalog(next_at,priority);
CREATE INDEX IF NOT EXISTS catalog_fair ON catalog(last_attempt);
CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY,mint TEXT NOT NULL,observed_at INTEGER NOT NULL,source TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(mint,observed_at,source));
CREATE TABLE IF NOT EXISTS monitor_runs(id INTEGER PRIMARY KEY,started_at INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
