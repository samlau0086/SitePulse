'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { EmailBrandSettings } from '@sitepulse/api-contracts';
import { validLogoUrl } from '@sitepulse/api-contracts';
import { api } from '../lib/api';

export function EmailBrandingForm({
  initial,
  platform,
  canCustomize = true,
  admin = false,
}: {
  initial: EmailBrandSettings;
  platform?: EmailBrandSettings;
  canCustomize?: boolean;
  admin?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [failedImage, setFailedImage] = useState('');
  const preview =
    !admin && (!canCustomize || !logoUrl.trim())
      ? platform
      : { name, logoUrl: logoUrl.trim() || null };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (logoUrl.trim() && !validLogoUrl(logoUrl.trim())) {
      setError(
        'Enter a public HTTPS image URL without credentials, port or fragment.',
      );
      return;
    }
    setPending(true);
    try {
      await api(
        admin ? '/admin/branding' : '/users/me/email-branding',
        { name: name.trim(), logoUrl: logoUrl.trim() || null },
        'PATCH',
      );
      setMessage(
        'Email branding saved. Future emails will use the current plan and branding settings.',
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to save email branding.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="card creation-form email-branding" onSubmit={save}>
      <h2>{admin ? 'Platform email branding' : 'Agency email branding'}</h2>
      <p>
        {admin
          ? 'Used for Free and Pro workspace emails, Agency workspaces without a custom logo, and all account verification and password reset emails.'
          : 'Your account logo applies to alert, recipient verification and test emails for Agency and Agency Plus workspaces you own. Other workspaces use the platform brand.'}
      </p>
      {!canCustomize && (
        <p className="notice-warning">
          A verified account owning an Agency or Agency Plus workspace is
          required to customize email branding.
        </p>
      )}
      <fieldset disabled={pending || !canCustomize}>
        <label htmlFor={admin ? 'platform-brand-name' : 'account-brand-name'}>
          Brand name
        </label>
        <input
          id={admin ? 'platform-brand-name' : 'account-brand-name'}
          required
          maxLength={100}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setMessage('');
          }}
        />
        <label htmlFor={admin ? 'platform-logo' : 'account-logo'}>
          Logo image URL
        </label>
        <input
          id={admin ? 'platform-logo' : 'account-logo'}
          type="url"
          maxLength={2048}
          placeholder="https://cdn.example.com/logo.png"
          value={logoUrl}
          onChange={(event) => {
            setLogoUrl(event.target.value);
            setMessage('');
          }}
          aria-describedby={admin ? 'platform-logo-help' : 'account-logo-help'}
        />
        <p
          className="muted"
          id={admin ? 'platform-logo-help' : 'account-logo-help'}
        >
          Use a publicly accessible HTTPS PNG or JPEG, ideally 360 × 128 pixels,
          with no sign-in required. Recipients load this image from your image
          host.{' '}
          {admin
            ? 'Leave blank to use the brand name alone.'
            : 'Leave blank to restore the platform brand.'}
        </p>
        <button type="submit">
          {pending ? 'Saving…' : 'Save email branding'}
        </button>
      </fieldset>
      <div className="email-brand-preview" aria-label="Email brand preview">
        <p className="eyebrow">EMAIL HEADER PREVIEW · UNSAVED CHANGES</p>
        {preview?.logoUrl &&
          validLogoUrl(preview.logoUrl) &&
          failedImage !== preview.logoUrl && (
            // External branding URLs are intentional; omit the referring application URL.
            <img
              key={preview.logoUrl}
              src={preview.logoUrl}
              alt={`${preview.name} logo`}
              referrerPolicy="no-referrer"
              onError={() => setFailedImage(preview.logoUrl!)}
            />
          )}
        {preview?.logoUrl && failedImage === preview.logoUrl && (
          <p className="muted">
            Logo could not be loaded. Check the URL and image host permissions.
          </p>
        )}
        <strong>{preview?.name ?? 'SitePulse'}</strong>
        <p>Monitoring updates, clearly delivered.</p>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
