// The environment selects one explicit session; no automatic rollover or next pilot.
export function authorization(env) {
  const id = env.PILOT_AUTHORIZATION_ID;
  if (!id)
    return {
      source: "pilot_control",
      args: [],
      guard:
        "EXISTS(SELECT 1 FROM pilot_control WHERE id=1 AND used=1 AND started_at<=unixepoch() AND expires_at>unixepoch())",
      probeSelect: "SELECT * FROM pilot_control WHERE id=1",
      probeUpdate:
        "UPDATE pilot_control SET probe_completed=probe_requested,probe_result=? WHERE id=1 AND used=0 AND expires_at<=unixepoch()",
    };
  return {
    source:
      "(SELECT 1 AS id,purpose,started_at,expires_at,CASE WHEN consumed=1 AND stopped_at=0 AND kind='pilot' THEN 1 ELSE 0 END AS used FROM pilot_authorizations WHERE id=?)",
    args: [id],
    guard:
      "EXISTS(SELECT 1 FROM pilot_authorizations WHERE id=? AND kind='pilot' AND consumed=1 AND stopped_at=0 AND started_at<=unixepoch() AND expires_at>unixepoch())",
    probeSelect:
      "SELECT *,consumed AS used FROM pilot_authorizations WHERE id=?",
    probeUpdate:
      "UPDATE pilot_authorizations SET probe_completed=probe_requested,probe_result=? WHERE consumed=0 AND kind='shutdown-test' AND expires_at<=unixepoch() AND id=?",
  };
}
