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
