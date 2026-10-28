'use client';
import { useEffect, useMemo, useState } from 'react';
import type {
  SoftwareCommand,
  SoftwareDirectory,
} from '@sitepulse/api-contracts';
import { api } from '../lib/api';
import { Icon } from './icon';

const actions: SoftwareCommand['action'][] = [
  'install',
  'activate',
  'deactivate',
  'update',
  'uninstall',
];
function formatTimestamp(value: string | null) {
  if (!value) return 'Not received';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not received' : date.toLocaleString();
}
type Preview = {
  batchId: string;
  impact: { siteId: string; name: string }[];
  command: SoftwareCommand;
  warning: string;
};
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
}: {
  organizationId: string;
  initial: SoftwareDirectory;
  initialSite?: string;
}) {
  const [data, setData] = useState(initial);
  const [siteIds, setSiteIds] = useState<string[]>(
    initial.sites.some((site) => site.id === initialSite) ? [initialSite!] : [],
  );
  const [kind, setKind] = useState<SoftwareCommand['kind']>('plugin');
  const [action, setAction] = useState<SoftwareCommand['action']>('install');
  const [slug, setSlug] = useState('');
  const [replacement, setReplacement] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const base = `/organizations/${organizationId}/software`;
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
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      setPending(false);
    }
  }
  function changed() {
    setPreview(null);
    setMessage('');
  }
  const selected = data.sites.filter((site) => siteIds.includes(site.id));
  const components = useMemo(() => {
    const map = new Map<
      string,
      {
        slug: string;
        name: string;
        official: boolean;
        sites: {
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
  return (
    <div className="software-manager">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!data.canManage && (
        <p className="notice-warning">
          Verified workspace owners and administrators can manage software. Your
          access is read-only.
        </p>
      )}
      <section className="card">
        <div className="page-heading">
          <h2>
            <Icon name="globe" /> Select sites{' '}
            <span className="muted">{selected.length} / 20</span>
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
          Install Connector 0.3.1, then enable remote management in WordPress →
          Settings → SitePulse. Commands are pulled every minute; your server
          Cron interval affects delivery. Sync inventory requests a fresh
          read-only collection, even with remote management disabled. Reload
          results only reads saved data. No inventory yet does not mean your
          site is down.
        </p>
        <div className="software-site-grid">
          {data.sites.map((site) => (
            <article className="software-site-card" key={site.id}>
              <label
                className={`software-site ${siteIds.includes(site.id) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={siteIds.includes(site.id)}
                  disabled={
                    pending ||
                    (!siteIds.includes(site.id) && siteIds.length >= 20)
                  }
                  onChange={(event) => {
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
                    Last inventory received: {formatTimestamp(site.inventoryAt)}
                  </small>
                  <small>
                    Management poll:{' '}
                    {site.polledAt && new Date(site.polledAt).getTime() > 0
                      ? formatTimestamp(site.polledAt)
                      : 'Not received'}
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
                    Requested: {formatTimestamp(site.inventorySync.requestedAt)}
                  </small>
                )}
                {site.inventorySync.attemptedAt && (
                  <small>
                    Last attempt:{' '}
                    {formatTimestamp(site.inventorySync.attemptedAt)}
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
                      await api(`${base}/inventory-sync`, { siteId: site.id });
                      setMessage(
                        `Inventory sync requested for ${site.name}. Connector 0.3.1+ will collect it on its next poll. Allow up to 15 minutes; check WordPress Cron if it times out.`,
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
                  setSlug('');
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
              <article className="software-component" key={item.slug}>
                <div className="software-component-title">
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
                  {item.sites.map((site, index) => (
                    <li key={`${site.name}-${index}`}>
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
                          item.slug === 'sitepulse-connector'
                        }
                        key={value}
                        onClick={() => {
                          setSlug(item.slug);
                          setAction(value);
                          changed();
                          document.getElementById('software-command')?.focus();
                        }}
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
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="card software-command">
          <h2 id="software-command" tabIndex={-1}>
            <Icon name="workspace" /> Apply to {selected.length} site(s)
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await api<Preview>(`${base}/preview`, {
                  siteIds,
                  command: {
                    kind,
                    action,
                    slug: slug.trim(),
                    ...(kind === 'theme' && action === 'deactivate'
                      ? { replacement: replacement.trim() }
                      : {}),
                  },
                  reason,
                });
                setPreview(result);
              });
            }}
          >
            <fieldset disabled={pending || !data.canManage}>
              <label htmlFor="software-slug">
                {kind === 'plugin' ? 'Plugin' : 'Theme'} slug (WordPress.org)
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
              <label htmlFor="software-action">Action</label>
              <select
                id="software-action"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as SoftwareCommand['action']);
                  changed();
                }}
              >
                {actions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {kind === 'theme' && action === 'deactivate' && (
                <>
                  <label htmlFor="replacement-theme">
                    Switch to installed theme slug
                  </label>
                  <input
                    required
                    id="replacement-theme"
                    value={replacement}
                    onChange={(event) => {
                      setReplacement(event.target.value);
                      changed();
                    }}
                  />
                  <p className="muted">
                    WordPress requires an active theme. Deactivation switches to
                    this theme.
                  </p>
                </>
              )}
              <label htmlFor="software-reason">Change reason</label>
              <input
                required
                minLength={3}
                maxLength={300}
                id="software-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  changed();
                }}
              />
              <p className="notice-warning">
                Back up each WordPress site first. Updates and activation can
                break a site; uninstall may permanently delete plugin data.
                There is no automatic rollback.
              </p>
              <button
                disabled={
                  !selected.length || selected.some((site) => !site.enabled)
                }
              >
                <Icon name="info" /> Preview impact
              </button>
            </fieldset>
          </form>
          {preview && (
            <div
              className="software-preview"
              role="region"
              aria-label="Confirm software operation"
            >
              <h3>
                Confirm {preview.command.action}: {preview.command.slug}
              </h3>
              <ul>
                {preview.impact.map((site) => (
                  <li key={site.siteId}>{site.name}</li>
                ))}
              </ul>
              <p>{preview.warning}</p>
              <p>
                Preview expires after 10 minutes. Sites execute independently.
              </p>
              <div className="software-actions">
                <button
                  disabled={pending || !data.canManage}
                  onClick={() =>
                    void run(async () => {
                      await api(`${base}/${preview.batchId}/confirm`, {});
                      setPreview(null);
                      setMessage(
                        'Queued. Each site will pull its command on its next management poll.',
                      );
                      await refresh();
                    })
                  }
                >
                  Confirm and queue
                </button>
                <button
                  className="secondary"
                  disabled={pending}
                  onClick={() => {
                    setPreview(null);
                  }}
                >
                  Back to editing
                </button>
              </div>
            </div>
          )}
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
        {!data.operations.length && <p>No operations yet.</p>}
        <div className="software-results">
          {data.operations.map((op) => (
            <article key={op.id}>
              <div>
                <strong>{op.siteName}</strong>
                <p>
                  {op.action} {op.kind} · {op.slug}
                </p>
                <small>
                  {op.reason} · {new Date(op.createdAt).toISOString()}
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
