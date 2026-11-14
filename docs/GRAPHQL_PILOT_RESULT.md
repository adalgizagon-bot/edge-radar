# Staging CPU via GraphQL and first pilot result — 2026-11-14

## Observation path verified without broader token permissions

Cloudflare GraphQL workersInvocationsAdaptive accepts exact scriptName and scriptVersion filters and returns invocation status, request/error/subrequest counts, CPU sum and maximum, and CPU p50/p95/p99. GraphQL schema introspection explicitly defines these CPU fields in microseconds. This is delayed analytics with adaptive sampling, not synchronous per-invocation tracing.

scripts/staging_metrics.py implements a read-only query for edge-radar-monitor-staging, with optional exact version filtering and rejection of unknown/mismatched identities. No aggregate or __unknown__ Worker metric is attributed to staging. The baseline identified the deployed version 85338e78-3035-43e1-8680-4a5a57ffe105: maximum 5.161 ms, zero errors and zero outbound subrequests while disabled. The telemetry/query permission is not needed for these GraphQL measurements. Workers Observability Write was neither requested nor added.

Example (does not activate or mutate anything):

```sh
python scripts/staging_metrics.py --since 2026-11-14T11:24:25Z --version 60c8612a-33c6-4be9-a2f3-a3b6d8d0485a
```

## One bounded authorization, then preventive stop

The earlier expired shutdown probe was preserved atomically in pilot_authorization_log by migration 0005-pilot-audit.sql when arming a fresh authorization. The audit includes the original used=0 control and the successful Worker read/write/expiry proof. No expiry trigger was removed. The consumed authorization cannot be extended or reset.

A single 1800-second window was authorized at 11:24:25 UTC (08:24:25 America/Sao_Paulo), with immutable deadline 11:54:25 UTC (08:54:25). Active version: 60c8612a-33c6-4be9-a2f3-a3b6d8d0485a. No public route or preview URL was enabled.

The observer used exact staging metrics, shared daily quotas and D1 state. Its conservative CPU stop threshold was 10 ms. It would also pause for execution errors, unavailable metrics, Worker safety pauses or 90% of a shared daily quota. Native Free limits and the existing 2,000,000-read / 45,000-write / 350,000,000-byte / 70,000-reservation guards were retained. The platform does not support custom CPU limits on Free.

The first eligible empty round used 10.186 ms CPU. That exceeded the observer budget by 0.186 ms, although Cloudflare reported success and zero execution errors. A preventive D1 pause was applied as soon as the exact metric was observed, by 11:25:46 UTC, and MONITOR_ENABLED=false was redeployed (version 83b3085d-f3c9-4e04-bc76-8bedc1b8fa21). The observer independently confirmed the CPU pause at 11:25:56. The pilot was interrupted after about 81 seconds, not completed for 30 minutes. It was not rearmed.

## Actual results and measured consumption

- One collection round was persisted. No provider calls were scheduled before the stop (initial discovery was next due at 11:30 UTC).
- Zero real contracts, zero observations, zero provider HTTP requests/errors. Effective observation cadence cannot be established.
- Active-version GraphQL: two successful cron invocations, zero execution errors, zero subrequests; CPU total 13.921 ms, maximum 10.186 ms, p50 3.735 ms and p95/p99 10.186 ms. Do not interpret two tiny samples as a performance benchmark.
- Worker-maintained D1 round counters: 10 rows read, 7 rows written; reserved writes=104 is a reservation, not actual measured writes.
- Delayed D1 analytics for the new staging DB in the interval starting 11:24:25, observed at 11:28:09 UTC: 36 rows read, 10 written, including control/observer queries. Storage 90,112 bytes (88 KiB).
- Shared daily analytics at that observation: 931 Worker requests, zero errors, 751,800 D1 rows read and 10,164 written. These totals include ongoing legacy workloads and are not attributed to staging.
- Remote quick_check=ok, foreign_key_check empty. After the stop, repeated queries after subsequent cron times still returned one run and zero observations. GraphQL identified the disabled version with successful execution and zero subrequests. MONITOR_ENABLED=false and paused=1 were verified remotely.

Because the pilot stopped early on CPU budget, the natural 11:54:25 expiry was not awaited or claimed as a live post-expiry test. The persisted expiry guard and previous local/remote shutdown tests remain intact. The original deadline remains unchanged; the consumed authorization must not be reused. CPU optimization and a separately authorized future pilot are pending.

## Preservation and validation

23 monitor tests passed, including expiry during provider work, delayed events, immutable authorization and atomic preservation of the old shutdown proof. The read-only metrics script was exercised against exact active and disabled versions. Ruff 0.14.5 check/format and git diff --check passed.

Legacy Worker metadata was unchanged. Legacy D1 identities, creation metadata and configuration were unchanged; edge-radar-crypto file_size grew from 9,998,336 to 10,002,432 bytes during its existing activity. No write, migration or deploy from this task targeted either legacy D1 or either legacy Worker. No main, payment, financial-operation or billing changes occurred.
