# Staging Cloudflare — 2026-11-14

Source: rebuild/memecoin-radar-v1, d8fed8f.
Account: 0ec8696b85d9500411637ff2bbd6b0b2.
Workers Free / Active and no Workers Paid confirmed by the account owner in the Cloudflare panel; not verified through the subscriptions API.

- D1: edge-radar-monitor-staging, UUID 9f2f5da7-fa94-4a66-afc8-664e958cd80e.
- Worker: edge-radar-monitor-staging, version 6d4c8a4d-652e-40cd-8ea7-53c958c3fbea.
- MONITOR_DB binding verified through deployed settings.
- MONITOR_ENABLED=false verified through deployed settings.
- workers.dev and preview URLs disabled; no public route configured.
- Existing minute cron retained from source; the disabled guard returns before database or provider I/O. No collection was enabled.

Validation: 17 monitor tests passed; offline staging preflight passed and the actual UUID is configured. Wrangler created D1 and deployed the Worker successfully. The file-import upload failed with fetch failed; schema was subsequently applied successfully through the authorized D1 query API exclusively to the new UUID. Six application tables and five explicit indexes were checked. Remote quick_check returned ok, foreign_key_check returned no violations. D1 rejects integrity_check with SQLITE_AUTH, so a full integrity_check was not completed. The initial monitor_state has last_run=0; observations, catalog and monitor_runs are empty. Database size: 73,728 bytes.

Worker/D1 connectivity was verified through Cloudflare control-plane settings and direct D1 queries. No public HTTP endpoint or production Worker-to-D1 query was exercised: the Worker intentionally has no public route and its disabled mode does not query D1. Startup time reported by Wrangler: 1 ms; collection CPU has not been profiled.

Before/after inventory comparisons confirmed identical metadata for automatizador-instagram-scheduler, edge-radar-cloud, edge-radar-crypto and automatizador-worker-diagnostics. No writes, deployments or migrations targeted them. Final account inventory: three Workers and three D1 databases (of ten confirmed by the owner).

Account-wide daily analytics at 2026-11-14 10:56:32 UTC (07:56:32 America/Sao_Paulo): 877 Worker requests, zero errors, 716,081 D1 rows read, 9,771 rows written. Analytics are delayed and had not yet included the new D1. Successful schema and D1 validation query metadata, including the initial empty-schema check: 76 rows read and 22 rows written. Failed integrity-check/import overhead is not included in that per-query subtotal. Limits supplied by owner: 100,000 requests/day, 5,000,000 rows read/day, 100,000 rows written/day. No billing settings, protection limits, old projects or main branch were changed; no financial operations were performed.
