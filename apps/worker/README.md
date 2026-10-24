# SitePulse worker

`pnpm dev` runs this process alongside web/API. Compose starts it after migrations. It expires stale heartbeats in bounded transactions and runs independent external HTTP/SSL jobs. It publishes no ports; the database network stays internal and a separate monitoring network provides outbound DNS/HTTP/HTTPS connectivity.

Settings are validated through packages/config: DATABASE_URL, HEARTBEAT_STALE_SECONDS (2700), WORKER_POLL_SECONDS (60), MONITORING_ENABLED (true), MONITOR_INTERVAL_SECONDS (900; 300–86400), SSL_INTERVAL_SECONDS (86400; 3600–604800). Disabling monitoring pauses probes/retention and preserves history; heartbeat expiration continues. SIGTERM/SIGINT stops scheduling, waits for the current sweep and closes the pool. Errors are generic and never log response bodies, credentials or arbitrary network errors.

Each sweep seeds at most 200 jobs and claims at most four with SKIP LOCKED and 90-second token leases. Probes run concurrently outside transactions with a ten-second budget. Completion fences expired leases and obsolete connections. Two failures confirm an incident and two successes recover it. Retry delays start at 60 seconds and cap at the lesser of the normal interval and 960 seconds. Checks and resolved incidents are cleaned up in bounded batches after 30/90 days. This is a small-pilot scheduler; measure due-job lag before increasing site counts.

SSRF controls, state transitions and deployment acceptance are described in docs/ARCHITECTURE.md, docs/SECURITY.md and docs/MONITORING_ACCEPTANCE.md. Run `pnpm test` for address/redirect/real HTTP/TLS tests (OpenSSL required), and `pnpm test:integration` against a disposable PostgreSQL database for jobs/incidents/isolation. No alert delivery or remote WordPress execution runs here.
