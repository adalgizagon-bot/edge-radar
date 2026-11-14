# Controlled pilot preparation — 2026-11-14

The requested base commit 51263ee was pushed without force to rebuild/memecoin-radar-v1 before implementation. Main was not modified.

## Persistent shutdown

Migration 0004-bounded-pilot.sql was applied exclusively to D1 edge-radar-monitor-staging (9f2f5da7-fa94-4a66-afc8-664e958cd80e). pilot_control limits an authorization to 1800 seconds. Once used=1, a SQLite trigger prevents resetting used or changing its original start/deadline; deletion is blocked too. No real pilot authorization has been consumed: used=0.

The Worker checks current wall time against D1 before starting a round. Delayed cron timestamps do not bypass the deadline. Each provider call checks the deadline and carries an abort signal bounded by the remaining interval. Before the observation batch, a second JS check and an atomic SQLite NOT NULL guard reject a commit after expiration. Existing quota, storage, lease, cooldown and failure guards remain intact. The Free CPU ceiling is left to the platform; Free rejects a custom cpu_ms field (Cloudflare code 100328). No upgrade or limit increase was attempted.

## Verified before activation

22 monitor tests passed, including delayed replay, expiration during a provider request, immutable deadline, Worker probe, storage/read/write limits and existing source/failure guards. Offline staging preflight and git diff --check passed. The preflight script's deploy_authorized=false is a static statement from development, not an assessment of the user's subsequent authorization.

Worker version 85338e78-3035-43e1-8680-4a5a57ffe105 was deployed with MONITOR_ENABLED=false, the same staging-only binding and no public route. Its cron executed a real read/write integration probe in D1 with an already expired authorization. Persisted proof: {"status":"pilot_expired","outbound":0,"quick_check":"ok","read_write":"ok"}. probe_requested=probe_completed=1. A follow-up query confirmed zero catalog entries, zero observations and zero collection runs, quick_check=ok and no foreign-key violations. Database size: 81,920 bytes.

## Activation blocked

The authorized read-only endpoint /accounts/{account}/workers/observability/telemetry/query returned HTTP 403 Forbidden. As instructed by the owner, no collection pilot was activated after this permission block. GraphQL daily analytics are accessible, but do not yet identify a staging CPU sample; a single __unknown__ sample must not be attributed to staging. No CPU performance for a real collection round is claimed. MONITOR_ENABLED remains false and the unused D1 authorization remains expired. No active pilot needs to be stopped and no post-pilot frequency or source HTTP error rate exists.

At 2026-11-14 11:04:31 UTC / 08:04:31 America/Sao_Paulo, delayed daily analytics reported: 888 account-wide Worker invocations, zero errors; D1 account-wide 724,422 rows read and 9,952 written. Of those, the new staging D1 reported 82 rows read and 28 written (includes prior setup today, not collection). Query metadata and later analytics can differ due to propagation. All remain below the owner's confirmed Free quotas. This is preparation consumption, not a collection pilot result.

Before/after comparisons confirmed identical metadata for both legacy Workers and both legacy D1 databases. No writes or deployments targeted any of those resources. No payment, trading, main deployment or billing changes occurred.
