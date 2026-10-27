import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import type { QuotaFileEntry } from './logic';
import type { QuotaProviderType } from './providers/types';

const WEEK_HOURS = 168;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const remaining = (used: unknown): number | null => (finite(used) ? clamp(100 - used) : null);
const minimum = (values: (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.min(...known) : null;
};

/** Compare percentages across plans; never substitute daily or monthly capacity. */
export function weeklyRemainingPercent(provider: QuotaProviderType, quota: unknown): number | null {
  if (!quota || (quota as { status?: string }).status !== 'success') return null;

  switch (provider) {
    case 'claude': {
      const windows = (quota as ClaudeQuotaState).windows;
      const account = windows.find((window) => window.id === 'seven-day');
      if (account) return remaining(account.usedPercent);
      return minimum(
        windows
          .filter((window) => window.periodHours === WEEK_HOURS)
          .map((window) => remaining(window.usedPercent))
      );
    }
    case 'codex': {
      // Code review and feature-specific limits do not represent account capacity.
      const window = (quota as CodexQuotaState).windows.find((item) => item.id === 'weekly');
      return window ? remaining(window.usedPercent) : null;
    }
    case 'devin': {
      const value = (quota as DevinQuotaState).windows.find(
        (item) => item.id === 'weekly'
      )?.remainingPercent;
      return finite(value) ? clamp(value) : null;
    }
    case 'meta':
      return remaining(
        (quota as MetaQuotaState).data?.windows.find((item) => item.id === 'weekly')?.usedPercent
      );
    case 'xai': {
      const billing = (quota as XaiQuotaState).billing;
      return billing?.periodType === 'weekly' ? remaining(billing.usagePercent) : null;
    }
    case 'antigravity':
      return minimum(
        (quota as AntigravityQuotaState).groups.flatMap((group) =>
          group.buckets
            .filter((bucket) => bucket.periodHours === WEEK_HOURS)
            .map((bucket) =>
              finite(bucket.remainingFraction) ? clamp(bucket.remainingFraction * 100) : null
            )
        )
      );
    case 'kimi':
      return minimum(
        (quota as KimiQuotaState).rows
          .filter((row) => row.periodHours === WEEK_HOURS)
          .map((row) =>
            finite(row.used) && finite(row.limit) && row.limit > 0
              ? clamp(((row.limit - row.used) / row.limit) * 100)
              : null
          )
      );
  }
}

/** Load every eligible account in bounded batches, including accounts beyond page one. */
export function unloadedQuotaEntries(
  entries: QuotaFileEntry[],
  getQuota: (entry: QuotaFileEntry) => { status: string } | undefined,
  batchSize: number
): QuotaFileEntry[] {
  return entries
    .filter((entry) => {
      const status = getQuota(entry)?.status;
      return status === undefined || status === 'idle';
    })
    .slice(0, batchSize);
}
