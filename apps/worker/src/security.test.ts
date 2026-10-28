import { describe, expect, it } from 'vitest';
import { compareVersions, parseAdvisories } from './security';

describe('security advisory matching', () => {
  it('compares numeric WordPress versions', () => {
    expect(compareVersions('6.10.1', '6.9.9')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
  it('matches bounded affected versions without treating unknown ranges as safe', () => {
    const result = parseAdvisories(
      { type: 'plugin', identifier: 'example', version: '2.0.0' },
      {
        error: 0,
        data: {
          vulnerability: [
            {
              uuid: 'CVE-1',
              name: 'Example issue',
              operator: {
                min_version: '1.0',
                min_operator: 'ge',
                max_version: '2.1',
                max_operator: 'lt',
                unfixed: 0,
              },
              source: [{ link: 'https://example.test/CVE-1' }],
              impact: { cvss3: { severity: 'high' } },
            },
          ],
        },
      },
    );
    expect(result.complete).toBe(true);
    expect(result.findings[0]).toMatchObject({
      id: 'CVE-1',
      severity: 'high',
      fixedVersion: '2.1',
    });
  });
  it('marks malformed operator coverage incomplete', () => {
    const result = parseAdvisories(
      { type: 'theme', identifier: 'x', version: '1.0' },
      {
        error: 0,
        data: {
          vulnerability: [
            {
              uuid: 'x',
              name: 'x',
              operator: { min_version: '1', min_operator: 'unexpected' },
            },
          ],
        },
      },
    );
    expect(result).toEqual({ findings: [], complete: false });
  });
  it('does not report unknown packages or malformed responses as fully covered', () => {
    const component = {
      type: 'plugin' as const,
      identifier: 'unknown',
      version: '1.0',
    };
    for (const data of [
      { name: null, vulnerability: null },
      { vulnerability: {} },
      {},
    ]) {
      expect(parseAdvisories(component, { error: 0, data }).complete).toBe(
        false,
      );
    }
    expect(() => parseAdvisories(component, { error: 1, data: {} })).toThrow();
  });
  it('reports PHP support expiry using the actual support date', () => {
    const component = {
      type: 'php' as const,
      identifier: 'php',
      version: '7.4.33',
    };
    expect(
      parseAdvisories(component, {
        error: 0,
        data: { date_end: '2022-11-28', vulnerability: null },
      }).findings[0],
    ).toMatchObject({
      severity: 'high',
      id: 'php-eol-2022-11-28',
      fixedVersion: null,
    });
    expect(
      parseAdvisories(component, {
        error: 0,
        data: { date_end: '2099-11-28', vulnerability: null },
      }).findings,
    ).toEqual([]);
  });
  it('does not invent a fixed version for inclusive ranges or supply chain reports', () => {
    const result = parseAdvisories(
      { type: 'plugin', identifier: 'x', version: '1.0' },
      {
        error: 0,
        data: {
          vulnerability: [
            {
              uuid: 'x',
              name: 'x',
              operator: { max_version: '1.0', max_operator: 'le' },
            },
          ],
          supplychain: [
            {
              verdict: 'malicious',
              audit_id: 1,
              head_version: '1.1',
              affected_versions: { max_version: '1.0', max_operator: 'le' },
            },
          ],
        },
      },
    );
    expect(result.findings).toHaveLength(2);
    expect(
      result.findings.every((finding) => finding.fixedVersion === null),
    ).toBe(true);
  });
  it('removes exact provider duplicates without collapsing distinct advisory IDs', () => {
    const common = {
      name: 'PHP 8.4 before patched boundary',
      operator: { max_version: '8.4.21', max_operator: 'lt' },
      impact: { cvss3: { severity: 'critical' } },
    };
    const result = parseAdvisories(
      { type: 'php', identifier: 'php', version: '8.4.13' },
      {
        error: 0,
        data: {
          vulnerability: [
            { ...common, uuid: 'CVE-ONE' },
            { ...common, uuid: 'CVE-ONE' },
            { ...common, uuid: 'CVE-TWO' },
          ],
        },
      },
    );
    expect(result.findings.map((finding) => finding.id)).toEqual([
      'CVE-ONE',
      'CVE-TWO',
    ]);
  });
});
