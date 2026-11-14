-- Separate staging D1 only. Never apply to the legacy production database.
CREATE TABLE IF NOT EXISTS monitor_state(id INTEGER PRIMARY KEY CHECK(id=1),lease_until INTEGER NOT NULL DEFAULT 0,last_run INTEGER NOT NULL DEFAULT 0,gecko_after INTEGER NOT NULL DEFAULT 0,dex_after INTEGER NOT NULL DEFAULT 0,day INTEGER NOT NULL DEFAULT 0,writes_reserved INTEGER NOT NULL DEFAULT 0,samples_reserved INTEGER NOT NULL DEFAULT 0,paused INTEGER NOT NULL DEFAULT 0,pause_reason TEXT,purpose TEXT NOT NULL DEFAULT 'edge-radar-staging',lease_owner TEXT,rows_read INTEGER NOT NULL DEFAULT 0,rows_written INTEGER NOT NULL DEFAULT 0,db_bytes INTEGER NOT NULL DEFAULT 0,failure_streak INTEGER NOT NULL DEFAULT 0,gecko_failures INTEGER NOT NULL DEFAULT 0,dex_failures INTEGER NOT NULL DEFAULT 0,burst_until INTEGER NOT NULL DEFAULT 0,burst_next INTEGER NOT NULL DEFAULT 0,burst_minutes INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO monitor_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS catalog(mint TEXT PRIMARY KEY,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,next_at INTEGER NOT NULL,priority INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0,tier TEXT NOT NULL DEFAULT 'follow',weak_streak INTEGER NOT NULL DEFAULT 0,pin_until INTEGER NOT NULL DEFAULT 0,last_alert INTEGER NOT NULL DEFAULT 0,recent TEXT NOT NULL DEFAULT '[]',reason TEXT NOT NULL DEFAULT 'rotation',study_pair TEXT);
CREATE INDEX IF NOT EXISTS catalog_due ON catalog(next_at,priority);
CREATE INDEX IF NOT EXISTS catalog_fair ON catalog(last_attempt,mint);
CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY,mint TEXT NOT NULL,observed_at INTEGER NOT NULL,source TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(mint,observed_at,source));
CREATE TABLE IF NOT EXISTS monitor_runs(id INTEGER PRIMARY KEY,started_at INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS catalog_tier ON catalog(tier,next_at);
CREATE TABLE IF NOT EXISTS research_cohorts(id TEXT PRIMARY KEY,alert_mint TEXT NOT NULL,control_mint TEXT,alert_at INTEGER NOT NULL,protocol TEXT NOT NULL,data TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS research_time ON research_cohorts(alert_at);
CREATE INDEX IF NOT EXISTS research_pending ON research_cohorts(completed,alert_at);
CREATE TABLE IF NOT EXISTS research_outcomes(cohort_id TEXT NOT NULL REFERENCES research_cohorts(id),role TEXT NOT NULL,horizon INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(cohort_id,role,horizon));

-- Staging only. Fail closed without a bounded, single-use D1 authorization.
CREATE TABLE pilot_control(
 id INTEGER PRIMARY KEY CHECK(id=1),
 purpose TEXT NOT NULL CHECK(purpose='edge-radar-staging'),
 started_at INTEGER NOT NULL DEFAULT 0,
 expires_at INTEGER NOT NULL DEFAULT 0,
 used INTEGER NOT NULL DEFAULT 0 CHECK(used IN(0,1)),
 probe_requested INTEGER NOT NULL DEFAULT 0,
 probe_completed INTEGER NOT NULL DEFAULT 0,
 probe_result TEXT,
 CHECK(expires_at>=started_at AND expires_at-started_at<=1800)
);
INSERT INTO pilot_control(id,purpose) VALUES(1,'edge-radar-staging');
CREATE TRIGGER pilot_no_extension BEFORE UPDATE ON pilot_control
WHEN OLD.used=1 AND (NEW.used!=1 OR NEW.started_at!=OLD.started_at OR NEW.expires_at!=OLD.expires_at)
BEGIN SELECT RAISE(ABORT,'pilot is single-use; deadline cannot be extended'); END;
CREATE TRIGGER pilot_no_delete BEFORE DELETE ON pilot_control
BEGIN SELECT RAISE(ABORT,'pilot authorization cannot be deleted'); END;

-- Preserve the expired shutdown-probe authorization when arming the one real pilot.
CREATE TABLE pilot_authorization_log(
 id INTEGER PRIMARY KEY CHECK(id=1),
 previous_control TEXT NOT NULL,
 started_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 recorded_at INTEGER NOT NULL
);
CREATE TRIGGER pilot_record_authorization BEFORE UPDATE ON pilot_control
WHEN OLD.used=0 AND NEW.used=1
BEGIN
 INSERT INTO pilot_authorization_log(id,previous_control,started_at,expires_at,recorded_at)
 VALUES(1,json_object('used',OLD.used,'started_at',OLD.started_at,'expires_at',OLD.expires_at,'probe_completed',OLD.probe_completed,'probe_result',OLD.probe_result),NEW.started_at,NEW.expires_at,unixepoch());
END;

-- Add independent, single-use sessions. Never changes pilot_control or its audit.
CREATE TABLE pilot_authorizations(
 id TEXT PRIMARY KEY,
 purpose TEXT NOT NULL DEFAULT 'edge-radar-staging' CHECK(purpose='edge-radar-staging'),
 shutdown_test_id TEXT REFERENCES pilot_authorizations(id),
 kind TEXT NOT NULL CHECK(kind IN('pilot','shutdown-test')),
 started_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN(0,1)),
 activated_at INTEGER NOT NULL DEFAULT 0,
 stopped_at INTEGER NOT NULL DEFAULT 0,
 stop_reason TEXT,
 probe_requested INTEGER NOT NULL DEFAULT 0,
 probe_completed INTEGER NOT NULL DEFAULT 0,
 probe_result TEXT,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 CHECK(expires_at>started_at AND expires_at-started_at<=1800),
 CHECK((consumed=0 AND activated_at=0 AND stopped_at=0) OR
       (consumed=1 AND activated_at>=started_at AND activated_at<expires_at)),
 CHECK(stopped_at=0 OR (consumed=1 AND stopped_at>=activated_at))
);
CREATE TRIGGER pilot_session_immutable BEFORE UPDATE ON pilot_authorizations
WHEN NEW.id!=OLD.id OR NEW.purpose!=OLD.purpose OR NEW.kind!=OLD.kind OR
 NEW.shutdown_test_id IS NOT OLD.shutdown_test_id OR NEW.started_at!=OLD.started_at OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT,'authorization identity and deadline are immutable'); END;
CREATE TRIGGER pilot_session_activate BEFORE UPDATE ON pilot_authorizations
WHEN OLD.consumed=0 AND NEW.consumed=1 AND
 (OLD.kind!='pilot' OR NEW.activated_at!=unixepoch() OR NEW.activated_at<OLD.started_at OR NEW.activated_at>=OLD.expires_at OR NOT EXISTS(
  SELECT 1 FROM pilot_authorizations proof WHERE proof.id=NEW.shutdown_test_id AND proof.kind='shutdown-test'
  AND proof.probe_completed>=1 AND json_extract(proof.probe_result,'$.status')='pilot_expired'
  AND json_extract(proof.probe_result,'$.outbound')=0 AND json_extract(proof.probe_result,'$.quick_check')='ok'
  AND json_extract(proof.probe_result,'$.read_write')='ok'
 ))
BEGIN SELECT RAISE(ABORT,'activation must be a real pilot within its fixed window'); END;
CREATE TRIGGER pilot_session_once BEFORE UPDATE ON pilot_authorizations
WHEN OLD.consumed=1 AND (NEW.consumed!=1 OR NEW.activated_at!=OLD.activated_at)
BEGIN SELECT RAISE(ABORT,'authorization cannot be rearmed'); END;
CREATE TRIGGER pilot_session_stop BEFORE UPDATE ON pilot_authorizations
WHEN OLD.stopped_at>0 AND (NEW.stopped_at!=OLD.stopped_at OR NEW.stop_reason IS NOT OLD.stop_reason)
BEGIN SELECT RAISE(ABORT,'authorization stop is permanent'); END;
CREATE TRIGGER pilot_session_no_delete BEFORE DELETE ON pilot_authorizations
BEGIN SELECT RAISE(ABORT,'authorization history cannot be deleted'); END;
CREATE TRIGGER pilot_session_probe_immutable BEFORE UPDATE ON pilot_authorizations
WHEN NEW.probe_completed<OLD.probe_completed OR (OLD.probe_completed>0 AND
 (NEW.probe_completed!=OLD.probe_completed OR NEW.probe_requested!=OLD.probe_requested OR NEW.probe_result IS NOT OLD.probe_result))
BEGIN SELECT RAISE(ABORT,'completed shutdown proof is immutable'); END;
