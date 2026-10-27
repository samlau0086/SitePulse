# SitePulse UI implementation guidelines

Read [DESIGN.md](../DESIGN.md) before creating or modifying UI. It is the visual source of truth; apply its visual vocabulary to SitePulse rather than copying OpenCode branding, commands or functionality.

## Shared primitives

- Reuse CSS variables in `apps/web/app/globals.css` for colors, fonts, control radius and section spacing. Extend existing primitives before adding a new variant. Avoid route-specific palettes.
- Use the shared monospace stack for every text role, including native form controls. Berkeley Mono is commercial and is not distributed with this repository. It is used only when available locally; IBM Plex Mono and system monospace fonts are fallbacks. Do not silently download or bundle an unlicensed font.
- Use the warm canvas (`#fdfcfc`), ink (`#201d1d`), soft neutral surfaces and 1px hairline borders. Containers stay square; interactive elements use 4px corners. No shadows or gradients.
- Use 38px/700/1.5 for public hero headings, 16px body and section headings, and 14px metadata. Reduce hero headings to 28px on mobile. Keep tracking at zero.
- Public sections use 96px spacing, reduced to 64px on tablets and 48px on mobile. Operational screens retain denser layouts for tables and controls, with 16px container padding and 48–64px section separation.
- Use ASCII markers such as `[+]`, `[!]`, `[x]` and `[-]`, not decorative icon sets. Keep visible status words and accessible names; decorative markers should be hidden from assistive technology where rendered as markup.
- Keep primary actions monochrome and secondary actions outlined. Semantic colors are reserved for operational/error signals, accompanied by text or markers. Never use color alone to communicate state.
- Dark content surfaces are reserved for one illustrative terminal preview on a public page. Product cards and navigation remain light.

## Existing layouts

Reuse `.page-heading`, `.metric-grid`, `.directory`, `.directory-toolbar`, `.status-badge`, `.site-tabs`, `.creation-form`, `.card`, `.secondary` and `.auth`. Keep mobile directories readable with labeled stacked rows, keyboard focus visible, and inputs at 16px to avoid mobile browser zoom. Controls should be at least 40px high, with comfortable link padding. Avoid horizontal page overflow; wide data tables and tabs may scroll inside their own container.

Homepage illustrations must be labeled as examples and must not invent live customer data or operational health. Authentication, server membership checks, API contracts, mutations and destructive confirmations must retain their existing behavior during visual changes.

Reuse `PlanUsage` for workspace plan and site allowance displays. Show the effective allowance, used slots and a textual full/over-limit message. Disable site creation when the fetched allowance is full while retaining server quota checks and errors for concurrent changes. Existing sites remain accessible after a downgrade.

## Visibility and feedback

- Keep primary buttons ink-filled with bold labels and secondary actions visibly outlined. Controls have a 44px minimum height; use `--border-control` rather than decorative `--hairline` for input and action boundaries. Disabled buttons retain readable labels and dashed borders, including inside disabled fieldsets, without enabled hover/pressed styling.
- Keep product action links underlined; directory row actions also have outlined touch targets. Active sidebar items use a solid leading rule on a neutral fill, and selected site tabs use an ink underline and neutral fill. Keyboard focus uses the shared high-contrast outline.
- Use the shared `--success-*`, `--warning-*`, `--danger-*` and `--info-*` ink/surface pairs for operational signals. Status badges retain words and ASCII markers as well as color. Do not use the bright illustrative terminal colors for small text on light surfaces.
- Errors (`role="alert"`) and paragraph feedback (`role="status"`) get bordered, tinted panels with a stronger leading edge. Status feedback is informational, not automatically successful. Quota warnings use `.notice-warning`; verification banners use warning tokens. Keep inline result counts compact. Report failed connector actions as alerts, separately from informational pairing feedback. Destructive connector actions use `.secondary.danger` and retain confirmation dialogs.
- Verify text contrast of at least 4.5:1 and control/focus boundaries of at least 3:1 against adjacent light surfaces; keep these palette checks covered by unit tests.

## Verification workflow

Platform administration has a direct conditional sidebar link `/app/admin`, bounded search and an inline editor. Reuse `PlanUsage` for before/after impact. Require a reason, invalidate previews on edits, disable pending operations, announce errors/success and require a fresh preview after conflicts. Focus the editor heading when opening it. Page guards and hidden navigation are convenience only; the API independently checks platform authority. Use shared tokens and fieldset primitives.

Review public and authenticated routes at desktop and mobile widths, including empty states, filters, errors and focused controls. Run `pnpm check`, `pnpm test:integration` against the dedicated disposable database, `pnpm build` and `pnpm compose:check`. Report any unavailable checks explicitly. Update README.md, CHANGELOG.md and these guidelines when shared UI behavior changes.
