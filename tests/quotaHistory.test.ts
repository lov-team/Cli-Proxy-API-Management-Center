import { describe, expect, test } from 'bun:test';
import { historySegments, readQuotaHistory } from '../src/services/api/quotaHistory';

describe('quota history', () => {
  test('missing consumption remains unknown, measured zero remains zero', () => {
    const data = readQuotaHistory({
      sample: { finished_at: '2026-11-02T08:00:00Z' },
      groups: [{ plan: 'max', today: null, last_week: 0 }],
      accounts: [{ weekly: 0, today: null }],
    });
    expect(data.groups[0].today).toBeNull();
    expect(data.groups[0].lastWeek).toBe(0);
    expect(data.accounts[0].weekly).toBe(0);
    expect(data.accounts[0].today).toBeNull();
  });
  test('incomplete observations break the curve', () => {
    const point = (at: string, complete = true) => ({
      at,
      complete,
      plan: 'max',
      remaining: 50,
      total: 100,
      previousWeek: false,
    });
    const segments = historySegments(
      [
        point('2026-11-02T01:00:00Z'),
        point('2026-11-02T02:00:00Z', false),
        point('2026-11-02T03:00:00Z'),
        point('2026-11-02T07:00:00Z'),
      ],
      'UTC'
    );
    expect(segments).toHaveLength(3);
  });
});
