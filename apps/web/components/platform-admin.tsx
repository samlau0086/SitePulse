'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  AdminWorkspace,
  EntitlementPreview,
  OrganizationUsage,
} from '@sitepulse/api-contracts';
import { api } from '../lib/api';
import { PlanUsage } from './plan-usage';

type Results = { workspaces: AdminWorkspace[]; hasMore: boolean };
export function PlatformAdmin({ initial }: { initial: Results }) {
  const [results, setResults] = useState(initial);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminWorkspace | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setResults(initial);
    setPage(1);
    setQuery('');
    setSearch('');
    setSelected(null);
    setError('');
  }, [initial]);
  async function load(q: string, nextPage: number) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      setResults(
        await api<Results>(
          `/admin/workspaces?q=${encodeURIComponent(q)}&page=${nextPage}`,
          undefined,
          'GET',
        ),
      );
      setSearch(q);
      setPage(nextPage);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <form
        className="directory-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query, 1);
        }}
      >
        <label htmlFor="workspace-search">Name, slug or workspace ID</label>
        <input
          id="workspace-search"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button disabled={pending}>Search</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {selected && (
        <EntitlementEditor
          key={selected.id}
          workspace={selected}
          onSaved={(usage) => {
            setResults((current) => ({
              ...current,
              workspaces: current.workspaces.map((w) =>
                w.id === selected.id ? { ...w, usage } : w,
              ),
            }));
          }}
        />
      )}
      <div className="workspace-grid" aria-busy={pending}>
        {results.workspaces.map((workspace) => (
          <section className="workspace-card" key={workspace.id}>
            <h2>{workspace.name}</h2>
            <p className="muted">{workspace.slug}</p>
            <p className="muted">
              <code>{workspace.id}</code>
            </p>
            <PlanUsage usage={workspace.usage} />
            <button
              className="secondary"
              disabled={pending}
              onClick={() => setSelected(workspace)}
            >
              Edit entitlements
            </button>
          </section>
        ))}
      </div>
      {!results.workspaces.length && (
        <p role="status">No matching workspaces.</p>
      )}
      <div className="directory-toolbar">
        <button
          className="secondary"
          disabled={pending || page <= 1}
          onClick={() => void load(search, page - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          className="secondary"
          disabled={pending || !results.hasMore}
          onClick={() => void load(search, page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}

function EntitlementEditor({
  workspace,
  onSaved,
}: {
  workspace: AdminWorkspace;
  onSaved: (usage: OrganizationUsage) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const [planCode, setPlan] = useState(workspace.usage.planCode);
  const [limit, setLimit] = useState(
    workspace.usage.siteLimitOverride?.toString() ?? '',
  );
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<EntitlementPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const path = `/admin/workspaces/${workspace.id}/entitlements`;
  const payload = {
    planCode,
    siteLimitOverride: limit === '' ? null : Number(limit),
    reason,
  };
  function invalidate() {
    setPreview(null);
    setMessage('');
    setError('');
  }
  async function request(save: boolean) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (save && preview) {
        const { usage } = await api<{ usage: OrganizationUsage }>(
          path,
          { ...payload, expected: preview.expected },
          'PATCH',
        );
        onSaved(usage);
        setPreview(null);
        setMessage('Entitlements saved. Audit event recorded.');
      } else {
        setPreview(await api<EntitlementPreview>(`${path}/preview`, payload));
      }
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="card" aria-labelledby="entitlement-heading">
      <h2 id="entitlement-heading" tabIndex={-1} ref={heading}>
        Edit {workspace.name}
      </h2>
      <form
        className="creation-form"
        onSubmit={(event) => {
          event.preventDefault();
          void request(false);
        }}
      >
        <fieldset disabled={pending}>
          <legend>Plan and allowance</legend>
          <label htmlFor="admin-plan">Plan</label>
          <select
            id="admin-plan"
            value={planCode}
            onChange={(e) => {
              setPlan(e.target.value as OrganizationUsage['planCode']);
              invalidate();
            }}
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="agency">Agency</option>
            <option value="agency_plus">Agency Plus</option>
          </select>
          <label htmlFor="admin-limit">
            Custom site allowance (blank uses plan default)
          </label>
          <input
            id="admin-limit"
            type="number"
            min={0}
            max={1000}
            step={1}
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
              invalidate();
            }}
          />
          <label htmlFor="admin-reason">Reason for change</label>
          <textarea
            id="admin-reason"
            required
            maxLength={300}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              invalidate();
            }}
          />
          <button disabled={!reason.trim()}>Preview impact</button>
        </fieldset>
      </form>
      {preview && (
        <div role="region" aria-label="Change impact">
          <h3>Before</h3>
          <PlanUsage usage={preview.before} />
          <h3>After</h3>
          <PlanUsage usage={preview.after} />
          <p>
            Existing sites continue monitoring.{' '}
            {preview.after.canAddSite
              ? `${preview.after.sitesRemaining} additional sites allowed.`
              : 'New sites and restores will be blocked.'}
          </p>
          <p>Reason: {reason}</p>
          <button disabled={pending} onClick={() => void request(true)}>
            Confirm and save
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
