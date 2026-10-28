# WordPress plugin and theme management

This post-MVP milestone explicitly authorizes a narrow remote mutation protocol. Earlier foundation/read-only milestone exclusions still apply to those milestones; this feature never provides arbitrary shell, SQL, source editing or uploaded package execution.

## Permissions and execution

- Better Auth session, verified email, trusted Origin and current workspace owner/admin membership are required for previews, confirmation, cancellation and manual review. Members may read inventory/results. Platform administrator status does not grant tenant access.
- WordPress management starts disabled. A nonce-protected local administrator action records explicit consent and the administrator user ID. The Connector rechecks that user's current capabilities for every operation and restores the original WordPress user after execution. Removing that user's capabilities or opting out prevents future execution. Multisite is unsupported.
- A site must have a current Connector poll (five minutes), a valid current site credential, active connection, and complete inventory less than one hour old. Preview records bind current inventory and credential version; changes invalidate confirmation/dispatch. Each batch is limited to 20 unique sites and one component/action.
- Confirmation is atomic across the selected sites; execution is independent. The same preview cannot create duplicate queued commands. A partial batch is never claimed to be an atomic WordPress transaction.
- Each site has at most one queued/running/unknown command, enforced by site row locking and a partial unique database index. Role, verified email, site, credential version, opt-in and inventory are checked again at dispatch. A credential can only poll/report for its own site. Audit events include actual actor, component/action, reason, batch, dispatch and sanitized result; no site secret, command token, plugin output or request body is logged.
- The Connector makes outbound authenticated HTTPS POSTs, with the existing safe HTTP transport. No inbound WordPress execution route or SaaS-to-site administrative fetch is added. Existing public monitor SSRF checks are unchanged.

## Operations and safeguards

Plugins/themes support install, activate, deactivate, update and uninstall. Theme deactivation switches to an explicitly chosen installed theme. Protect active components from deletion, protect parent themes and active plugin dependents, and refuse ambiguous plugin identifiers. The Connector cannot modify itself remotely.

Installation/update metadata comes from the native WordPress.org API. Package URLs must be HTTPS on exactly `downloads.wordpress.org`, match the selected component's slug and the official plugin/theme ZIP path, and contain no query or fragment. Downloads use safe WordPress HTTP, TLS validation, no redirects, a 60-second timeout and a 50 MiB cap. WordPress native upgraders validate/extract/install packages; update flow uses a freshly resolved official package rather than accepting a client-supplied update URL. Custom Update URI updates are refused. No arbitrary URL, ZIP upload, premium registry, shell command or credentials for FTP/SSH are accepted. File changes require WordPress direct filesystem access and respect `DISALLOW_FILE_MODS`.

The site administrator must back up WordPress files AND database before changes. SitePulse's VPS database backups cover SitePulse records, not client WordPress files/data. Activation and uninstall hooks execute the selected installed plugin's normal WordPress lifecycle code; a faulty plugin can crash PHP or remove plugin data. Compatibility, hosting limits and rollback remain the operator's responsibility. Dependency guards supplement WordPress validation but cannot discover undeclared business dependencies.

## Delivery, replay and uncertainty

Management uses a separate single-event WP-Cron hook every minute, without changing the 15-minute heartbeat. System Cron should execute due WordPress jobs every minute; ordinary WP-Cron depends on traffic. Dashboard refreshes results every ten seconds and does not trigger execution.

Preview expires after ten minutes; queued work expires after one hour. A claim has a one-minute start deadline. The server never automatically reassigns running work. Connector durably writes a receipt before mutation, stores its sanitized outcome before sending acknowledgement, and retries acknowledgement only. A lost claim response or PHP crash can leave the outcome unknown; at fifteen minutes a running operation is displayed/reconciled as unknown. No exactly-once execution guarantee is claimed across PHP/database crashes, local database restoration or external WordPress changes.

Inspect WordPress before clicking **Reviewed in WordPress**; this releases the batch's unknown entries without undoing changes. A later stale result cannot override reviewed/cancelled records. Cancellation affects unstarted work only. Revocation, disconnect and permission changes cannot undo already dispatched/in-flight operations. Clock synchronization is required between VPS and WordPress for the short start deadline. Run PHP jobs with a hosting execution timeout shorter than fifteen minutes; do not release an unknown operation while a PHP process may still be working.

Successful result acknowledgement triggers an inventory refresh. Inventory may remain old if the refresh fails; UI shows receipt timestamps and refreshes on later heartbeat. Missing plugin icons fall back to shared SVG artwork. Official plugin icon requests go directly from the browser to fixed `ps.w.org` HTTPS paths with no referrer; WordPress.org receives the browser IP and slug, never a site credential. No arbitrary image proxy is exposed.

## API

| Endpoint under `/api/v1`                                        | Authorization / purpose                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /organizations/:organizationId/software`                   | Membership; current inventory/capability and latest 100 operations; no command tokens     |
| `POST /organizations/:organizationId/software/preview`          | Verified owner/admin; `{siteIds, command:{kind,action,slug,replacement?}, reason}`        |
| `POST /organizations/:organizationId/software/:batchId/confirm` | Verified preview author; `{}`                                                             |
| `POST /organizations/:organizationId/software/:batchId/cancel`  | Verified owner/admin; cancel preview/queued entries                                       |
| `POST /organizations/:organizationId/software/:batchId/resolve` | Verified owner/admin; confirm manual review of unknown entries                            |
| `POST /connector/software-poll`                                 | Current site bearer; `{siteId,enabled}`; one command or null                              |
| `POST /connector/software-result`                               | Same site bearer, credential version and command token; `{siteId,operationId,token,code}` |

Result codes: `ok`, `disabled`, `unsupported`, `not_installed`, `already_installed`, `active`, `dependency`, `filesystem`, `package`, `wordpress_error`, `uncertain`. No plugin error messages are returned. Consult the site's protected WordPress logs for diagnostics without sharing secrets.

## Validation and staging acceptance

Automated API tests use the dedicated disposable `_test` PostgreSQL database. PHP tests use isolated WordPress doubles and perform no real network/file mutations outside temporary fixtures. They do not replace testing actual WordPress upgraders.

1. Back up two disposable single-site WordPress installations. Upgrade Connector to 0.3.0, pair, opt in, and run system Cron every minute. Wait for a complete inventory. Verify management is disabled before opt-in.
2. In Plugins & themes select both sites, install an official disposable plugin by slug, then activate, update where an update exists, deactivate and uninstall in separate confirmed batches. Check individual results and fresh inventory in WordPress; a repeated confirm must not repeat execution.
3. On one test site install a second official theme, switch to it, deactivate by switching back, update where available and delete the inactive theme. Verify active and parent themes cannot be deleted; active plugin dependents block deactivation/uninstall. Keep the Connector protected.
4. Check member read-only, unverified owner denied, cross-workspace IDs hidden, forged Origin denied, each site's bearer rejected for the other site, and queued work suppressed after local opt-out/member demotion/credential rotation.
5. Interrupt acknowledgement after a harmless operation. Confirm later receipt retries do not repeat the mutation. Simulate an abandoned claim: after fifteen minutes show unknown, block new work, inspect WordPress and explicitly resolve. Never simulate failures on a production/customer site.
6. Review desktop/mobile, empty states, missing icons, keyboard selection/focus, required reason, preview expiry/conflicts and partial failure results. Validate database migration using the normal backup-first VPS workflow.

Live WordPress/hosting acceptance must be completed on staging before enabling this capability for production sites. No production deployment or client-site changes are performed by local automated checks.
