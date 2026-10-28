'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  SoftwareCommand,
  SoftwareDirectory,
  SoftwareAttachment,
} from '@sitepulse/api-contracts';
import { api } from '../lib/api';
import { Icon } from './icon';
import { SoftwareOperationDialog } from './software-operation-dialog';
import { Timestamp } from './user-preferences';
import {
  actionable,
  executeSoftwarePlans,
  planOperations,
  type OperationPlan,
  type SoftwarePreviewResult,
} from '../lib/software-operations';

const actions: SoftwareCommand['action'][] = [
  'install',
  'activate',
  'deactivate',
  'update',
  'uninstall',
];
export function SoftwareArtwork({
  slug,
  official,
  kind,
}: {
  slug: string;
  official: boolean;
  kind: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="software-artwork">
      {official &&
      kind === 'plugin' &&
      !failed &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? (
        // Fixed official host only. Avoid proxying arbitrary URLs through the SaaS server.
        <img
          src={`https://ps.w.org/${slug}/assets/icon-128x128.png`}
          width="56"
          height="56"
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name={kind === 'plugin' ? 'connection' : 'overview'} />
      )}
    </span>
  );
}
export function SoftwareManager({
  organizationId,
  initial,
  initialSite,
  siteScoped = false,
  attachments = [],
  initialAttachment,
}: {
  organizationId: string;
  initial: SoftwareDirectory;
  initialSite?: string;
  siteScoped?: boolean;
  attachments?: SoftwareAttachment[];
  initialAttachment?: string;
}) {
  const [data, setData] = useState(initial);
  const [siteIds, setSiteIds] = useState<string[]>(
    initial.sites.some((site) => site.id === initialSite) ? [initialSite!] : [],
  );
  const [attachmentId, setAttachmentId] = useState(initialAttachment ?? '');
  const chosenAttachment = attachments.find((item) => item.id === attachmentId);
  const [kind, setKind] = useState<SoftwareCommand['kind']>(
    chosenAttachment?.kind ?? 'plugin',
  );
  const [action, setAction] = useState<SoftwareCommand['action']>('install');
  const [slug, setSlug] = useState('');
  const [search, setSearch] = useState('');
  const [checkedSlugs, setCheckedSlugs] = useState<string[]>([]);
  const [dialogPlans, setDialogPlans] = useState<OperationPlan[] | null>(null);
  const execution = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const base = `/organizations/${organizationId}/software`;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (execution.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      execution.current?.abort();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const interval = setInterval(() => {
      api<SoftwareDirectory>(base, undefined, 'GET')
        .then((next) => {
          if (active) setData(next);
        })
        .catch(() => {
          if (active)
            setError(
              'Unable to reload results. Use Reload results to try again.',
            );
        });
    }, 10_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [base]);
  async function refresh() {
    setData(await api<SoftwareDirectory>(base, undefined, 'GET'));
  }
  async function run(work: () => Promise<void>) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      setPending(false);
    }
  }
  function changed() {
    setMessage('');
  }
  function selectComponent(slug: string, checked: boolean) {
    setCheckedSlugs((current) =>
      checked
        ? [...new Set([...current, slug])].slice(0, 20)
        : current.filter((value) => value !== slug),
    );
    if (checked && action === 'install') setAction('activate');
    changed();
  }
  function openPlans(plans: OperationPlan[]) {
    setError('');
    if (!plans.length) {
      setError(
        'No eligible targets for this action. Active components must be deactivated before uninstalling; updates require an available WordPress.org update.',
      );
      return;
    }
    setDialogPlans(plans);
  }
  function execute(
    plans: OperationPlan[],
    previews: SoftwarePreviewResult[],
    changeReason: string,
  ) {
    if (execution.current) return;
    const controller = new AbortController();
    execution.current = controller;
    setDialogPlans(null);
    void run(async () => {
      try {
        await executeSoftwarePlans({
          base,
          plans,
          previews,
          reason: changeReason,
          signal: controller.signal,
          request: api,
          onDirectory: setData,
          onProgress: setMessage,
        });
        setMessage(
          'Approved items submitted. Queued is not completed: check each site in Recent operations.',
        );
        await refresh();
      } catch (err) {
        throw new Error(
          `${err instanceof Error ? err.message : 'Operation failed.'} Remaining submissions stopped. A submitted command may still execute; inspect Recent operations before retrying.`,
          { cause: err },
        );
      } finally {
        execution.current = null;
      }
    });
  }
  const selected = data.sites.filter((site) => siteIds.includes(site.id));
  const visibleOperations = data.operations.filter(
    (op) => !siteScoped || op.siteId === initialSite,
  );
  const bulkAction = checkedSlugs.length
    ? action === 'install'
      ? 'activate'
      : action
    : 'install';
  const components = useMemo(() => {
    const map = new Map<
      string,
      {
        slug: string;
        name: string;
        official: boolean;
        sites: {
          id: string;
          name: string;
          version: string;
          active: boolean;
          updateVersion: string | null;
        }[];
      }
    >();
    for (const site of data.sites.filter((row) => siteIds.includes(row.id))) {
      for (const item of kind === 'plugin' ? site.plugins : site.themes) {
        const row = map.get(item.identifier) ?? {
          slug: item.identifier,
          name: item.name,
          official: false,
          sites: [],
        };
        row.official ||= item.source === 'wordpress.org';
        row.sites.push({
          id: site.id,
          name: site.name,
          version: item.version,
          active: item.active,
          updateVersion: item.updateVersion,
        });
        map.set(item.identifier, row);
      }
    }
    return [...map.values()]
      .filter((item) =>
        `${item.name} ${item.slug}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.sites, siteIds, kind, search]);
  const selectable = components.filter(
    (item) =>
      item.slug !== 'sitepulse-connector' &&
      selected.some(
        (site) =>
          site.enabled &&
          (kind === 'plugin' ? site.plugins : site.themes).some(
            (component) =>
              component.identifier === item.slug &&
              actions.some((value) => actionable(component, value)),
          ),
      ),
  );
  const visibleChecked = selectable.filter((item) =>
    checkedSlugs.includes(item.slug),
  );
  return (
    <div className="software-manager">
      {dialogPlans && (
        <SoftwareOperationDialog
          base={base}
          plans={dialogPlans}
          onClose={() => setDialogPlans(null)}
          onConfirm={execute}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending && execution.current && (
        <button
          className="secondary danger"
          onClick={() => execution.current?.abort()}
        >
          Stop remaining items (queued commands are not cancelled)
        </button>
      )}
      {!data.canManage && (
        <p className="notice-warning">
          Verified workspace owners and administrators can manage software. Your
          access is read-only.
        </p>
      )}
      <section className="card">
        <div className="page-heading">
          <h2>
            <Icon name="globe" /> {siteScoped ? 'Current site' : 'Select sites'}{' '}
            {!siteScoped && (
              <span className="muted">{selected.length} / 20</span>
            )}
          </h2>
          <button
            className="secondary"
            disabled={pending}
            onClick={() => void run(refresh)}
          >
            <Icon name="refresh" /> Reload results
          </button>
        </div>
        <p className="muted">
          Install Connector 0.4.0, then enable remote management in WordPress →
          Settings → SitePulse. Commands are pulled every minute; your server
          Cron interval affects delivery. Sync inventory requests a fresh
          read-only collection, even with remote management disabled. Reload
          results only reads saved data. No inventory yet does not mean your
          site is down.
        </p>
        <div className="software-site-grid">
          {data.sites
            .filter((site) => !siteScoped || site.id === initialSite)
            .map((site) => (
              <article className="software-site-card" key={site.id}>
                <label
                  className={`software-site ${siteIds.includes(site.id) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={siteIds.includes(site.id)}
                    disabled={
                      pending ||
                      siteScoped ||
                      (!siteIds.includes(site.id) && siteIds.length >= 20)
                    }
                    onChange={(event) => {
                      setCheckedSlugs([]);
                      setSiteIds(
                        event.target.checked
                          ? [...siteIds, site.id]
                          : siteIds.filter((id) => id !== site.id),
                      );
                      changed();
                    }}
                  />
                  <span>
                    <strong>{site.name}</strong>
                    <small>{new URL(site.canonicalUrl).hostname}</small>
                    <small>
                      Last inventory received:{' '}
                      <Timestamp value={site.inventoryAt} />
                    </small>
                    <small>
                      Management poll:{' '}
                      {site.polledAt &&
                      new Date(site.polledAt).getTime() > 0 ? (
                        <Timestamp value={site.polledAt} />
                      ) : (
                        'Not received'
                      )}
                    </small>
                    <span
                      className={`status-badge ${site.enabled ? 'status-healthy' : 'status-warning'}`}
                    >
                      <Icon name={site.enabled ? 'check' : 'clock'} />
                      {site.enabled
                        ? 'Management ready'
                        : 'Enable / refresh Connector'}
                    </span>
                  </span>
                </label>
                <div className="software-sync">
                  <span
                    className={`status-badge ${site.inventorySync.status === 'succeeded' ? 'status-healthy' : site.inventorySync.status === 'failed' ? 'status-critical' : 'status-warning'}`}
                  >
                    <Icon
                      name={
                        site.inventorySync.status === 'succeeded'
                          ? 'check'
                          : 'clock'
                      }
                    />
                    {site.inventorySync.status === 'not_received' &&
                      'Not yet synced'}
                    {site.inventorySync.status === 'pending' &&
                      'Sync queued · awaiting Connector'}
                    {site.inventorySync.status === 'timed_out' &&
                      'Sync timed out · check WordPress Cron'}
                    {site.inventorySync.status === 'failed' &&
                      'Inventory sync failed'}
                    {site.inventorySync.status === 'succeeded' &&
                      'Inventory received'}
                  </span>
                  {site.inventorySync.status === 'failed' && (
                    <small role="alert">
                      {site.inventorySync.error === 'collection'
                        ? 'WordPress could not collect inventory.'
                        : site.inventorySync.error === 'network'
                          ? 'Connector could not reach SitePulse.'
                          : 'SitePulse rejected the inventory. Check the Connector and its reported component metadata.'}{' '}
                      Last successful inventory is retained.
                    </small>
                  )}
                  {site.inventorySync.requestedAt && (
                    <small>
                      Requested:{' '}
                      <Timestamp value={site.inventorySync.requestedAt} />
                    </small>
                  )}
                  {site.inventorySync.attemptedAt && (
                    <small>
                      Last attempt:{' '}
                      <Timestamp value={site.inventorySync.attemptedAt} />
                    </small>
                  )}
                  <button
                    className="secondary"
                    disabled={
                      pending ||
                      !data.canManage ||
                      !site.canSync ||
                      site.inventorySync.status === 'pending'
                    }
                    aria-label={`Sync inventory for ${site.name}`}
                    onClick={() =>
                      void run(async () => {
                        await api(`${base}/inventory-sync`, {
                          siteId: site.id,
                        });
                        setMessage(
                          `Inventory sync requested for ${site.name}. Connector 0.4.0+ also refreshes the bounded local code scan. Collection runs on its next poll; allow up to 15 minutes and check WordPress Cron if it times out.`,
                        );
                        await refresh();
                      })
                    }
                  >
                    <Icon name="refresh" /> Sync inventory
                  </button>
                </div>
              </article>
            ))}
        </div>
        {data.sites.length === 0 && <p>Add and pair a WordPress site first.</p>}
      </section>
      <div className="software-layout">
        <section className="card">
          <div className="site-tabs" aria-label="Component type">
            {(['plugin', 'theme'] as const).map((value) => (
              <button
                className="secondary"
                aria-pressed={kind === value}
                key={value}
                disabled={pending}
                onClick={() => {
                  setKind(value);
                  setAttachmentId('');
                  setSlug('');
                  setCheckedSlugs([]);
                  setSearch('');
                  changed();
                }}
              >
                <Icon name={value === 'plugin' ? 'connection' : 'overview'} />
                {value === 'plugin' ? 'Plugins' : 'Themes'}
              </button>
            ))}
          </div>
          <label htmlFor="software-search">Search installed {kind}s</label>
          <input
            id="software-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="software-bulk-toolbar">
            <label className="software-select-control">
              <input
                type="checkbox"
                aria-label="Select all visible eligible components"
                checked={
                  selectable.length > 0 &&
                  visibleChecked.length === selectable.length
                }
                ref={(element) => {
                  if (element)
                    element.indeterminate =
                      visibleChecked.length > 0 &&
                      visibleChecked.length < selectable.length;
                }}
                disabled={pending || !data.canManage || !selectable.length}
                onChange={(event) => {
                  const visible = selectable.map((item) => item.slug);
                  setCheckedSlugs((current) =>
                    event.target.checked
                      ? [...new Set([...current, ...visible])].slice(0, 20)
                      : current.filter((slug) => !visible.includes(slug)),
                  );
                  if (action === 'install') setAction('activate');
                }}
              />
              Select visible
            </label>
            <span>
              {checkedSlugs.length} / 20 selected
              {checkedSlugs.some(
                (slug) => !components.some((item) => item.slug === slug),
              )
                ? ' (includes hidden search results)'
                : ''}
            </span>
            <button
              className="secondary"
              disabled={pending || !checkedSlugs.length}
              onClick={() => {
                setCheckedSlugs([]);
                changed();
              }}
            >
              Clear selection
            </button>
          </div>
          <p className="muted">
            Action buttons open a direct confirmation for that component. Check
            items or use Add to bulk → to prepare a shared action in the
            separate bulk panel. Only eligible installed targets are included;
            review exact site names before confirming.
          </p>
          {!selected.length && (
            <p>Select one or more sites to view installed software.</p>
          )}
          {selected.length > 0 && !components.length && (
            <p>
              {selected.some((site) => !site.inventoryAt)
                ? 'Some selected sites have not sent inventory yet. Use Sync inventory above; this is separate from heartbeat health.'
                : 'No matching components in saved inventory. Use the action panel to install a WordPress.org slug, or sync inventory again.'}
            </p>
          )}
          <div className="software-catalog">
            {components.map((item) => (
              <article
                className={`software-component ${checkedSlugs.includes(item.slug) ? 'selected' : ''}`}
                key={item.slug}
              >
                <div className="software-component-title">
                  <label className="software-select-control">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.name} for bulk operation`}
                      checked={checkedSlugs.includes(item.slug)}
                      disabled={
                        pending ||
                        !data.canManage ||
                        !selectable.includes(item) ||
                        (!checkedSlugs.includes(item.slug) &&
                          checkedSlugs.length >= 20)
                      }
                      onChange={(event) =>
                        selectComponent(item.slug, event.target.checked)
                      }
                    />
                  </label>
                  <SoftwareArtwork
                    key={`${kind}-${item.slug}`}
                    slug={item.slug}
                    official={item.official}
                    kind={kind}
                  />
                  <div>
                    <h3>{item.name}</h3>
                    <small className="muted">
                      {item.slug} · {item.sites.length} selected site(s)
                    </small>
                  </div>
                </div>
                <ul className="software-versions">
                  {item.sites.map((site) => (
                    <li key={site.id}>
                      <span>{site.name}</span>
                      <span>
                        v{site.version}{' '}
                        <span className="status-badge">
                          <Icon name={site.active ? 'check' : 'info'} />
                          {site.active ? 'Active' : 'Inactive'}
                        </span>
                        {site.updateVersion && (
                          <span className="status-badge warning">
                            <Icon name="up" />
                            {site.updateVersion}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="software-actions">
                  {actions
                    .filter((value) => value !== 'install')
                    .map((value) => (
                      <button
                        className={`secondary ${value === 'uninstall' ? 'danger' : ''}`}
                        disabled={
                          pending ||
                          !data.canManage ||
                          !planOperations(selected, kind, value, [item.slug])
                            .length
                        }
                        key={value}
                        aria-label={`${value} ${item.name}`}
                        onClick={() =>
                          openPlans(
                            planOperations(selected, kind, value, [item.slug]),
                          )
                        }
                      >
                        <Icon
                          name={
                            value === 'update'
                              ? 'up'
                              : value === 'activate'
                                ? 'check'
                                : value === 'uninstall'
                                  ? 'alert'
                                  : 'connection'
                          }
                        />
                        {value}
                      </button>
                    ))}
                  <button
                    className="secondary"
                    disabled={
                      pending ||
                      !data.canManage ||
                      !selectable.includes(item) ||
                      (!checkedSlugs.includes(item.slug) &&
                        checkedSlugs.length >= 20)
                    }
                    onClick={() => {
                      selectComponent(item.slug, true);
                      document.getElementById('software-command')?.focus();
                    }}
                    aria-label={`Add ${item.name} to bulk operation`}
                  >
                    <Icon name="arrow" /> Add to bulk
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="card software-command">
          <h2 id="software-command" tabIndex={-1}>
            <Icon name="workspace" /> Bulk operation
          </h2>
          <p>
            {checkedSlugs.length
              ? `${checkedSlugs.length} selected ${kind}(s) across ${selected.length} site(s)`
              : `Install by slug or select installed ${kind}s using checkboxes.`}
          </p>
          {checkedSlugs.length > 0 && (
            <ul className="software-bulk-items">
              {checkedSlugs.map((value) => (
                <li key={value}>
                  <span>{value}</span>
                  <button
                    className="secondary"
                    type="button"
                    disabled={pending}
                    aria-label={`Remove ${value} from bulk operation`}
                    onClick={() => selectComponent(value, false)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {checkedSlugs.length > 0 && (
            <p className="muted">
              {planOperations(selected, kind, bulkAction, checkedSlugs).length}{' '}
              eligible component(s) for {bulkAction}. Active components are
              excluded from uninstall; update requires an available
              WordPress.org update; already-active/inactive targets are excluded
              from activate/deactivate. The confirmation lists exact targets.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const plans = planOperations(
                selected,
                kind,
                bulkAction,
                checkedSlugs.length
                  ? checkedSlugs
                  : [chosenAttachment?.slug ?? slug.trim()],
              );
              openPlans(
                plans.map((plan) =>
                  chosenAttachment && !checkedSlugs.length
                    ? {
                        ...plan,
                        command: {
                          ...plan.command,
                          attachmentId: chosenAttachment.id,
                        },
                        attachment: chosenAttachment,
                      }
                    : plan,
                ),
              );
            }}
          >
            <fieldset disabled={pending || !data.canManage}>
              {!checkedSlugs.length && (
                <>
                  <label htmlFor="software-source">Installation source</label>
                  <select
                    id="software-source"
                    value={attachmentId}
                    onChange={(event) => {
                      setAttachmentId(event.target.value);
                      changed();
                    }}
                  >
                    <option value="">WordPress.org</option>
                    {attachments
                      .filter(
                        (item) =>
                          item.kind === kind && item.scan.status === 'complete',
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} v{item.version} · uploaded package
                        </option>
                      ))}
                  </select>
                  <a href={`/app/attachments?workspace=${organizationId}`}>
                    Upload or inspect packages →
                  </a>
                  {chosenAttachment && (
                    <p className="notice-warning">
                      Uploaded {chosenAttachment.name} v
                      {chosenAttachment.version}. Each target needs Connector
                      0.4.0+ and separate uploaded-package permission. Static
                      scanning is not a safety guarantee.
                    </p>
                  )}
                  {!chosenAttachment && (
                    <>
                      <label htmlFor="software-slug">
                        {kind === 'plugin' ? 'Plugin' : 'Theme'} slug
                        (WordPress.org)
                      </label>
                      <input
                        id="software-slug"
                        required
                        maxLength={100}
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        placeholder={
                          kind === 'plugin'
                            ? 'e.g. wordpress-seo'
                            : 'e.g. twentytwentyfive'
                        }
                        value={slug}
                        onChange={(event) => {
                          setSlug(event.target.value);
                          changed();
                        }}
                      />
                    </>
                  )}
                </>
              )}
              <label htmlFor="software-action">Action</label>
              <select
                id="software-action"
                value={bulkAction}
                onChange={(event) => {
                  setAction(event.target.value as SoftwareCommand['action']);
                  changed();
                }}
              >
                {actions
                  .filter((value) =>
                    checkedSlugs.length
                      ? value !== 'install'
                      : value === 'install',
                  )
                  .map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
              </select>
              <p className="notice-warning">
                Back up each WordPress site first. Updates and activation can
                break a site; uninstall may permanently delete plugin data.
                There is no automatic rollback.
              </p>
              <button disabled={!selected.some((site) => site.enabled)}>
                <Icon name="info" /> Review{' '}
                {checkedSlugs.length ? 'selected items' : 'installation'}
              </button>
            </fieldset>
          </form>
        </section>
      </div>
      <section className="card">
        <h2>
          <Icon name="clock" /> Recent operations
        </h2>
        <p className="muted">
          Results refresh every 10 seconds. Queued commands expire after one
          hour. Unknown means execution may have happened; inspect WordPress
          before resolving or trying another operation.
        </p>
        {!visibleOperations.length && <p>No operations yet.</p>}
        <div className="software-results">
          {visibleOperations.map((op) => (
            <article key={op.id}>
              <div>
                <strong>{op.siteName}</strong>
                <p>
                  {op.action} {op.kind} · {op.slug}
                </p>
                <small>
                  {op.reason} · <Timestamp value={op.createdAt} />
                </small>
              </div>
              <div>
                <span
                  className={`status-badge ${op.status === 'succeeded' ? 'success' : ['failed', 'unknown'].includes(op.status) ? 'warning' : ''}`}
                >
                  <Icon
                    name={
                      op.status === 'succeeded'
                        ? 'check'
                        : ['failed', 'unknown'].includes(op.status)
                          ? 'alert'
                          : 'clock'
                    }
                  />
                  {op.status}
                </span>
                {op.resultCode && <small>{op.resultCode}</small>}
                {data.canManage &&
                  (['preview', 'queued'].includes(op.status) ||
                    op.status === 'unknown') && (
                    <button
                      className="secondary"
                      disabled={pending}
                      onClick={() => {
                        const resolve = op.status === 'unknown';
                        if (
                          !window.confirm(
                            resolve
                              ? 'Have you checked this batch in WordPress? This releases unknown operations in the batch. It does not undo any changes.'
                              : 'Cancel all unstarted operations in this batch?',
                          )
                        )
                          return;
                        void run(async () => {
                          await api(
                            `${base}/${op.batchId}/${resolve ? 'resolve' : 'cancel'}`,
                            {},
                          );
                          await refresh();
                        });
                      }}
                    >
                      {op.status === 'unknown'
                        ? 'Reviewed in WordPress'
                        : 'Cancel batch'}
                    </button>
                  )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
