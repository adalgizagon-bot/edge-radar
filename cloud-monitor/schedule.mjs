// Indexed pending-cohort lookup. Keep frozen per-cohort horizons and unmatched controls.
export const DUE_COHORT = `c.completed=0 AND EXISTS (
  SELECT 1 FROM json_each(c.protocol,'$.horizons') h
  WHERE (c.control_mint IS NULL AND NOT EXISTS (
    SELECT 1 FROM research_outcomes o WHERE o.cohort_id=c.id AND o.role='control' AND o.horizon=h.value
  )) OR (c.alert_at+h.value*60<=? AND (
    NOT EXISTS (SELECT 1 FROM research_outcomes o WHERE o.cohort_id=c.id AND o.role='alert' AND o.horizon=h.value)
    OR (c.control_mint IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM research_outcomes o WHERE o.cohort_id=c.id AND o.role='control' AND o.horizon=h.value
    ))
  ))
)`;
