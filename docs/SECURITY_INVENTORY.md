# WordPress security and inventory

SitePulse Connector 0.2.0 adds read-only asset and risk visibility for a paired single-site WordPress installation. It reports all discoverable installed plugins and themes (up to 200 plugins and 20 themes), versions, active state, available update versions, WordPress/PHP versions, and selected non-secret environment flags.

## What is checked

- Production debug display, dashboard file editing, admin HTTPS enforcement and related WordPress environment flags.
- Public vulnerability and supply-chain reports for WordPress core, PHP, and components that WordPress itself identifies as WordPress.org packages.
- A bounded local scan of PHP-like files under `wp-content`: at most 5,000 directory entries, 500 files, 512 KiB per file and 100 findings, with a two-second traversal budget (individual filesystem operations may exceed it). Results are cached for six hours with a scan timestamp. Partial scans do not resume where they stopped; a full offline audit is needed for larger installations.
- High-confidence indicators only: PHP under uploads, encoded/decompressed execution patterns and command execution combined with request/decoded input.

The Connector sends rule IDs and normalized paths relative to `wp-content`; it does not upload file contents, absolute paths, database data, WordPress credentials or plugin settings. It never modifies, quarantines or deletes a file and provides no remote command channel.

## Public advisory data

The worker queries fixed HTTPS endpoints at `www.wpvulnerability.net` with redirects disabled, an eight-second timeout and a streamed one-megabyte response limit. The provider receives the SitePulse worker's public IP and requested component identifiers/versions, but not the customer site URL or source files. Queries run daily per site, or when the reported components change; failures are retried after one hour. Each worker runs one assessment at a time, with up to five concurrent requests, separately from monitoring/notification sweeps. Set validated `SECURITY_ADVISORIES_ENABLED=false` and redeploy/restart the worker to pause external advisory lookups while retaining stored results.

Before commercial redistribution or high-volume use, the operator must review the current WPVulnerability API terms, attribution and capacity policy. Provider availability and coverage are not controlled by SitePulse.

## Interpretation and limitations

`No matched advisories` means only that the current provider response contained no match in the stated coverage. Custom/premium packages, unrecognized versions, malformed advisory ranges, inventories at their collection limit, old Connectors and provider failures produce partial or unknown coverage. PHP support expiry is reported using the provider's support-end date. An update not being offered does not mean a version is secure. WordPress.org identity is inferred from WordPress metadata, not independently authenticated; altered metadata or forks can produce inaccurate matches.

Local pattern matches require human review and can be legitimate code. A clean bounded scan is not an antivirus result, integrity proof or full source-code audit. A compromised WordPress runtime can falsify its own inventory and scan report. The first release does not verify core/plugin files against signed checksums, inspect the database, scan JavaScript or media payloads, integrate malware reputation services, or remediate findings.

## Staging acceptance

1. Deploy migration `0011_many_smiling_tiger` through the normal encrypted pre-migration backup workflow.
2. Install/upgrade Connector 0.2.0 on a controlled staging WordPress site and wait for a successful heartbeat/inventory sync.
3. Confirm Inventory lists active and inactive plugins/themes and marks unknown/custom package source coverage honestly.
4. Confirm Security shows environment, local-file and public-advisory coverage independently.
5. Add a harmless PHP fixture under staging uploads, wait for the six-hour cache or remove the `sitepulse_security_scan` option in controlled staging, trigger a sync, and confirm `php_in_uploads`; remove the fixture immediately.
6. Confirm an unrelated organization member receives 404 for the site detail API and cannot view the report.
7. Disable `SECURITY_ADVISORIES_ENABLED`, redeploy, and confirm external refreshes stop without changing monitoring or Connector heartbeat behavior; re-enable it after testing.

Never use a real malicious sample, production customer code, or credentials for acceptance evidence.

## Deferred acceptance

- Slack/Telegram delivery acceptance on the deployed environment remains pending at the user's request. This milestone does not mark it complete.
- Security UI desktop/mobile visual acceptance and the staging procedure above remain required before claiming production acceptance.
