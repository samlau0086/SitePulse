# Heartbeat worker

`pnpm dev` runs this independent process alongside web/API. Production Compose starts it after migrations on the private database network, with no published ports. It processes at most 200 stale sites per sweep using row locks and SKIP LOCKED, including paired sites that never sent their first heartbeat. Stale transitions are audited once. Heartbeat writes use the same site lock and restore active state.

Configuration is validated through packages/config: DATABASE_URL, HEARTBEAT_STALE_SECONDS (default 2700), WORKER_POLL_SECONDS (default 60). Failures emit only a generic error and retry on the next sweep. SIGTERM/SIGINT stops the timer and closes the pool. No customer HTTP/SSL requests, incidents, inventory or alerts run here yet.
