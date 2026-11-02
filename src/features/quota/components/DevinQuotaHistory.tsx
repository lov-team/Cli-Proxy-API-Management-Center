import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useAuthStore, useQuotaStore } from '@/stores';
import { historySegments, quotaHistoryApi, type QuotaHistory } from '@/services/api/quotaHistory';
import styles from './DevinQuotaHistory.module.scss';

export function DevinQuotaHistory() {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.connectionStatus);
  const generation = useQuotaStore((s) => s.cacheGeneration);
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [data, setData] = useState<QuotaHistory | null>(null);
  const [dataGeneration, setDataGeneration] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState('max');
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    if (status !== 'connected') return;
    const current = () =>
      id === request.current && generation === useQuotaStore.getState().cacheGeneration;
    setLoading(true);
    setError('');
    try {
      const result = await quotaHistoryApi.get(timezone);
      if (!current()) return;
      setData(result);
      setDataGeneration(generation);
    } catch {
      if (current()) setError(t('quota_history.error'));
    } finally {
      if (current()) setLoading(false);
    }
  }, [generation, status, t, timezone]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      request.current += 1;
      window.clearInterval(timer);
    };
  }, [load]);
  const visible =
    status === 'connected' && dataGeneration === generation && data?.timezone === timezone
      ? data
      : null;
  const fmt = (v: number | null) =>
    v === null
      ? t('quota_history.unavailable')
      : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const date = (value: string | null) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString(undefined, { timeZone: timezone })
      : t('quota_history.unavailable');
  const selectedPlan = visible?.groups.some((g) => g.plan === plan)
    ? plan
    : visible?.groups[0]?.plan;
  const points = visible?.points.filter((p) => p.plan === selectedPlan) ?? [];
  return (
    <section className={styles.panel} aria-labelledby="devin-history-title">
      <div className={styles.header}>
        <div>
          <h2 id="devin-history-title">{t('quota_history.title')}</h2>
          <p>{t('quota_history.description')}</p>
        </div>
        <div className={styles.controls}>
          <Select
            value={timezone}
            onChange={setTimezone}
            ariaLabel={t('quota_history.timezone')}
            options={[
              { value: 'Asia/Shanghai', label: t('quota_history.beijing') },
              { value: 'America/New_York', label: t('quota_history.new_york') },
              { value: 'UTC', label: 'UTC' },
            ]}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            loading={loading}
            disabled={status !== 'connected'}
          >
            {t('quota_history.refresh')}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.warning}>
          {error}
        </p>
      )}
      {visible && (
        <>
          <p className={styles.meta}>
            {t('quota_history.observed', { time: date(visible.observedAt) })}
          </p>
          {(visible.stale || visible.rosterChanged) && (
            <p role="status" className={styles.warning}>
              {t('quota_history.stale')}
            </p>
          )}
          {!visible.observedAt && <p>{t('quota_history.empty')}</p>}
          <div className={styles.groups}>
            {visible.groups.map((g) => (
              <article key={g.plan} className={styles.group}>
                <h3>
                  {g.plan.toUpperCase()}{' '}
                  <span>{t('quota_history.account_count', { count: g.accounts })}</span>
                </h3>
                <dl>
                  <div>
                    <dt>{t('quota_history.remaining')}</dt>
                    <dd>
                      {fmt(g.remaining)} / {fmt(g.total)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('quota_history.today')}</dt>
                    <dd>{fmt(g.today)}</dd>
                  </div>
                  <div>
                    <dt>{t('quota_history.last_week')}</dt>
                    <dd>{fmt(g.lastWeek)}</dd>
                  </div>
                  <div>
                    <dt>{t('quota_history.exhausted')}</dt>
                    <dd>{g.exhausted}</dd>
                  </div>
                </dl>
                {g.failed > 0 && (
                  <p className={styles.warning}>{t('quota_history.failed', { count: g.failed })}</p>
                )}
                {g.today === null && g.comparableAccounts > 0 && (
                  <p>
                    {t('quota_history.comparable', {
                      count: g.comparableAccounts,
                      value: fmt(g.comparable),
                    })}
                  </p>
                )}
                {g.today !== null &&
                  g.lastWeek !== null &&
                  g.lastWeek >= 20 &&
                  g.today > g.lastWeek * 2 && (
                    <p className={styles.warning}>{t('quota_history.accelerated')}</p>
                  )}
              </article>
            ))}
          </div>
          {visible.groups.length > 0 && (
            <>
              <div className={styles.header}>
                <h3>{t('quota_history.trend')}</h3>
                <Select
                  value={selectedPlan ?? ''}
                  onChange={setPlan}
                  ariaLabel={t('quota_history.plan')}
                  options={visible.groups.map((g) => ({
                    value: g.plan,
                    label: g.plan.toUpperCase(),
                  }))}
                />
              </div>
              <div className={styles.legend}>
                <span>{t('quota_history.today_line')}</span>
                <span>{t('quota_history.last_week_line')}</span>
              </div>
              <svg
                className={styles.chart}
                viewBox="0 0 710 165"
                role="img"
                aria-label={t('quota_history.trend')}
              >
                {[0, 50, 100].map((v) => (
                  <g key={v}>
                    <line
                      x1="40"
                      x2="680"
                      y1={130 - v * 1.1}
                      y2={130 - v * 1.1}
                      className={styles.grid}
                    />
                    <text x="2" y={135 - v * 1.1}>
                      {v}%
                    </text>
                  </g>
                ))}
                {[0, 6, 12, 18, 24].map((h) => (
                  <text key={h} x={40 + (h / 24) * 640} y="155" textAnchor="middle">
                    {String(h).padStart(2, '0')}:00
                  </text>
                ))}
                {[false, true].flatMap((past) =>
                  historySegments(
                    points.filter((p) => p.previousWeek === past),
                    timezone
                  ).map((segment, i) => (
                    <g key={`${past}-${i}`} className={past ? styles.past : styles.current}>
                      <polyline
                        points={segment}
                        fill="none"
                        strokeWidth="2.5"
                        strokeDasharray={past ? '6 4' : undefined}
                      />
                      {segment.split(' ').map((point) => {
                        const [cx, cy] = point.split(',');
                        return <circle key={point} cx={cx} cy={cy} r="3" />;
                      })}
                    </g>
                  ))
                )}
              </svg>
              <p className={styles.meta}>{t('quota_history.method')}</p>
              <details>
                <summary>{t('quota_history.accounts')}</summary>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        {['account', 'plan', 'weekly', 'today', 'reset'].map((key) => (
                          <th key={key}>{t(`quota_history.${key}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.accounts.map((a) => (
                        <tr key={a.id}>
                          <td>{a.label}</td>
                          <td>{a.plan.toUpperCase()}</td>
                          <td>
                            {a.status === 'ok'
                              ? `${fmt(a.weekly)}%`
                              : t('quota_history.unavailable')}
                          </td>
                          <td>{fmt(a.today)}</td>
                          <td>{date(a.resetAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
