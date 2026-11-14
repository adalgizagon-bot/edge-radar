// Frozen prospective-v1; parity tested against server.research.PROTOCOL.
export const PROTOCOL = Object.freeze({
  version: "prospective-v1",
  primary_horizon_minutes: 30,
  horizons: [5, 15, 30, 60],
  endpoint_tolerance_seconds: 180,
  baseline_max_age_seconds: 300,
  liquidity_ratio_bounds: [0.5, 2],
  volume_ratio_bounds: [0.5, 2],
  notional_usd: 20,
  fee_per_side_bps: 100,
  slippage_per_side_bps: 100,
  network_fee_per_side_usd: 0.05,
  min_pairs_for_inference: 100,
  min_days_for_inference: 20,
});
