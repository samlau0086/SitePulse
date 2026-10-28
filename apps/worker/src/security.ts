import { randomUUID } from 'node:crypto';
import { uniquePublicVulnerabilities } from '@sitepulse/api-contracts';
import { and, eq, schema, sql, type Database } from '@sitepulse/database';

type Component = {
  type: 'wordpress' | 'php' | 'plugin' | 'theme';
  identifier: string;
  version: string;
};
type Finding = NonNullable<
  typeof schema.siteSecurityAssessments.$inferInsert.vulnerabilities
>[number];
type Http = typeof fetch;

function parts(version: string) {
  return version
    .split(/[.+_-]/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}
export function compareVersions(left: string, right: string) {
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

function operatorMatches(
  version: string,
  boundary: unknown,
  operator: unknown,
) {
  if (boundary == null && operator == null) return true;
  if (typeof boundary !== 'string' || typeof operator !== 'string') return null;
  if (!/^\d+(?:\.\d+)*$/.test(version) || !/^\d+(?:\.\d+)*$/.test(boundary))
    return null;
  const result = compareVersions(version, boundary);
  if (operator === 'lt') return result < 0;
  if (operator === 'le') return result <= 0;
  if (operator === 'eq') return result === 0;
  if (operator === 'ne') return result !== 0;
  if (operator === 'gt') return result > 0;
  if (operator === 'ge') return result >= 0;
  return null;
}

function affected(version: string, operator: unknown) {
  if (!operator || typeof operator !== 'object') return null;
  const range = operator as Record<string, unknown>;
  if (range.min_version == null && range.max_version == null) return null;
  const lower = operatorMatches(version, range.min_version, range.min_operator);
  const upper = operatorMatches(version, range.max_version, range.max_operator);
  return lower == null || upper == null ? null : lower && upper;
}

function severity(impact: unknown): Finding['severity'] {
  if (!impact || typeof impact !== 'object' || Array.isArray(impact))
    return 'unknown';
  const entries = Object.values(impact as Record<string, unknown>);
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const value = String(
      (entry as Record<string, unknown>).severity ?? '',
    ).toLowerCase();
    if (['low', 'medium', 'high', 'critical'].includes(value))
      return value as Finding['severity'];
  }
  return 'unknown';
}

function safeSourceUrl(sources: unknown) {
  if (!Array.isArray(sources)) return null;
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const link = (source as Record<string, unknown>).link;
    if (typeof link !== 'string') continue;
    try {
      const url = new URL(link);
      if (url.protocol === 'https:') return url.toString().slice(0, 1000);
    } catch {
      continue;
    }
  }
  return null;
}

export function parseAdvisories(component: Component, payload: unknown) {
  if (!payload || typeof payload !== 'object')
    throw new Error('invalid_payload');
  const envelope = payload as Record<string, unknown>;
  if (
    Number(envelope.error) !== 0 ||
    !envelope.data ||
    typeof envelope.data !== 'object'
  )
    throw new Error('provider_error');
  const data = envelope.data as Record<string, unknown>;
  const findings: Finding[] = [];
  let complete =
    data.name !== null &&
    (data.vulnerability === null || Array.isArray(data.vulnerability));
  if (
    component.type === 'php' &&
    typeof data.date_end === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(data.date_end) &&
    Date.parse(`${data.date_end}T23:59:59Z`) < Date.now()
  ) {
    findings.push({
      componentType: 'php',
      component: component.identifier,
      installedVersion: component.version,
      id: `php-eol-${data.date_end}`,
      title: `PHP branch reached end of support on ${data.date_end}`,
      severity: 'high',
      fixedVersion: null,
      sourceUrl: null,
      supplyChain: false,
    });
  }
  for (const item of Array.isArray(data.vulnerability)
    ? data.vulnerability
    : []) {
    if (!item || typeof item !== 'object') {
      complete = false;
      continue;
    }
    const row = item as Record<string, unknown>;
    const match =
      component.type === 'wordpress'
        ? true
        : affected(component.version, row.operator);
    if (match == null) {
      complete = false;
      continue;
    }
    if (!match) continue;
    if (typeof row.uuid !== 'string' || typeof row.name !== 'string') {
      complete = false;
      continue;
    }
    const range = row.operator as Record<string, unknown> | undefined;
    findings.push({
      componentType: component.type,
      component: component.identifier,
      installedVersion: component.version,
      id: row.uuid.slice(0, 128),
      title: row.name.slice(0, 300),
      severity: severity(row.impact),
      fixedVersion:
        range?.unfixed === 1 ||
        range?.unfixed === '1' ||
        range?.max_operator !== 'lt' ||
        typeof range?.max_version !== 'string'
          ? null
          : range.max_version,
      sourceUrl: safeSourceUrl(row.source),
      supplyChain: false,
    });
  }
  if (component.type === 'plugin') {
    if (data.supplychain != null && !Array.isArray(data.supplychain))
      complete = false;
    for (const item of Array.isArray(data.supplychain)
      ? data.supplychain
      : []) {
      if (!item || typeof item !== 'object') {
        complete = false;
        continue;
      }
      const row = item as Record<string, unknown>;
      const match = affected(component.version, row.affected_versions);
      if (match == null) {
        complete = false;
        continue;
      }
      if (!match || !['malicious', 'suspicious'].includes(String(row.verdict)))
        continue;
      findings.push({
        componentType: 'plugin',
        component: component.identifier,
        installedVersion: component.version,
        id: `supply-chain-${String(row.audit_id).slice(0, 80)}`,
        title: `${String(row.verdict)} supply-chain report`,
        severity: row.verdict === 'malicious' ? 'critical' : 'high',
        fixedVersion: null,
        sourceUrl: null,
        supplyChain: true,
      });
    }
  }
  return { findings: uniquePublicVulnerabilities(findings), complete };
}

async function query(component: Component, http: Http) {
  const path =
    component.type === 'wordpress'
      ? `core/${encodeURIComponent(component.version)}`
      : component.type === 'php'
        ? `php/${encodeURIComponent(component.version.split('.').slice(0, 2).join('.'))}`
        : `${component.type}/${encodeURIComponent(component.identifier)}`;
  const response = await http(`https://www.wpvulnerability.net/${path}/`, {
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: {
      accept: 'application/json',
      'user-agent': 'SitePulse/0.1 security inventory',
    },
  });
  if (
    !response.ok ||
    Number(response.headers.get('content-length') ?? 0) > 1_000_000
  )
    throw new Error('provider_http');
  if (!response.body) throw new Error('provider_empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new Error('provider_size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return parseAdvisories(
    component,
    JSON.parse(Buffer.concat(chunks).toString('utf8')),
  );
}

export async function runSecurityAssessment(db: Database, http: Http = fetch) {
  const [candidate] = await db
    .select({
      assessment: schema.siteSecurityAssessments,
      inventory: schema.siteInventorySnapshots,
    })
    .from(schema.siteSecurityAssessments)
    .innerJoin(
      schema.sites,
      eq(schema.sites.id, schema.siteSecurityAssessments.siteId),
    )
    .innerJoin(
      schema.siteInventorySnapshots,
      eq(
        schema.siteInventorySnapshots.siteId,
        schema.siteSecurityAssessments.siteId,
      ),
    )
    .where(
      and(
        sql`${schema.sites.deletedAt} is null`,
        eq(schema.sites.status, 'active'),
        sql`${schema.siteSecurityAssessments.nextCheckAt} <= now()`,
        sql`(${schema.siteSecurityAssessments.leaseExpiresAt} is null or ${schema.siteSecurityAssessments.leaseExpiresAt} <= now())`,
      ),
    )
    .orderBy(schema.siteSecurityAssessments.nextCheckAt)
    .limit(1);
  if (!candidate) return 0;
  const token = randomUUID();
  const [leased] = await db
    .update(schema.siteSecurityAssessments)
    .set({
      leaseToken: token,
      leaseExpiresAt: sql`now() + interval '10 minutes'`,
    })
    .where(
      and(
        eq(schema.siteSecurityAssessments.siteId, candidate.assessment.siteId),
        sql`${schema.siteSecurityAssessments.nextCheckAt} <= now()`,
        sql`exists (select 1 from ${schema.siteInventorySnapshots} i where i.site_id = ${candidate.assessment.siteId} and i.wordpress_version = ${candidate.inventory.wordpressVersion} and i.php_version = ${candidate.inventory.phpVersion} and i.installed_plugins is not distinct from ${candidate.inventory.installedPlugins === null ? null : JSON.stringify(candidate.inventory.installedPlugins)}::jsonb and i.installed_themes is not distinct from ${candidate.inventory.installedThemes === null ? null : JSON.stringify(candidate.inventory.installedThemes)}::jsonb)`,
        sql`(${schema.siteSecurityAssessments.leaseExpiresAt} is null or ${schema.siteSecurityAssessments.leaseExpiresAt} <= now())`,
      ),
    )
    .returning();
  if (!leased) return 0;
  const plugins = candidate.inventory.installedPlugins;
  const themes = candidate.inventory.installedThemes;
  if (!plugins || !themes) {
    await db
      .update(schema.siteSecurityAssessments)
      .set({
        status: 'unavailable',
        coverage: 'unknown',
        vulnerabilities: [],
        errorCode: 'inventory_upgrade_required',
        checkedAt: sql`now()`,
        nextCheckAt: sql`now() + interval '24 hours'`,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(schema.siteSecurityAssessments.siteId, leased.siteId),
          eq(schema.siteSecurityAssessments.leaseToken, token),
          sql`${schema.siteSecurityAssessments.leaseExpiresAt} > now()`,
          sql`exists (select 1 from ${schema.sites} s where s.id = ${leased.siteId} and s.deleted_at is null and s.status = 'active')`,
        ),
      );
    return 1;
  }
  const all: Component[] = [
    {
      type: 'wordpress',
      identifier: 'wordpress',
      version: candidate.inventory.wordpressVersion,
    },
    { type: 'php', identifier: 'php', version: candidate.inventory.phpVersion },
    ...plugins
      .filter((x) => x.source === 'wordpress.org')
      .map((x) => ({
        type: 'plugin' as const,
        identifier: x.identifier,
        version: x.version,
      })),
    ...themes
      .filter((x) => x.source === 'wordpress.org')
      .map((x) => ({
        type: 'theme' as const,
        identifier: x.identifier,
        version: x.version,
      })),
  ];
  const components = all;
  const findings: Finding[] = [];
  let complete =
    candidate.inventory.environment?.inventoryComplete !== false &&
    all.length <= components.length &&
    plugins.length < 200 &&
    themes.length < 20 &&
    plugins.every((x) => x.source === 'wordpress.org') &&
    themes.every((x) => x.source === 'wordpress.org');
  try {
    for (let offset = 0; offset < components.length; offset += 5) {
      const results = await Promise.all(
        components
          .slice(offset, offset + 5)
          .map((component) => query(component, http)),
      );
      for (const result of results) {
        findings.push(...result.findings);
        complete &&= result.complete;
      }
    }
    const uniqueFindings = uniquePublicVulnerabilities(findings);
    await db
      .update(schema.siteSecurityAssessments)
      .set({
        status: 'current',
        vulnerabilities: uniqueFindings.slice(0, 500),
        coverage:
          complete && uniqueFindings.length <= 500 ? 'complete' : 'partial',
        errorCode: null,
        checkedAt: sql`now()`,
        nextCheckAt: sql`now() + interval '24 hours'`,
        inventoryUpdatedAt: candidate.inventory.updatedAt,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(schema.siteSecurityAssessments.siteId, leased.siteId),
          eq(schema.siteSecurityAssessments.leaseToken, token),
          sql`${schema.siteSecurityAssessments.leaseExpiresAt} > now()`,
          sql`exists (select 1 from ${schema.sites} s where s.id = ${leased.siteId} and s.deleted_at is null and s.status = 'active')`,
        ),
      );
  } catch {
    await db
      .update(schema.siteSecurityAssessments)
      .set({
        status: 'unavailable',
        coverage: 'unknown',
        vulnerabilities: [],
        errorCode: 'advisory_provider_unavailable',
        checkedAt: sql`now()`,
        nextCheckAt: sql`now() + interval '1 hour'`,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(schema.siteSecurityAssessments.siteId, leased.siteId),
          eq(schema.siteSecurityAssessments.leaseToken, token),
          sql`${schema.siteSecurityAssessments.leaseExpiresAt} > now()`,
          sql`exists (select 1 from ${schema.sites} s where s.id = ${leased.siteId} and s.deleted_at is null and s.status = 'active')`,
        ),
      );
  }
  return 1;
}
