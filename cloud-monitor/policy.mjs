// Scheduling policy only; activity promotion never validates an entry.
export const CAPACITY = Object.freeze({
  tick: 180,
  fast: 6,
  follow: 2,
  discovery: 2,
  total: 12,
});
export function choose(
  fast,
  follow,
  at,
  options = { rotation: true, burst: false },
) {
  const pinned = fast
    .filter((x) => x.pin_until > at)
    .sort((a, b) => a.next_at - b.next_at || a.mint.localeCompare(b.mint));
  const hot = fast
    .filter(
      (x) =>
        x.pin_until <= at &&
        (options.rotation ||
          (options.burst && at - x.last_attempt >= 50) ||
          x.next_at <= at) &&
        at - x.last_seen <= 600,
    )
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        a.next_at - b.next_at ||
        a.mint.localeCompare(b.mint),
    );
  const selected = [...pinned, ...hot].slice(0, CAPACITY.fast);
  if (options.burst && !options.rotation) {
    const groups = new Map();
    for (const x of selected) {
      const key = x.pin_until > at && x.study_pair ? x.study_pair : x.mint;
      groups.set(key, [...(groups.get(key) || []), x]);
    }
    const ranked = [...groups.values()].sort(
      (a, b) =>
        Math.max(...b.map((x) => (x.weak_streak >= 2 ? 0 : x.priority))) -
          Math.max(...a.map((x) => (x.weak_streak >= 2 ? 0 : x.priority))) ||
        a[0].mint.localeCompare(b[0].mint),
    );
    const result = [];
    for (const group of ranked) {
      if (result.length + group.length <= 2) result.push(...group);
    }
    return result;
  }
  if (!options.rotation) return [];

  const existing = new Set(selected.map((x) => x.mint));
  const slow = follow
    .filter((x) => !existing.has(x.mint) && x.next_at <= at)
    .sort(
      (a, b) => a.last_attempt - b.last_attempt || a.mint.localeCompare(b.mint),
    );
  // Unused fast slots are loaned to the follow radar, never the reverse while fast is due.
  return [
    ...selected,
    ...slow.slice(0, CAPACITY.fast + CAPACITY.follow - selected.length),
  ];
}
export function transition(x, state, fastCount, at) {
  const recent = (state.recent ? JSON.parse(state.recent) : []).filter(
    (v) =>
      v.source === x.source &&
      v.pool === x.pool &&
      v.observed_at < x.observed_at &&
      v.observed_at >= at - 3900,
  );
  const previous = recent.at(-1);
  const pressure =
    x.buys !== null && x.sells !== null && x.buys + x.sells > 0
      ? x.buys / (x.buys + x.sells)
      : null;
  const promising =
    x.liquidity !== null &&
    x.liquidity >= 20000 &&
    x.volume5m !== null &&
    x.volume5m >= 2000 &&
    pressure !== null &&
    pressure >= 0.6;
  const weakening =
    !!previous &&
    (!promising ||
      x.volume5m < previous.volume5m * 0.7 ||
      x.liquidity < previous.liquidity * 0.9);
  const weak = weakening ? (state.weak_streak || 0) + 1 : 0;
  const pinned = state.pin_until > at;
  const wanted = promising || (state.tier === "fast" && weak < 2);
  const tier =
    pinned ||
    (wanted && weak < 2 && (state.tier === "fast" || fastCount < CAPACITY.fast))
      ? "fast"
      : "follow";
  const delta = (key) =>
    previous && previous[key] > 0 && x[key] !== null
      ? (x[key] / previous[key] - 1) * 100
      : null;
  const history = [...recent, x].slice(-14);
  return {
    history,
    watch: {
      elapsed_seconds: previous ? x.observed_at - previous.observed_at : null,
      price_change_pct: delta("price"),
      rolling_volume5m_change_pct: delta("volume5m"),
      liquidity_change_pct: delta("liquidity"),
      buy_transactions_change_pct: delta("buys"),
      unique_buyers_change_pct: delta("unique_buyers"),
      pressure,
      weakening,
      window_overlap: true,
      validated_entry: false,
    },
    tier,
    weak_streak: weak,
    priority: promising ? 60 : 10,
    reason: pinned
      ? "study_pin"
      : weak >= 2
        ? "weakening"
        : promising
          ? "promising"
          : "rotation",
    next_at: at + (tier === "fast" ? 180 : 1800),
    recent: JSON.stringify(history),
  };
}
export function capacity(follow = 123, fast = 6) {
  const slowSlots = CAPACITY.follow + Math.max(0, CAPACITY.fast - fast);
  return {
    fast_contracts: Math.min(fast, 6),
    fast_interval_minutes: 3,
    burst_contracts: 2,
    burst_interval_minutes: 1,
    burst_window_minutes: 15,
    burst_max_minutes_per_day: 360,
    follow_contracts: follow,
    follow_worst_rotation_minutes: Math.max(
      30,
      Math.ceil(follow / slowSlots) * 3,
    ),
    samples_per_day: 4512,
    writes_reserved_per_day: 64896,
  };
}
