import { UserPreferencesForm } from '../../../components/user-preferences';
import { workspaceSession } from '../../../lib/workspace';

export default async function SettingsPage() {
  const { user } = await workspaceSession();
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
    </main>
  );
}
