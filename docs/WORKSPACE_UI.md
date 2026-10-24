# Workspace interface

The workspace navigation milestone uses existing API endpoints and introduces no schema changes. The fixed desktop sidebar becomes a wrapping navigation bar on small screens. All main destinations stay available on detail pages.

| Destination                       | Purpose                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `/app`                            | Connector statistics, six sites and five recent incidents                           |
| `/app/sites`                      | Search sites by name/hostname and filter by workspace; direct section links         |
| `/app/sites/new`                  | Select an authorized workspace, create a site and proceed to connection             |
| `/app/incidents`                  | Filter recent incidents by status/workspace and acknowledge eligible open incidents |
| `/app/organizations`              | Organization cards and organization creation                                        |
| `/app/sites/<id>?view=monitoring` | External HTTP/SSL state, checks and incident history                                |
| `/app/sites/<id>?view=inventory`  | Minimized WordPress inventory                                                       |
| `/app/sites/<id>?view=connection` | Heartbeat, pairing, credential rotation and disconnection                           |

Server rendering forwards the session cookie to the internal API with `no-store`. Request-local React memoization deduplicates shared session/organization reads. Aggregate loading starts with the user's membership list and batches four organizations at a time. Each site/incident endpoint independently enforces membership. A failed request shows an error rather than misleading partial totals. API limits remain 1,000 sites and 100 recent incidents per organization; global pagination and automatic refresh are deferred. Connector activity must never be presented as external HTTP availability.

Verification checklist:

- Main navigation remains reachable on overview, site detail and organization detail at desktop and mobile sizes.
- Search and workspace filtering combine correctly; no matches and no sites have distinct messages.
- Each site row links directly to all three sections, with one selected tab.
- Creation requires verified email and owner/admin membership; member and unverified views do not show acknowledgement controls.
- Server authorization rejects forged organization/site IDs independently of the UI; existing integration coverage remains required.
- Disconnect/rotation requires explicit confirmation and revokes credentials using the existing API.
- Refresh updates server data; loading and failure states are visible without fabricated statistics.

## Local verification — 2026-10-24

`pnpm check` passed with 96 unit tests, including 12 navigation, directory, membership-aware action and creation tests. `pnpm test:integration` passed 62 tests against a newly created disposable PostgreSQL container. `pnpm build`, `pnpm compose:check`, and `pnpm db:check` passed.

Actual React components rendered with synthetic data and production CSS were inspected in headless Edge at 1440px and 390px widths for overview, site directory and empty states. All six views had no document overflow; mobile rows expose quick actions as cards. This verifies rendering, not a hydrated login/create/acknowledge browser flow. Full authenticated browser acceptance and staging deployment remain pending. No production data or credentials were used.
