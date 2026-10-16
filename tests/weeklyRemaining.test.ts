import { describe, expect, test } from 'bun:test';
import { weeklyRemainingPercent, unloadedQuotaEntries } from '@/features/quota/weeklyRemaining';
import { classifyQuotaFiles, paginate, sortQuotaEntries } from '@/features/quota/logic';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import { readFileSync } from 'node:fs';

const success = (data: object) => ({ status: 'success', ...data });

describe('weekly remaining capacity', () => {
  test('labels the quota sort without changing auth-file sorting in every locale', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ru']) {
      const current = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      expect(current.quota_management.sort_default).not.toBe(current.auth_files.sort_default);
    }
  });
  test.each([
    [
      'claude',
      {
        windows: [
          { id: 'five-hour', usedPercent: 99, periodHours: 5 },
          { id: 'seven-day', usedPercent: 20, periodHours: 168 },
          { id: 'seven-day-opus', usedPercent: 95, periodHours: 168 },
        ],
      },
      80,
    ],
    [
      'codex',
      {
        windows: [
          { id: 'five-hour', usedPercent: 99, periodHours: 5 },
          { id: 'code-review-weekly', usedPercent: 99, periodHours: 168 },
          { id: 'weekly', usedPercent: 30, periodHours: 168 },
        ],
      },
      70,
    ],
    [
      'devin',
      {
        windows: [
          { id: 'daily', remainingPercent: 0 },
          { id: 'weekly', remainingPercent: 60 },
        ],
      },
      60,
    ],
    [
      'meta',
      {
        data: {
          windows: [
            { id: 'window', usedPercent: 100 },
            { id: 'weekly', usedPercent: 50 },
          ],
        },
      },
      50,
    ],
    ['xai', { billing: { periodType: 'weekly', usagePercent: 60, usedPercent: 1 } }, 40],
    [
      'antigravity',
      {
        groups: [
          {
            buckets: [
              { periodHours: 5, remainingFraction: 0 },
              { periodHours: 168, remainingFraction: 0.8 },
              { periodHours: 168, remainingFraction: 0.3 },
            ],
          },
        ],
      },
      30,
    ],
    [
      'kimi',
      {
        rows: [
          { periodHours: 5, used: 100, limit: 100 },
          { periodHours: 168, used: 160, limit: 200 },
        ],
      },
      20,
    ],
  ] as [QuotaProviderType, object, number][])(
    'reads the account weekly percentage for %s',
    (provider, data, expected) => {
      expect(weeklyRemainingPercent(provider, success(data))).toBeCloseTo(expected);
    }
  );

  test.each([
    ['claude', { windows: [{ id: 'five-hour', usedPercent: 0, periodHours: 5 }] }],
    [
      'codex',
      {
        windows: [
          { id: 'monthly', usedPercent: 0, periodHours: 720 },
          { id: 'code-review-weekly', usedPercent: 0, periodHours: 168 },
        ],
      },
    ],
    ['devin', { windows: [{ id: 'weekly', remainingPercent: null }] }],
    ['meta', { data: { windows: [{ id: 'weekly', usedPercent: NaN }] } }],
    ['xai', { billing: { periodType: 'monthly', usagePercent: 0 } }],
    ['antigravity', { groups: [{ buckets: [{ periodHours: 5, remainingFraction: 1 }] }] }],
    ['kimi', { rows: [{ periodHours: 168, used: 0, limit: 0 }] }],
  ] as [QuotaProviderType, object][])(
    'does not invent a weekly percentage for %s',
    (provider, data) => {
      expect(weeklyRemainingPercent(provider, success(data))).toBeNull();
      expect(weeklyRemainingPercent(provider, { ...data, status: 'error' })).toBeNull();
      expect(weeklyRemainingPercent(provider, { ...data, status: 'loading' })).toBeNull();
      expect(weeklyRemainingPercent(provider, undefined)).toBeNull();
    }
  );

  test('clamps overdrawn and negative usage while preserving a genuine zero balance', () => {
    const codex = (usedPercent: number) => success({ windows: [{ id: 'weekly', usedPercent }] });
    expect(weeklyRemainingPercent('codex', codex(120))).toBe(0);
    expect(weeklyRemainingPercent('codex', codex(-1))).toBe(100);
    expect(weeklyRemainingPercent('codex', codex(Infinity))).toBeNull();
  });

  test('sorts all accounts before pagination, preserving ties and putting unknowns after zero', () => {
    const entries = classifyQuotaFiles(
      Array.from({ length: 25 }, (_, index) => ({
        name: `${index}.json`,
        provider: 'codex',
      }))
    );
    const balances: Record<string, number> = {
      '0.json': 0,
      '1.json': 60,
      '2.json': 60,
      '24.json': 99,
    };
    const before = [...entries];
    const sorted = sortQuotaEntries(
      entries,
      'default',
      (entry) => balances[entry.file.name] ?? null
    );
    expect(sorted.slice(0, 5).map((entry) => entry.file.name)).toEqual([
      '24.json',
      '1.json',
      '2.json',
      '0.json',
      '3.json',
    ]);
    expect(paginate(sorted, 1, 20).pageItems[0].file.name).toBe('24.json');
    expect(entries).toEqual(before);
    balances['0.json'] = 100;
    expect(
      sortQuotaEntries(entries, 'default', (entry) => balances[entry.file.name] ?? null)[0].file
        .name
    ).toBe('0.json');
  });

  test('compares percentages across different provider types', () => {
    const entries = classifyQuotaFiles([
      { name: 'claude.json', provider: 'claude' },
      { name: 'devin.json', provider: 'devin' },
      { name: 'codex.json', provider: 'codex' },
    ]);
    const quotas: Record<string, object> = {
      claude: success({ windows: [{ id: 'seven-day', usedPercent: 80 }] }),
      devin: success({ windows: [{ id: 'weekly', remainingPercent: 100 }] }),
      codex: success({ windows: [{ id: 'weekly', usedPercent: 50 }] }),
    };
    expect(
      sortQuotaEntries(entries, 'default', (entry) =>
        weeklyRemainingPercent(entry.type, quotas[entry.type])
      ).map((entry) => entry.type)
    ).toEqual(['devin', 'codex', 'claude']);
  });
});

describe('bounded quota discovery', () => {
  test('loads accounts beyond the visible page once without retrying errors indefinitely', () => {
    const entries = classifyQuotaFiles(
      Array.from({ length: 45 }, (_, index) => ({
        name: `${index}.json`,
        provider: 'codex',
      }))
    );
    const states: Record<string, { status: string }> = {};
    const getQuota = (entry: (typeof entries)[number]) => states[entry.file.name];
    const first = unloadedQuotaEntries(entries, getQuota, 20);
    expect(first).toHaveLength(20);
    first.forEach(({ file }, index) => {
      states[file.name] = { status: index === 0 ? 'error' : 'success' };
    });
    states['20.json'] = { status: 'loading' };
    states['21.json'] = { status: 'idle' };
    const second = unloadedQuotaEntries(entries, getQuota, 20);
    expect(second[0].file.name).toBe('21.json');
    second.forEach(({ file }) => {
      states[file.name] = { status: 'success' };
    });
    const last = unloadedQuotaEntries(entries, getQuota, 20);
    expect(last.map(({ file }) => file.name)).toEqual(['41.json', '42.json', '43.json', '44.json']);
    last.forEach(({ file }) => {
      states[file.name] = { status: 'success' };
    });
    expect(unloadedQuotaEntries(entries, getQuota, 20)).toEqual([]);
  });
});
