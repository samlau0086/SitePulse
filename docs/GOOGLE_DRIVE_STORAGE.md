# Personal Google Drive attachment storage

New plugin/theme ZIPs can use SitePulse PostgreSQL or the uploading user's Google Drive. Existing attachments stay in PostgreSQL. Identical bytes reuse the existing workspace entry regardless of the selected storage; this does not migrate an attachment. Both backends share the 8 MiB upload, 100-package and 64 MiB workspace limits.

## Setup and deployment

1. Enable Google Drive API in a Google Cloud project, configure its OAuth consent audience/test users, and create an OAuth web application. Register exactly `APP_ORIGIN/api/v1/auth/callback/google` using the actual origin, including local development port where applicable.
2. Configure both `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`, or leave both empty to disable Drive. GitHub deployment reads them as environment secrets and passes them only to the API. Restart after configuration changes.
3. Back up before applying migration `0017_bored_sunspot.sql` through the deployment workflow. Existing bytes are preserved with database storage as the default. Production migration/deployment requires explicit authorization.
4. Keep `BETTER_AUTH_SECRET` stable and backed up securely; Better Auth uses it to encrypt OAuth access/refresh tokens. Database backups contain encrypted credentials and references, not Drive ZIPs. Back up important Drive originals separately. Rolling back to an older API after Drive uploads requires a compatible API or explicit export/migration plan.
5. In Attachments, connect the Google account matching the verified SitePulse email, grant offline file access, then select My Google Drive when uploading. The status shows saved credentials, not live provider availability. Reconnect the same account after authorization/refresh failure.

## Authorization and lifecycle

Better Auth handles explicit account linking, state/PKCE and encrypted tokens. The app requests `drive.file` plus Google's identity scopes, offline access and consent. No Google signup or generic social-login/token HTTP endpoint is exposed. Linking grants no workspace membership. References bind the original SitePulse uploader and Google subject; connecting another Google account cannot read prior packages.

Uploads require current verified owner/admin membership before any Drive request and use the existing bounded ZIP scan first. Files are created in the user's Drive without a public sharing operation. Library reads return storage type, metadata and findings, never Drive IDs, credentials or bytes. Other workspace administrators can install through existing permissions while the original uploader remains a verified owner/admin; demotion or removal prevents installation.

Preview, confirmation, local opt-in, queue and short-lived site-bound lease remain unchanged. The API alone accesses fixed Google HTTPS endpoints, disables redirects and applies bounded streaming and 10-second request timeouts. Resumable upload session URLs must stay on the fixed Google upload endpoint. Downloaded size and SHA-256 must match the scanned upload. The Connector still downloads from its paired SitePulse origin and rechecks SHA-256. No Connector upgrade is needed for this storage option; uploaded packages already require Connector 0.4.0 and both local permissions.

Missing, modified or inaccessible files, revoked authorization or a missing original account cause download failure. No public URL fallback is used. Preview may succeed before unavailable bytes are discovered during download. Existing WordPress installations are unaffected.

Disconnect removes the user's linked Google account credentials from SitePulse; it does not revoke the entire app grant at Google. Users can also revoke access in Google account settings. Disconnect and library deletion keep originals. Live operation references still prevent library deletion. Reconnecting the same account restores access if the original file remains unchanged.

Failed uploads and database rollbacks attempt to delete newly created files. Process crashes or failed cleanup can leave orphans requiring manual Drive review. Bounded provider calls hold the workspace quota lock, so slow responses can delay concurrent uploads in that workspace.

## API and acceptance

- `GET /api/v1/me/google-drive`: authenticated user's `{enabled, connected}`.
- `POST /api/v1/me/google-drive/connect` with `{}`: verified session and trusted Origin; authorization URL/state cookie.
- `DELETE /api/v1/me/google-drive`: verified fresh session and trusted Origin; disconnect own account only.
- `GET /api/v1/auth/callback/google`: narrow Better Auth callback; final redirect strips OAuth codes/state/provider errors. Reverse proxies must not log callback query strings.
- Existing attachment upload accepts `?storage=database|google_drive` (default database). Metadata gains `storage`; Connector package delivery is unchanged.

Automated tests use encrypted credential fixtures, mocked Google responses and dedicated disposable PostgreSQL. Coverage includes both plugin/theme leases, exact bytes, hash/size failures, missing files, disconnect/wrong-account/reconnect, authority changes, unauthorized uploads, deduplication, original retention and unsafe upload-session hosts. They do not validate real Google OAuth/token refresh or actual WordPress upgraders.

Before production enablement, verify real consent/callback/reconnect/refresh/revoke and both package types on disposable staging sites, including a near-8-MiB ZIP, file mutation/deletion and owner removal. Review desktop/mobile and keyboard interactions. This local implementation does not deploy or modify production data.
