# Email notifications

Confirmed incidents and confirmed recovery events enter a PostgreSQL outbox in the same transaction as their incident state change. A single open incident emits one opening event; HTTP/SSL recovery is emitted only after two consecutive successes. Connector `stale_data` warnings open after the server heartbeat-stale threshold and recover after one authenticated, non-replayed heartbeat, with independent Connector offline/restored mail wording. Connector freshness never asserts HTTP availability. A connection reset is not described as recovery and does not send a recovery message. See [responsiveness configuration and acceptance](MONITORING_RESPONSIVENESS.md).

The `/app/notifications` sidebar destination manages recipients per workspace. Verified owners/admins may change settings, add recipients, resend verification, enable/disable/delete recipients and send test emails; other members are read-only. Platform allowlisting does not grant tenant access. The member directory comes from authenticated membership checks.

Verified-member delivery defaults on and can be turned off independently. Managed destinations override automatic member delivery for the same normalized address, even when pending, disabled or soft-deleted (a tombstone prevents fallback). Active enabled verified destinations are unioned with remaining automatic members and deduplicated before enqueue. A new recipient receives future events only. Removing an endpoint never removes a user or workspace membership. Re-add and reverify a deleted destination to resume delivery.

The worker revalidates the recipient before each provider call, including retries. Disabled/deleted endpoints, disabled member delivery and revoked/unverified memberships suppress pending messages with `RECIPIENT_DISABLED`. In-flight/provider-accepted mail cannot be recalled. A managed endpoint authorizes delivery independently of membership, so removing a member does not disable their separately verified managed endpoint. An automatic delivery superseded by any managed row is suppressed rather than rerouted.

Verification is a separate destination opt-in, not an authentication/session protocol: random 256-bit token, hash-only storage, one-hour expiry, endpoint scope, single use, replacement on resend and invalidation on deletion. The public confirmation page removes fragment credentials from browser history and requires an explicit click; it grants no tenant access and does not enable disabled endpoints. GET never verifies. Trusted Origin is required for all mutations, including confirmation.

Up to 20 active endpoints are allowed per workspace. Verification and test requests share a persisted 60-second endpoint cooldown and 10-per-hour workspace budget, serialized under the organization lock across API replicas. Rejected/failed provider attempts consume the budget; duplicate/invalid requests roll back without sending. Verification/test messages use the API's existing file/Resend mail transport synchronously, with bounded timeout and no automatic retries; saved recipients survive provider failure. Owners/admins may retry after cooldown. Test messages are clearly labeled and require enabled verified endpoints. Provider acceptance is not inbox delivery.

Migration `0007_neat_morlun` introduces settings/endpoints and delivery organization/endpoint references, backfilling historical organization IDs through incidents/sites. Unresolvable orphan deliveries are suppressed, not blindly sent. Audit records include actors and endpoint IDs/settings changes, not destination addresses, proof tokens or provider responses. Endpoint rows are soft-deleted for delivery fencing; tombstones remain until workspace deletion. No customer production migration is run by this milestone.

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
