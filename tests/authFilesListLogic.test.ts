import { describe, expect, test } from 'bun:test';
import {
  buildWildcardSearch,
  matchesAuthFileSearch,
  resolveAuthFileQuotaType,
  sortAuthFiles,
  sortAuthFilesPageByQuota,
} from '../src/features/authFiles/logic';
import { weeklyRemainingPercent } from '@/features/quota/weeklyRemaining';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { AuthFileItem } from '../src/types';

const authFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'credential.json',
  type: 'codex',
  ...overrides,
});

const search = (file: AuthFileItem, term: string) =>
  matchesAuthFileSearch(file, term, buildWildcardSearch(term));

describe('buildWildcardSearch', () => {
  test('returns null when the term has no wildcard', () => {
    expect(buildWildcardSearch('user@example.com')).toBeNull();
  });

  test('stays unanchored — segments may match anywhere in the value', () => {
    expect(buildWildcardSearch('a*b')?.test('zzzaqqbzzz')).toBe(true);
  });

  test('escapes regex metacharacters in the segments', () => {
    const pattern = buildWildcardSearch('u+1*');
    expect(pattern?.test('u+1@x.com')).toBe(true);
    expect(pattern?.test('u1@x.com')).toBe(false);
  });

  test('a lone wildcard matches everything', () => {
    expect(buildWildcardSearch('*')?.test('anything')).toBe(true);
  });
});

describe('resolveAuthFileQuotaType', () => {
  test('resolves each supported provider while the all tab is selected', () => {
    expect(resolveAuthFileQuotaType(authFile({ type: 'codex' }), 'all')).toBe('codex');
    expect(resolveAuthFileQuotaType(authFile({ type: 'kimi' }), 'all')).toBe('kimi');
  });

  test('does not expose quota for unsupported or mismatched providers', () => {
    expect(resolveAuthFileQuotaType(authFile({ type: 'gemini' }), 'all')).toBeNull();
    expect(resolveAuthFileQuotaType(authFile({ type: 'codex' }), 'claude')).toBeNull();
    expect(resolveAuthFileQuotaType(authFile({ type: 'codex' }), null)).toBeNull();
  });
});

describe('matchesAuthFileSearch', () => {
  test('an empty term matches every file', () => {
    expect(matchesAuthFileSearch(authFile(), '', null)).toBe(true);
  });

  test('matches the file name case-insensitively', () => {
    expect(search(authFile({ name: 'codex-a.json' }), 'CODEX')).toBe(true);
  });

  test('matches the type and the provider', () => {
    expect(search(authFile({ type: 'antigravity' }), 'antigrav')).toBe(true);
    expect(search(authFile({ type: undefined, provider: 'gemini' }), 'gemi')).toBe(true);
  });

  test('finds a kimi credential by account email even though its name carries none', () => {
    expect(
      search(
        authFile({ name: 'kimi-1712345678901.json', type: 'kimi', email: 'user@example.com' }),
        'user@example'
      )
    ).toBe(true);
  });

  test('matches the project id', () => {
    expect(search(authFile({ name: 'vertex-x.json', projectId: 'my-proj' }), 'my-proj')).toBe(true);
  });

  test('searches the email on the wildcard path too', () => {
    expect(
      search(authFile({ name: 'kimi-1712345678901.json', email: 'user@example.com' }), 'user@*com')
    ).toBe(true);
  });

  test('never matches the account field — it can be a raw API key', () => {
    expect(
      search(
        authFile({ name: 'gemini-apikey.json', account: 'sk-live-abcd', account_type: 'api_key' }),
        'sk-live'
      )
    ).toBe(false);
  });

  test('tolerates missing fields', () => {
    expect(search({ name: 'bare.json' }, 'zzz')).toBe(false);
  });
});

describe('sortAuthFiles', () => {
  test("'default' orders by provider then name", () => {
    const files = [
      authFile({ name: 'b.json', provider: 'kimi' }),
      authFile({ name: 'c.json', type: 'codex', provider: undefined }),
      authFile({ name: 'a.json', provider: 'kimi' }),
    ];
    expect(sortAuthFiles(files, 'default').map((file) => file.name)).toEqual([
      'c.json',
      'a.json',
      'b.json',
    ]);
  });

  test("'az' orders by the displayed primary row, not by the file name", () => {
    const files = [
      authFile({ name: 'zzz.json', email: 'aaa@example.com' }),
      authFile({ name: 'aaa.json', email: 'zzz@example.com' }),
    ];
    expect(sortAuthFiles(files, 'az').map((file) => file.name)).toEqual(['zzz.json', 'aaa.json']);
  });

  test("'az' falls back to the file name when primaries are equal", () => {
    const files = [
      authFile({ name: 'codex-abc-user@x.com-team.json', email: 'user@x.com' }),
      authFile({ name: 'codex-abc-user@x.com-plus.json', email: 'user@x.com' }),
    ];
    expect(sortAuthFiles(files, 'az').map((file) => file.name)).toEqual([
      'codex-abc-user@x.com-plus.json',
      'codex-abc-user@x.com-team.json',
    ]);
  });

  test("'az' mixes account primaries and file-name fallbacks coherently", () => {
    const files = [
      authFile({ name: 'kimi-9.json', type: 'kimi' }),
      authFile({ name: 'zzz.json', email: 'aaa@example.com' }),
    ];
    expect(sortAuthFiles(files, 'az').map((file) => file.name)).toEqual([
      'zzz.json',
      'kimi-9.json',
    ]);
  });

  test("'priority' orders descending, treats missing values as 0 and stays stable on ties", () => {
    const files = [
      authFile({ name: 'a.json' }),
      authFile({ name: 'b.json', priority: 5 }),
      authFile({ name: 'c.json' }),
      authFile({ name: 'd.json', priority: 9 }),
    ];
    expect(sortAuthFiles(files, 'priority').map((file) => file.name)).toEqual([
      'd.json',
      'b.json',
      'a.json',
      'c.json',
    ]);
  });

  test('returns a new array and leaves the input untouched', () => {
    const files = [authFile({ name: 'b.json' }), authFile({ name: 'a.json' })];
    const result = sortAuthFiles(files, 'az');
    expect(result).not.toBe(files);
    expect(files.map((file) => file.name)).toEqual(['b.json', 'a.json']);
  });

  test('an unknown mode returns an unsorted copy', () => {
    const files = [authFile({ name: 'b.json' }), authFile({ name: 'a.json' })];
    expect(sortAuthFiles(files, 'nope' as unknown as 'az').map((file) => file.name)).toEqual([
      'b.json',
      'a.json',
    ]);
  });
});

describe('auth file creation-time pages with weekly quota ordering', () => {
  test('fixes pages by creation time then sorts each page without moving old high-quota accounts forward', () => {
    const files = Array.from({ length: 25 }, (_, index) =>
      authFile({
        name: `${index}.json`,
        type: 'devin',
        authIndex: index,
        createdAtMs: 1000 + index,
      })
    );
    const before = [...files];
    const newestFirst = sortAuthFiles(files, 'default');
    const balances: Record<string, number | null> = {
      '0.json': 100,
      '24.json': 20,
      '23.json': 80,
      '22.json': 0,
    };
    const quota = (file: AuthFileItem) => balances[file.name] ?? null;
    const first = sortAuthFilesPageByQuota(newestFirst.slice(0, 9), quota);
    expect(first.slice(0, 4).map((file) => file.name)).toEqual([
      '23.json',
      '24.json',
      '22.json',
      '21.json',
    ]);
    expect(first).not.toContain(files[0]);
    expect(sortAuthFilesPageByQuota(newestFirst.slice(18), quota)[0]).toBe(files[0]);
    balances['24.json'] = 90;
    expect(sortAuthFilesPageByQuota(newestFirst.slice(0, 9), quota)[0]).toBe(files[24]);
    expect(files).toEqual(before);
  });

  test('uses creation time rather than modification time, putting missing creation times last', () => {
    const files = [
      authFile({ name: 'old', createdAtMs: 1000, modified: 9000 }),
      authFile({ name: 'new', createdAtMs: 2000, modified: 3000 }),
      authFile({ name: 'unknown', modified: 10000 }),
    ];
    expect(sortAuthFiles(files, 'default').map((file) => file.name)).toEqual([
      'new',
      'old',
      'unknown',
    ]);
  });

  test('uses weekly capacity and keeps same-name Devin credentials independent', () => {
    const files = [
      authFile({ name: 'same.json', type: 'devin', authIndex: 1 }),
      authFile({ name: 'same.json', type: 'devin', authIndex: 2 }),
    ];
    const quota = new Map(
      files.map((file, index) => [
        getQuotaCacheKey(file),
        {
          status: 'success',
          windows: [
            { id: 'daily', remainingPercent: 100 - index * 100 },
            { id: 'weekly', remainingPercent: index * 90 },
          ],
        },
      ])
    );
    const sorted = sortAuthFilesPageByQuota(files, (file) =>
      weeklyRemainingPercent('devin', quota.get(getQuotaCacheKey(file)))
    );
    expect(sorted).toEqual([files[1], files[0]]);
  });

  test('keeps date order for equal/unknown quota and treats non-finite values as unknown', () => {
    const files = ['b', 'a', 'zero', 'nan', 'infinity'].map((name) => authFile({ name }));
    const balances: Record<string, number> = {
      a: 50,
      b: 50,
      zero: 0,
      nan: NaN,
      infinity: Infinity,
    };
    expect(
      sortAuthFilesPageByQuota(files, (file) => balances[file.name]).map((file) => file.name)
    ).toEqual(['b', 'a', 'zero', 'nan', 'infinity']);
    expect(sortAuthFiles(files, 'az').map((file) => file.name)).toEqual([
      'a',
      'b',
      'infinity',
      'nan',
      'zero',
    ]);
  });
});
