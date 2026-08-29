import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import {
  bootstrapKamproKey,
  fetchBusinessReport,
  saveSalesTargets,
  type BusinessPeriod,
  type BusinessReport,
} from '../services/kamproApi';
import { formatPyg } from '../utils/orderPricing';
import './BusinessDashboard.css';

const PERIODS: BusinessPeriod[] = ['day', 'week', 'month', 'year'];
const TARGET_FIELD: Record<BusinessPeriod, keyof BusinessReport['targets']> = {
  day: 'dayPyg',
  week: 'weekPyg',
  month: 'monthPyg',
  year: 'yearPyg',
};

const GREEN = '#25d366';
const NAVY = '#0e2c5b';
const AMBER = '#f59e0b';
const TEAL = '#0d9488';

function formatDelta(pct: number | null): string {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}%`;
}

function pygTooltip(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? formatPyg(n) : '—';
}

function tickLabel(date: string, period: BusinessPeriod): string {
  if (period === 'year') return date.slice(5, 7);
  if (period === 'month') return date.slice(8);
  return date.slice(5);
}

export function BusinessDashboard() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<BusinessPeriod>('month');
  const [online, setOnline] = useState<boolean | null>(null);
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    void bootstrapKamproKey().then(setOnline);
  }, []);

  useEffect(() => {
    if (online !== true) return;
    let cancelled = false;
    setError(null);
    void fetchBusinessReport(period)
      .then(data => {
        if (cancelled) return;
        setReport(data);
        setGoalDraft(data.targetPyg != null ? String(data.targetPyg) : '');
      })
      .catch(err => {
        if (cancelled) return;
        setReport(null);
        setError(err instanceof Error ? err.message : t('dashboard.business.empty'));
      });
    return () => {
      cancelled = true;
    };
  }, [online, period, t]);

  const productChart = useMemo(
    () =>
      (report?.byProduct ?? []).map(row => ({
        name: row.name,
        revenue: row.revenuePyg,
        units: row.units,
      })),
    [report],
  );

  const zoneChart = useMemo(
    () => [
      { name: t('dashboard.business.delivery'), value: report?.byZone.ASUNCION.revenuePyg ?? 0 },
      { name: t('dashboard.business.encomienda'), value: report?.byZone.INTERIOR.revenuePyg ?? 0 },
    ],
    [report, t],
  );

  const methodChart = useMemo(
    () => [
      { name: t('dashboard.business.transfer'), value: report?.byMethod.TRANSFERENCIA ?? 0 },
      { name: t('dashboard.business.cash'), value: report?.byMethod.EFECTIVO ?? 0 },
    ],
    [report, t],
  );

  const customerChart = useMemo(
    () => [
      { name: t('dashboard.business.newCustomers'), value: report?.customers.newRevenuePyg ?? 0 },
      { name: t('dashboard.business.returningCustomers'), value: report?.customers.returningRevenuePyg ?? 0 },
    ],
    [report, t],
  );

  const pipelineRows = useMemo(
    () => Object.entries(report?.pipeline ?? {}).sort((a, b) => b[1] - a[1]),
    [report],
  );

  async function onSaveGoal(event: FormEvent) {
    event.preventDefault();
    const raw = goalDraft.trim();
    const value = raw === '' ? null : Number(raw.replace(/\D/g, ''));
    if (value != null && (!Number.isFinite(value) || value <= 0)) return;
    setSavingGoal(true);
    try {
      await saveSalesTargets({ [TARGET_FIELD[period]]: value });
      const data = await fetchBusinessReport(period);
      setReport(data);
      setGoalDraft(data.targetPyg != null ? String(data.targetPyg) : '');
    } finally {
      setSavingGoal(false);
    }
  }

  if (online === false) {
    return <div className="biz-offline">{t('dashboard.business.offline')}</div>;
  }

  if (online === null || (online && !report && !error)) {
    return (
      <div className="biz-loading">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (error || !report) {
    return <div className="biz-offline">{error || t('dashboard.business.empty')}</div>;
  }

  const goalPct = Math.min(100, report.goalPct ?? 0);

  return (
    <div className="biz">
      <div className="biz-toolbar">
        <div className="biz-periods">
          {PERIODS.map(item => (
            <button
              key={item}
              type="button"
              className={item === period ? 'active' : undefined}
              onClick={() => setPeriod(item)}
            >
              {t(`dashboard.business.period.${item}`)}
            </button>
          ))}
        </div>
        <form className="biz-goal-form" onSubmit={onSaveGoal}>
          <label>
            {t('dashboard.business.goal')}
            <input
              inputMode="numeric"
              value={goalDraft}
              placeholder={t('dashboard.business.goalPlaceholder')}
              onChange={e => setGoalDraft(e.target.value)}
            />
          </label>
          <button type="submit" disabled={savingGoal}>
            {t('dashboard.business.goalSave')}
          </button>
        </form>
      </div>

      <div className="biz-kpis">
        <article>
          <span>{t('dashboard.business.revenue')}</span>
          <strong>{formatPyg(report.revenuePyg)}</strong>
          <small className={(report.revenueDeltaPct ?? 0) >= 0 ? 'up' : 'down'}>
            {t('dashboard.business.vsPrevious')}: {formatDelta(report.revenueDeltaPct)}
          </small>
        </article>
        <article>
          <span>{t('dashboard.business.goal')}</span>
          <strong>{report.targetPyg != null ? formatPyg(report.targetPyg) : t('dashboard.business.goalNone')}</strong>
          <small>
            {report.goalRemainingPyg != null
              ? `${t('dashboard.business.goalRemaining')}: ${formatPyg(report.goalRemainingPyg)}`
              : t('dashboard.business.goalNone')}
          </small>
        </article>
        <article>
          <span>{t('dashboard.business.avgTicket')}</span>
          <strong>{report.avgTicketPyg != null ? formatPyg(report.avgTicketPyg) : '—'}</strong>
          <small>
            {t('dashboard.business.paidOrders')}: {report.paidOrderCount}
          </small>
        </article>
        <article>
          <span>{t('dashboard.business.units')}</span>
          <strong>{report.unitsSold.toLocaleString('es-PY')}</strong>
          <small>
            {t('dashboard.business.vsPrevious')}: {formatDelta(
              report.previousUnitsSold === 0
                ? report.unitsSold === 0
                  ? 0
                  : null
                : Math.round(((report.unitsSold - report.previousUnitsSold) / report.previousUnitsSold) * 1000) / 10,
            )}
          </small>
        </article>
      </div>

      {report.targetPyg != null && (
        <div className="biz-goalbar" aria-label={t('dashboard.business.goal')}>
          <div style={{ width: `${goalPct}%` }} />
          <em>{report.goalPct != null ? `${report.goalPct}%` : ''}</em>
        </div>
      )}

      <div className="biz-grid">
        <section>
          <h3>{t('dashboard.business.overTime')}</h3>
          <div className="biz-chart">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={report.series.map(row => ({ ...row, label: tickLabel(row.date, period) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={pygTooltip} />
                <Area type="monotone" dataKey="revenuePyg" stroke={GREEN} fill={GREEN} fillOpacity={0.18} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section>
          <h3>{t('dashboard.business.byProduct')}</h3>
          <div className="biz-chart">
            {productChart.length === 0 ? (
              <p className="biz-empty">{t('dashboard.business.empty')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={productChart} layout="vertical" margin={{ left: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={pygTooltip} />
                  <Bar dataKey="revenue" fill={NAVY} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <div className="biz-grid biz-grid-3">
        <section>
          <h3>{t('dashboard.business.byZone')}</h3>
          <PieBlock data={zoneChart} colors={[GREEN, NAVY]} />
        </section>
        <section>
          <h3>{t('dashboard.business.byMethod')}</h3>
          <PieBlock data={methodChart} colors={[TEAL, AMBER]} />
        </section>
        <section>
          <h3>{t('dashboard.business.customers')}</h3>
          <PieBlock data={customerChart} colors={[GREEN, NAVY]} />
          <p className="biz-caption">
            {t('dashboard.business.newCustomers')}: {report.customers.new} · {t('dashboard.business.returningCustomers')}
            : {report.customers.returning}
          </p>
        </section>
      </div>

      <div className="biz-grid">
        <section>
          <h3>{t('dashboard.business.pending')}</h3>
          <p className="biz-stat">{formatPyg(report.pendingCollection.amountPyg)}</p>
          <p className="biz-caption">
            {report.pendingCollection.count} · {t('dashboard.business.delivery')}{' '}
            {formatPyg(report.pendingCollection.deliveryPyg)} · {t('dashboard.business.encomienda')}{' '}
            {formatPyg(report.pendingCollection.encomiendaPyg)}
          </p>
          <p className="biz-hint">{t('dashboard.business.pendingHint')}</p>
        </section>
        <section>
          <h3>{t('dashboard.business.pipeline')}</h3>
          {pipelineRows.length === 0 ? (
            <p className="biz-empty">{t('dashboard.business.empty')}</p>
          ) : (
            <ul className="biz-list">
              {pipelineRows.map(([status, count]) => (
                <li key={status}>
                  <span>{t(`orders.status.${status}`, { defaultValue: status })}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="biz-grid biz-grid-3">
        <section>
          <h3>{t('dashboard.business.stock')}</h3>
          {report.stock.length === 0 ? (
            <p className="biz-empty">{t('dashboard.business.noStock')}</p>
          ) : (
            <ul className="biz-list">
              {report.stock.map(row => (
                <li key={row.sku}>
                  <span>
                    {row.name}
                    <em>{row.sku}</em>
                  </span>
                  <strong>{row.stockQty}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3>{t('dashboard.business.importSpend')}</h3>
          <p className="biz-stat">{formatPyg(report.importSpend.pyg)}</p>
          {report.importSpend.missingFx && <p className="biz-hint">{t('dashboard.business.importMissingFx')}</p>}
        </section>
        <section>
          <h3>{t('dashboard.business.invoices')}</h3>
          <p className="biz-stat">{report.invoicesIssued}</p>
          <p className="biz-caption">
            {t('dashboard.business.followUps')}: {report.followUpChats}
          </p>
        </section>
      </div>

      <p className="biz-notes">
        {t('dashboard.business.noteRevenue')} {t('dashboard.business.noteCustomers')} {t('dashboard.business.noteUnits')}
      </p>
    </div>
  );
}

function PieBlock({ data, colors }: { data: Array<{ name: string; value: number }>; colors: string[] }) {
  const { t } = useTranslation();
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="biz-empty">{t('dashboard.business.empty')}</p>;
  return (
    <div className="biz-chart biz-chart-sm">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip formatter={pygTooltip} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
