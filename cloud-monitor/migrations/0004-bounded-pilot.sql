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
