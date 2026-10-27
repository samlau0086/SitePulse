# Monitoring responsiveness optimization

## Configuration and latency

The server worker probes public HTTP independently of WordPress cron. `MONITOR_INTERVAL_SECONDS` defaults to `300`, accepts integer seconds `60`–`3600`, and is set by operators in `.env` or the GitHub deployment Environment Variables. This is global configuration, not a new tenant API or billing entitlement. Existing explicit `900` values are not silently overwritten: update/remove them and redeploy. Invalid values fail startup/deployment validation. SSL remains independently configured by `SSL_INTERVAL_SECONDS`.

Healthy HTTP checks use the chosen interval. The first failure persists `suspected` (first failure) and schedules confirmation after 60 seconds, without an incident/email. The second consecutive failure opens one incident. Persistent failures back off 60/120/240/480/960 seconds, capped by the configured interval. A successful check during an incident enters `recovering`, rechecks after 60 seconds, then resolves after a second consecutive success. A failure interrupts recovery. Acknowledgement never suppresses checks or marks recovery.

Nominal outage confirmation latency is up to one normal interval plus 60 seconds, plus polling, probe and database runtime, queue contention and email/provider delay. The loop sleeps `WORKER_POLL_SECONDS` (default 60, allowed 10–300) **after** its sweep. Four jobs and five deliveries per sweep are pilot limits, not a throughput or mailbox SLA. For 60-second probes, a 10-second poll reduces scheduler lag. Increasing worker replicas preserves leases/fencing but does not promise instant detection. Shorter intervals tighten up to 200 healthy unleased HTTP jobs per sweep, using last server check time; already-due work is never postponed and confirmation/recovery schedules remain untouched. Increasing intervals takes effect after the next completed probe.

## Connector loss is not website downtime

Connector heartbeat cadence stays 15 minutes. The stale threshold is `HEARTBEAT_STALE_SECONDS`, default 2700 seconds (45 minutes), allowed 1800–86400. Decisions use server receipt time, or pairing time if no heartbeat has arrived. After this threshold plus worker/queue delay, a live paired site opens one warning `stale_data` incident and becomes degraded. Already-degraded sites without an active Connector incident are included on upgrade. Unpaired, disconnected, deleted or revoked connections do not alert.

Expiration and authenticated heartbeat handling serialize under the site row lock. A valid credential and strictly increasing sequence are required before a heartbeat resolves the Connector incident. One valid heartbeat is sufficient; HTTP recovery still requires two successful probes. Invalid, cross-site, revoked and replayed credentials cannot resolve it. Repeated worker sweeps/heartbeats do not enqueue duplicate opening/recovery events. A later loss creates a new episode. Disconnect, rotation and re-pair close incidents as `connection_reset`, without recovery mail.

All incident sources share the existing verified/enabled workspace-recipient policy, endpoint tombstones, member switch, unique event keys and transactional outbox. Delivery still rechecks eligibility and uses provider idempotency keys/retry fencing. External probes retain all DNS/address validation, pinning, redirect and timeout protections. Tenant API reads/acknowledgements retain server membership checks. No live deployment or production data is changed by implementation.

## Verification and controlled acceptance

Run on the development computer:

```sh
pnpm check
pnpm test:db:up
# PowerShell: $env:TEST_DATABASE_URL='postgresql://sitepulse_test:sitepulse_test@127.0.0.1:5433/sitepulse_test'
# POSIX: export TEST_DATABASE_URL='postgresql://sitepulse_test:sitepulse_test@127.0.0.1:5433/sitepulse_test'
pnpm test:integration
pnpm build
pnpm db:check
pnpm compose:check
```

Integration fixtures require a dedicated disposable database ending `_test`; never point them at production. Tests use fake probe results and server timestamps instead of sleeping for minutes. They cover first-failure/no-mail, exact retry/recovery due-time deltas, schedule shortening and lease preservation, repeated failures, concurrent stale sweeps, replay/forged recovery rejection, Connector recovery deduplication, tenant read isolation and reset-without-recovery. Existing SSRF and recipient suppression suites remain in place.

Before staging deployment, confirm the encrypted database backup and apply registered migration `0008_flippant_shiver_man` through the usual workflow. On an authorized test site:

1. Confirm default/explicit interval and scheduled timestamps. Temporarily choose `60` and poll `10` if desired; restore intended values afterward.
2. Cause a controlled HTTP failure. Verify first-failure status without an email, then one confirmed incident/opening event after the next failed probe. Keep it failing and verify no duplicate opening events. Restore it and verify recovering, then one recovery event after the second success.
3. Stop only Connector heartbeat execution, keeping the public page online. Wait the configured stale threshold. Confirm Connector offline warning, no false HTTP DOWN signal, and one opening delivery per eligible recipient. Continue waiting and verify no duplicates.
4. Resume heartbeat execution. Confirm one Connector restored event, no repeated recovery email, and independent HTTP/SSL state. Disconnect an affected test connection and confirm closure says recovery unverified rather than recovered.
5. Confirm another workspace cannot read/acknowledge the incident and is not included in its recipients. Record event/queue/provider/mailbox times separately; provider acceptance is not proof of inbox delivery.

Do not fault-inject customer production sites. Manual staging/mailbox acceptance remains a separate operator action.
