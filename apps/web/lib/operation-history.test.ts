import { expect, it } from 'vitest';
import type { SoftwareOperation } from '@sitepulse/api-contracts';
import { calendarDate, filterOperationHistory } from './operation-history';

const operations = [
  { id: 'before', status: 'failed', createdAt: '2026-11-01T03:59:59Z' },
  { id: 'start', status: 'failed', createdAt: '2026-11-01T04:00:00Z' },
  { id: 'end', status: 'failed', createdAt: '2026-11-02T04:59:59Z' },
  { id: 'after', status: 'succeeded', createdAt: '2026-11-02T05:00:00Z' },
] as SoftwareOperation[];

it('uses saved-zone inclusive calendar boundaries across a 25-hour daylight-saving day', () => {
  expect(calendarDate('2026-10-29T16:00:00Z', 'Asia/Shanghai')).toBe(
    '2026-10-30',
  );
  const ids = (rows: SoftwareOperation[]) => rows.map((row) => row.id);
  expect(
    ids(
      filterOperationHistory(
        operations,
        'failed',
        'range',
        '2026-11-01',
        '2026-11-01',
        'America/New_York',
      ),
    ),
  ).toEqual(['end', 'start']);
  expect(
    ids(
      filterOperationHistory(
        operations,
        'all',
        'yesterday',
        '',
        '',
        'America/New_York',
        Date.parse('2026-11-02T05:30:00Z'),
      ),
    ),
  ).toEqual(['end', 'start']);
  expect(
    ids(
      filterOperationHistory(
        operations,
        'all',
        'today',
        '',
        '',
        'America/New_York',
        Date.parse('2026-11-02T05:30:00Z'),
      ),
    ),
  ).toEqual(['after']);
});
