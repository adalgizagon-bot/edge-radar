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
