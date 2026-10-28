# Email branding

Email branding is a notification presentation milestone. It does not change Better Auth, sending domains, sender addresses, notification consent, queue leases or retry policy.

## Selection and persistence

`users.email_brand_name` and `users.email_logo_url` belong to an authenticated account. A verified user with a current owner membership in an Agency/Agency Plus organization may edit only their own configuration. Other members cannot edit the owner's brand. The owner account configuration is reused across its eligible workspaces; entitlement is still checked independently for each workspace at send time.

The internal resolver checks the organization's current server plan, owner user and owner membership. Agency/Agency Plus with a saved logo use the account brand; missing logos, missing owner memberships and lower tiers use the current platform brand. Downgrades retain saved settings but deactivate their use. Clearing an account logo restores the complete platform brand. Account verification/password reset mail always uses the platform brand, even if an organization context is accidentally supplied.

`platform_branding` has a database-enforced singleton ID of 1. Without a configured row/logo, emails display the SitePulse brand name. Administrators may set both the name and logo. Logo images may be blocked by a recipient's mail client; the brand name remains visible independently.

## API and authority

- `GET /api/v1/users/me/email-branding`: authenticated user's saved brand, platform fallback and server-calculated `canCustomize`.
- `PATCH /api/v1/users/me/email-branding`: verified eligible owner, trusted Origin; strict `{ name, logoUrl }`, where `logoUrl: null` clears the logo. No account, plan or organization identity is accepted.
- `GET /api/v1/admin/branding` and `PATCH /api/v1/admin/branding`: verified Better Auth session on the validated `PLATFORM_ADMIN_USER_IDS` allowlist. PATCH uses the same strict body and trusted Origin.

The owner-authorized platform administration exception is extended narrowly from entitlement administration to global email branding. It grants no additional access to tenant sites, credentials, recipients or private account branding. Changes write `platform.email_branding.updated` or `account.email_branding.updated` audit records with actor/request IDs and no logo URL or request-body logging. Tenant notification routes retain their membership and management checks before preparing internal mail context.

## Rendering and image hosting

HTML uses a shared table layout, inline styles, system sans-serif fonts, white panels, blue actions and textual status. Every variable is HTML-escaped. Original plain text accompanies HTML in development outboxes and Resend requests. No change to delivery idempotency or error redaction. Authentication links retain their token fragments and require confirmation on the linked page.

Logo addresses must be bounded HTTPS URLs without credentials, custom ports, fragments, IP literals or local-only host suffixes. These syntactic checks do not resolve DNS or certify an image. The API and worker never fetch, proxy, inspect or cache the supplied image; the administrator/owner must use a trusted public image host. This explicit image exception is confined to email branding and its preview, and must not be reused for server URL fetching. Third-party hosting receives image requests from previews/mail clients and may observe recipient network metadata. Preview requests omit referrers; no URL should contain secrets. PNG/JPEG at 360 × 128 is recommended for broad email client compatibility.

White labeling affects display branding, not the `AUTH_MAIL_FROM` address or provider domain. Per-account sender domains and image uploads are outside this milestone.

## Rollout

Back up production before applying new immutable migration `0016_rainy_frog_thor.sql`; migrate before deploying API/worker/web. Production migration and deployment require explicit authorization. Use a dedicated disposable `_test` database for integration tests. Set the platform logo after deployment, then configure an Agency owner and send a notification test. Verify lower-tier fallback, downgrade, reset/verification mail and image-blocked readability.
