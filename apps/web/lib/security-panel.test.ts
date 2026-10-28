import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type {
  PublicVulnerability,
  SiteSecurityReport,
} from '@sitepulse/api-contracts';
import { SecurityPanel } from '../components/security-panel';

function advisory(
  overrides: Partial<PublicVulnerability>,
): PublicVulnerability {
  return {
    componentType: 'php',
    component: 'php',
    installedVersion: '8.4.13',
    id: 'example',
    title: 'PHP advisory',
    severity: 'high',
    fixedVersion: '8.4.21',
    sourceUrl: 'https://example.com/advisory',
    supplyChain: false,
    ...overrides,
  };
}

function render(vulnerabilities: PublicVulnerability[], canManage = false) {
  const security: SiteSecurityReport = {
    status: 'stale',
    checkedAt: null,
    nextCheckAt: null,
    coverage: {
      inventory: 'complete',
      localFiles: 'partial',
      publicVulnerabilities: 'unknown',
    },
    environmentRisks: [
      {
        code: 'debug_display_enabled',
        severity: 'high',
        message: 'Errors displayed',
      },
      {
        code: 'dashboard_file_editor',
        severity: 'medium',
        message: 'Editor enabled',
      },
    ],
    localFindings: [{ rule: 'php_in_uploads', path: 'uploads/review.php' }],
    vulnerabilities,
    errorCode: null,
  };
  return renderToStaticMarkup(
    createElement(SecurityPanel, {
      security,
      inventory: null,
      softwareHref: '/app/software?site=example',
      canManage,
    }),
  );
}

it('prioritizes critical advisories, preserves all matches, and gives component-specific guidance', () => {
  const html = render(
    [
      advisory({ title: 'Low PHP issue', severity: 'low' }),
      advisory({
        title: 'Critical plugin issue',
        severity: 'critical',
        componentType: 'plugin',
        component: 'example-plugin',
        id: 'plugin',
      }),
      advisory({ title: 'High PHP issue', id: 'high' }),
      advisory({ title: 'Core issue', id: 'core', componentType: 'wordpress' }),
    ],
    true,
  );
  expect(html.indexOf('Critical plugin issue')).toBeLessThan(
    html.indexOf('High PHP issue'),
  );
  expect(html.indexOf('High PHP issue')).toBeLessThan(
    html.indexOf('Low PHP issue'),
  );
  expect(html).toContain('severity-critical');
  expect(html).toContain('severity-medium');
  expect(html).toContain('hosting provider or use the server control panel');
  expect(html).toContain('update WordPress to a supported patched release');
  expect(html).toContain('Review in Plugins &amp; themes');
  expect(html).toContain('Fixed boundary (this advisory)');
  expect(html).toContain('not every issue');
});

it('shows configuration recommendations and scan limitations without inventing local severity', () => {
  const html = render([]);
  expect(html).toContain('WP_DEBUG_DISPLAY');
  expect(html).toContain('DISALLOW_FILE_EDIT');
  expect(html).toContain('Review required');
  expect(html).toContain('uploads/review.php');
  expect(html).toContain('Do not delete files solely on a pattern match');
  expect(html).toContain('Local scan unavailable');
  expect(html).toContain('no assigned severity');
  expect(html).toContain('does not force an immediate advisory lookup');
  expect(html).not.toContain('Sync inventory and refresh code scan</a>');
});

it('handles missing patches and supply-chain findings without promising an update fixes them', () => {
  const html = render([
    advisory({ fixedVersion: null, severity: 'unknown' }),
    advisory({ id: 'supply', supplyChain: true, componentType: 'theme' }),
  ]);
  expect(html).toContain('No fixed version is reported');
  expect(html).toContain('A version update alone may not resolve');
  expect(html).toContain('severity-unknown');
  expect(html).not.toContain('Review in Plugins &amp; themes');
});
