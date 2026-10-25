# Email notifications

Confirmed incidents and confirmed recovery events enter a PostgreSQL outbox in the same transaction as their incident state change. A single open incident emits one opening event; recovery is emitted only after the monitor's configured consecutive-success threshold. A connection reset is not described as recovery and does not send a recovery message.

The initial recipient policy is intentionally automatic: every currently verified member of the incident's organization receives the event. Unverified accounts and members of other organizations are excluded. There is no recipient-management API or UI in this milestone. Adding/removing members in a future milestone should affect future events only; already queued messages retain their recipient snapshot.

The worker claims up to five rows with `FOR UPDATE SKIP LOCKED`, records a 60-second lease and a random lease token, and releases database locks before calling the provider. Completion updates must match the lease token so an expired worker cannot overwrite a newer attempt. The event key is unique in the database and sent to Resend as its idempotency key. Transient failures retry with exponential backoff from 30 seconds to one hour, for at most eight attempts; exhausted deliveries become `failed`. Provider response bodies are discarded for non-success responses. Only a provider message ID or a fixed error code is persisted. Provider handoff is not proof of delivery to the recipient's inbox.

Local development uses the existing `AUTH_MAIL_TRANSPORT=file` setting and writes alert messages to `.local/alert-mail` with restrictive permissions. Production requires `AUTH_MAIL_TRANSPORT=resend`, a verified `AUTH_MAIL_FROM`, and `RESEND_API_KEY`; the Compose worker receives the same validated settings as the API. The worker sends queued notifications even if `MONITORING_ENABLED=false`, allowing delivery retries while probes are paused.

## Staging acceptance

Follow the executable [staging email acceptance runbook](NOTIFICATION_ACCEPTANCE.md) for GitHub configuration, controlled failure/recovery, read-only delivery queries, retry isolation and an evidence template. Record provider handoff separately from actual mailbox receipt.

1. Confirm a verified account belongs to the test organization's membership and an unverified account is excluded.
2. Trigger a controlled HTTP/SSL failure that crosses the confirmation threshold. Verify one opening message per verified member and one delivery row per unique event key.
3. Keep the incident failing across additional checks; verify no duplicate opening message is sent.
4. Restore the endpoint and cross the recovery threshold. Verify one recovery message per verified member.
5. Cause a provider rejection in a non-production test environment. Verify sanitized error state, a future retry time, and eventual sent/failed terminal state without exposing provider response content.
6. Verify another organization's email is never a recipient. Do not use customer production sites for fault injection.

Run `pnpm check`, `pnpm test:integration`, `pnpm build`, and `pnpm compose:check` before deployment. Staging database migration requires a successful pre-migration backup; production deployment requires separate authorization.
