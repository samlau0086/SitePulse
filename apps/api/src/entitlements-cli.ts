import { parseArgs } from 'node:util';
import { databaseEnvironment } from '@sitepulse/config';
import { createDatabase } from '@sitepulse/database';
import { entitlementChange } from '@sitepulse/api-contracts';
import { changeEntitlements } from './entitlements';

async function main() {
  const { values } = parseArgs({
    options: {
      organization: { type: 'string' },
      plan: { type: 'string' },
      'site-limit': { type: 'string' },
      operator: { type: 'string' },
      reason: { type: 'string' },
    },
  });
  const input = entitlementChange.safeParse({
    organizationId: values.organization,
    planCode: values.plan,
    siteLimitOverride:
      values['site-limit'] === 'default'
        ? null
        : values['site-limit'] && /^\d+$/.test(values['site-limit'])
          ? Number(values['site-limit'])
          : undefined,
    operator: values.operator,
    reason: values.reason,
  });
  if (!input.success) throw new Error('Invalid options');
  const env = databaseEnvironment.parse(process.env);
  const database = createDatabase(env.DATABASE_URL);
  try {
    const usage = await changeEntitlements(database.db, input.data);
    console.log(
      JSON.stringify({ organizationId: input.data.organizationId, usage }),
    );
  } finally {
    await database.pool.end();
  }
}
main().catch(() => {
  // Never serialize database errors, environment values, or CLI arguments.
  console.error(
    'Entitlement update failed. Check database configuration, migrations and organization ID. Required: --organization UUID --plan free|pro|agency|agency_plus --site-limit default|0..1000 --operator LABEL --reason TEXT.',
  );
  process.exitCode = 1;
});
