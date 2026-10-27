# SitePulse contributor rules

Read docs/PRODUCT_SPECIFICATION.md before changing architecture. Work on one milestone at a time.

- Read `DESIGN.md` and `docs/UI_GUIDELINES.md` before creating or changing any UI. All future pages and components must follow this design and reuse the shared tokens in `apps/web/app/globals.css`.

- Use Next.js in apps/web, Fastify in apps/api, and Drizzle/PostgreSQL in packages/database.
- All organization data access must check the authenticated user's membership on the server. Never trust a client-supplied user, role, owner, or plan.
  Exception: `/api/v1/admin` permits only entitlement administration across organizations, with a verified Better Auth session and the server's validated `PLATFORM_ADMIN_USER_IDS` allowlist. This never bypasses membership on tenant APIs.
- Use Better Auth for authentication. Never implement custom session or password protocols. Keep cookies HttpOnly, SameSite, and Secure in production; require a trusted Origin on mutations.
- Validate environment variables through packages/config and requests through packages/api-contracts.
- Never commit secrets, .env files, customer data, database volumes, or session tokens. Never log credentials, cookies, or request bodies.
- Keep database migrations immutable once applied. Back up production databases before migrations; production changes require explicit authorization.
- Keep PostgreSQL private in production. Only the web container may publish an application port, bound to loopback by default.
- Do not add WordPress monitoring, billing, notifications, or remote WordPress execution to the foundation milestone.
- Future monitoring requires SSRF defenses before any URL-fetching feature is enabled.
- Update README.md, CHANGELOG.md, and relevant docs with behavior changes.
- Run `pnpm check`, `pnpm test:integration`, `pnpm build`, and Compose validation. Report failures and checks that could not run without claiming success.
- Do not weaken isolation or authentication to make a test pass. Integration tests must use a dedicated disposable PostgreSQL database.
