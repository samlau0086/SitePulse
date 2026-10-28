import { UserPreferencesForm } from '../../../components/user-preferences';
import { workspaceSession } from '../../../lib/workspace';
import { serverApi } from '../../../lib/server-api';
import { EmailBrandingForm } from '../../../components/email-branding';
import type { AccountBrandSettings } from '@sitepulse/api-contracts';

export default async function SettingsPage() {
  const { user } = await workspaceSession();
  const branding = await serverApi<AccountBrandSettings>(
    '/users/me/email-branding',
  );
  return (
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PERSONAL SETTINGS</p>
          <h1>Preferences</h1>
          <p className="muted">Choose how operational times are displayed.</p>
        </div>
      </div>
      <UserPreferencesForm
        timeZone={user.timeZone}
        availableTimeZones={Intl.supportedValuesOf('timeZone')}
      />
      <EmailBrandingForm
        initial={branding.brand}
        platform={branding.platform}
        canCustomize={branding.canCustomize}
      />
    </main>
  );
}
