import { apiClient } from './client';

export interface HistoryGroup {
  plan: string;
  accounts: number;
  measured: number;
  failed: number;
  exhausted: number;
  remaining: number;
  total: number;
  today: number | null;
  lastWeek: number | null;
  comparable: number;
  comparableAccounts: number;
}
export interface HistoryAccount {
  id: string;
  label: string;
  plan: string;
  status: string;
  weekly: number | null;
  daily: number | null;
  resetAt: string;
  today: number | null;
}
export interface HistoryPoint {
  at: string;
  plan: string;
  remaining: number;
  total: number;
  complete: boolean;
  previousWeek: boolean;
}
export interface QuotaHistory {
  timezone: string;
  observedAt: string | null;
  dayStart: string | null;
  lastWeekAt: string | null;
  stale: boolean;
  rosterChanged: boolean;
  groups: HistoryGroup[];
  accounts: HistoryAccount[];
  points: HistoryPoint[];
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : [];
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const nullable = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function readQuotaHistory(value: unknown): QuotaHistory {
  const data = record(value);
  const sample = record(data.sample);
  return {
    timezone: str(data.timezone),
    observedAt: str(sample.finished_at) || null,
    dayStart: str(data.day_start) || null,
    lastWeekAt: str(data.last_week_at) || null,
    stale: data.stale === true,
    rosterChanged: sample.roster_changed === true,
    groups: list(data.groups).map((g) => ({
      plan: str(g.plan),
      accounts: num(g.accounts),
      measured: num(g.measured),
      failed: num(g.failed),
      exhausted: num(g.exhausted),
      remaining: num(g.remaining),
      total: num(g.total),
      today: nullable(g.today),
      lastWeek: nullable(g.last_week),
      comparable: num(g.comparable),
      comparableAccounts: num(g.comparable_accounts),
    })),
    accounts: list(data.accounts).map((a) => ({
      id: str(a.id),
      label: str(a.label),
      plan: str(a.plan),
      status: str(a.status),
      weekly: nullable(a.weekly),
      daily: nullable(a.daily),
      resetAt: str(a.reset_at),
      today: nullable(a.today),
    })),
    points: list(data.points).map((p) => ({
      at: str(p.at),
      plan: str(p.plan),
      remaining: num(p.remaining),
      total: num(p.total),
      complete: p.complete === true,
      previousWeek: p.previous_week === true,
    })),
  };
}
export const quotaHistoryApi = {
  get: async (timezone: string) =>
    readQuotaHistory(await apiClient.get('/quota/history', { params: { timezone } })),
};

export function historySegments(points: HistoryPoint[], timezone: string): string[] {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const segments: string[] = [];
  let segment: string[] = [];
  let previous = 0;
  const flush = () => {
    if (segment.length) segments.push(segment.join(' '));
    segment = [];
  };
  for (const p of [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const instant = Date.parse(p.at);
    if (!p.complete || p.total <= 0 || !Number.isFinite(instant)) {
      flush();
      continue;
    }
    if (previous && instant - previous > 2 * 3600_000) flush();
    const parts = fmt.formatToParts(new Date(instant));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    segment.push(
      `${40 + ((hour * 60 + minute) / 1440) * 640},${130 - (p.remaining / p.total) * 110}`
    );
    previous = instant;
  }
  flush();
  return segments;
}
