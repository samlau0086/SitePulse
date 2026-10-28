'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  OperationPlan,
  SoftwarePreviewResult,
} from '../lib/software-operations';
import { api } from '../lib/api';
import { Icon } from './icon';

export function SoftwareOperationDialog({
  base,
  plans,
  onClose,
  onConfirm,
}: {
  base: string;
  plans: OperationPlan[];
  onClose: () => void;
  onConfirm: (
    plans: OperationPlan[],
    previews: SoftwarePreviewResult[],
    reason: string,
  ) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [reason, setReason] = useState(
    `${plans[0]!.command.action} ${plans.length === 1 ? plans[0]!.command.slug : `${plans.length} selected components`} from software manager`,
  );
  const [replacement, setReplacement] = useState('');
  const [review, setReview] = useState<{
    plans: OperationPlan[];
    previews: SoftwarePreviewResult[];
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const needsReplacement = plans.some(
    (plan) =>
      plan.command.kind === 'theme' && plan.command.action === 'deactivate',
  );
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (
        reason.trim().length < 3 ||
        (needsReplacement && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(replacement))
      ) {
        if (active) setLoading(false);
        return;
      }
      try {
        const approved = plans.map((plan) => ({
          ...plan,
          command: {
            ...plan.command,
            ...(needsReplacement ? { replacement } : {}),
          },
        }));
        const previews: SoftwarePreviewResult[] = [];
        // Create the first batch last so it remains in the bounded recent-results
        // feed even when many component previews affect twenty sites each.
        for (const plan of [...approved].reverse()) {
          if (!active) return;
          previews.unshift(
            await api<SoftwarePreviewResult>(`${base}/preview`, {
              siteIds: plan.targets.map((target) => target.siteId),
              command: plan.command,
              reason: reason.trim(),
            }),
          );
        }
        if (active) setReview({ plans: approved, previews });
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : 'Unable to preview operation.',
          );
      } finally {
        if (active) setLoading(false);
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [base, plans, reason, replacement, needsReplacement, retry]);
  function invalidate() {
    setReview(null);
    setError('');
    setLoading(true);
  }
  return (
    <dialog
      ref={dialog}
      className="software-dialog"
      aria-labelledby="software-dialog-title"
      onCancel={onClose}
    >
      <h2 id="software-dialog-title">
        <Icon name="shield" /> Confirm {plans[0]!.command.action}
      </h2>
      <p>
        This affects only the components and sites listed below, not every
        selected site.
      </p>
      <ul className="software-impact">
        {plans.map((plan) => (
          <li key={plan.command.slug}>
            <strong>{plan.command.slug}</strong> · {plan.command.kind}
            <ul>
              {plan.targets.map((target) => (
                <li key={target.siteId}>{target.name}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!review || loading || submitting.current) return;
          submitting.current = true;
          onConfirm(review.plans, review.previews, reason.trim());
        }}
      >
        {needsReplacement && (
          <>
            <label htmlFor="dialog-replacement">
              Switch to installed theme slug
            </label>
            <input
              id="dialog-replacement"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={100}
              value={replacement}
              onChange={(event) => {
                setReplacement(event.target.value);
                invalidate();
              }}
            />
            <p className="muted">
              WordPress requires an active theme. Every target site must have
              this replacement installed.
            </p>
          </>
        )}
        <label htmlFor="dialog-reason">Change reason</label>
        <input
          id="dialog-reason"
          required
          minLength={3}
          maxLength={300}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            invalidate();
          }}
        />
        <p className="notice-warning">
          Back up WordPress files and database first. Activation and updates can
          break a site; uninstall may permanently delete data. No automatic
          rollback.
        </p>
        {plans.length > 1 && (
          <p className="notice-warning">
            Items run sequentially. Keep this page open: closing or leaving
            stops unsubmitted items, not commands already queued. Any failure or
            unknown outcome stops remaining items. This is not an atomic
            transaction.
          </p>
        )}
        {loading && <p role="status">Validating impact with the server…</p>}
        {error && <p role="alert">{error}</p>}
        {error && (
          <button
            className="secondary"
            type="button"
            onClick={() => {
              invalidate();
              setRetry((value) => value + 1);
            }}
          >
            Retry preview (does not execute)
          </button>
        )}
        {review && (
          <p className="muted">
            Server preview ready. Confirmation expires in 10 minutes. Execution
            occurs on the next Connector poll.
          </p>
        )}
        <div className="software-actions">
          <button disabled={!review || loading} type="submit">
            <Icon name="check" /> Confirm and queue
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
