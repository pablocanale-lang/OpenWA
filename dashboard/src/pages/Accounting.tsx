import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { useRole } from '../hooks/useRole';
import {
  bootstrapKamproKey,
  kamproFetch,
  type KamproAccount,
  type KamproExpense,
  type KamproJournalEntry,
  type KamproLedger,
  type KamproStatements,
  type TreasuryAccount,
} from '../services/kamproApi';
import { formatPyg } from '../utils/orderPricing';
import './Accounting.css';

type Tab = 'journal' | 'ledger' | 'statements' | 'expenses' | 'accounts' | 'manual';

function monthBounds() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function isoDay(from: string, endOfDay = false) {
  return endOfDay ? `${from}T23:59:59` : `${from}T00:00:00`;
}

export function Accounting() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.accounting'));
  const toast = useToast();
  const { canWrite } = useRole();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('journal');
  const bounds = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [expenseKind, setExpenseKind] = useState<KamproExpense['kind']>('GENERAL');
  const [manualLines, setManualLines] = useState([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);

  useEffect(() => {
    void bootstrapKamproKey().then(setOnline);
  }, []);

  const enabled = online === true;
  const range = { from: isoDay(from), to: isoDay(to, true) };

  const accountsQ = useQuery({
    queryKey: ['kampro', 'accounts'],
    queryFn: () => kamproFetch<KamproAccount[]>('/accounting/accounts'),
    enabled,
  });
  const entriesQ = useQuery({
    queryKey: ['kampro', 'entries', range.from, range.to],
    queryFn: () =>
      kamproFetch<KamproJournalEntry[]>(
        `/accounting/entries?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
    enabled,
  });
  const statementsQ = useQuery({
    queryKey: ['kampro', 'statements', range.from, range.to],
    queryFn: () =>
      kamproFetch<KamproStatements>(
        `/accounting/statements?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
    enabled: enabled && tab === 'statements',
  });
  const expensesQ = useQuery({
    queryKey: ['kampro', 'expenses'],
    queryFn: () => kamproFetch<KamproExpense[]>('/accounting/expenses'),
    enabled: enabled && (tab === 'expenses' || tab === 'journal'),
  });
  const ledgerQ = useQuery({
    queryKey: ['kampro', 'ledger', ledgerAccountId, range.from, range.to],
    queryFn: () =>
      kamproFetch<KamproLedger>(
        `/accounting/ledger/${ledgerAccountId}?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
    enabled: enabled && tab === 'ledger' && Boolean(ledgerAccountId),
  });

  const accounts = accountsQ.data ?? [];
  const postable = accounts.filter(a => a.postable);
  const expenseAccounts = accounts.filter(a => a.type === 'EXPENSE' || a.type === 'COST');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['kampro'] });

  const createExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setSaving(true);
    try {
      await kamproFetch('/accounting/expenses', {
        method: 'POST',
        body: JSON.stringify({
          kind: String(data.kind),
          datedAt: isoDay(String(data.datedAt)),
          description: String(data.description),
          amountGrossPyg: Number(data.amountGrossPyg),
          ivaIncluded: data.ivaIncluded === 'on',
          treasury: String(data.treasury) as TreasuryAccount,
          accountId: String(data.accountId || '') || undefined,
          vendor: String(data.vendor || '') || null,
          reference: String(data.reference || '') || null,
        }),
      });
      event.currentTarget.reset();
      setExpenseKind('GENERAL');
      refresh();
      toast.success(t('accounting.toast.expenseSaved'));
    } catch (err) {
      toast.error(t('accounting.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setSaving(true);
    try {
      await kamproFetch('/accounting/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: String(data.name),
          type: String(data.type),
          parentId: String(data.parentId || '') || null,
        }),
      });
      event.currentTarget.reset();
      refresh();
      toast.success(t('accounting.toast.accountSaved'));
    } catch (err) {
      toast.error(t('accounting.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const createManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setSaving(true);
    try {
      await kamproFetch('/accounting/manual', {
        method: 'POST',
        body: JSON.stringify({
          datedAt: isoDay(String(data.datedAt)),
          memo: String(data.memo),
          lines: manualLines.map(line => ({
            accountId: line.accountId,
            debit: Number(line.debit || 0),
            credit: Number(line.credit || 0),
          })),
        }),
      });
      setManualLines([
        { accountId: '', debit: '', credit: '' },
        { accountId: '', debit: '', credit: '' },
      ]);
      event.currentTarget.reset();
      refresh();
      toast.success(t('accounting.toast.manualSaved'));
    } catch (err) {
      toast.error(t('accounting.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const tabs: Tab[] = ['journal', 'ledger', 'statements', 'expenses', 'accounts', 'manual'];
  const statements = statementsQ.data;

  return (
    <div className="accounting-page">
      <PageHeader
        title={t('nav.accounting')}
        subtitle={t('accounting.subtitle')}
        badge={
          <span className={`status-badge ${online ? 'connected' : 'offline'}`}>
            {online ? t('kampro.connected') : t('kampro.offline')}
          </span>
        }
      />

      {!online && <p className="accounting-offline">{t('accounting.offlineHint')}</p>}

      {online && (
        <>
          <div className="accounting-range">
            <label>
              {t('accounting.from')}
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label>
              {t('accounting.to')}
              <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </div>

          <div className="tabs">
            {tabs.map(id => (
              <button key={id} type="button" className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                {t(`accounting.tabs.${id}`)}
              </button>
            ))}
          </div>

          {tab === 'journal' && (
            <div className="table-wrap">
              {(entriesQ.data ?? []).length === 0 ? (
                <p className="accounting-empty">{t('accounting.emptyJournal')}</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{t('accounting.col.number')}</th>
                      <th>{t('accounting.col.date')}</th>
                      <th>{t('accounting.col.memo')}</th>
                      <th>{t('accounting.col.origin')}</th>
                      <th>{t('accounting.col.debit')}</th>
                      <th>{t('accounting.col.credit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(entriesQ.data ?? []).map(entry => {
                      const debit = entry.lines.reduce((s, l) => s + l.debit, 0);
                      return (
                        <tr key={entry.id}>
                          <td>{entry.numberLabel}</td>
                          <td>{entry.datedAt.slice(0, 10)}</td>
                          <td>
                            {entry.memo}
                            <div className="accounting-lines">
                              {entry.lines.map(line => (
                                <div key={line.id}>
                                  {line.account.code} {line.account.name} — {line.debit ? formatPyg(line.debit) : formatPyg(line.credit)}{' '}
                                  {line.debit ? t('accounting.debit') : t('accounting.credit')}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td>
                            {entry.sourceType} · {entry.event}
                          </td>
                          <td>{formatPyg(debit)}</td>
                          <td>{formatPyg(debit)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'ledger' && (
            <>
              <label className="accounting-select">
                {t('accounting.account')}
                <select value={ledgerAccountId} onChange={e => setLedgerAccountId(e.target.value)}>
                  <option value="">{t('accounting.pickAccount')}</option>
                  {postable.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </select>
              </label>
              {ledgerQ.data ? (
                <div className="table-wrap">
                  <p>
                    {t('accounting.balance')}: <strong>{formatPyg(ledgerQ.data.balance)}</strong>
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('accounting.col.date')}</th>
                        <th>{t('accounting.col.number')}</th>
                        <th>{t('accounting.col.memo')}</th>
                        <th>{t('accounting.col.debit')}</th>
                        <th>{t('accounting.col.credit')}</th>
                        <th>{t('accounting.balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerQ.data.rows.map((row, index) => (
                        <tr key={index}>
                          <td>{row.entry.datedAt.slice(0, 10)}</td>
                          <td>{row.entry.numberLabel}</td>
                          <td>{row.memo || row.entry.memo}</td>
                          <td>{row.debit ? formatPyg(row.debit) : ''}</td>
                          <td>{row.credit ? formatPyg(row.credit) : ''}</td>
                          <td>{formatPyg(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="accounting-empty">{t('accounting.pickAccount')}</p>
              )}
            </>
          )}

          {tab === 'statements' && statements && (
            <div className="accounting-statements">
              <section>
                <h2>{t('accounting.incomeStatement')}</h2>
                <p>
                  {t('accounting.revenue')}: <strong>{formatPyg(statements.incomeStatement.revenue)}</strong>
                </p>
                <p>
                  {t('accounting.cogs')}: <strong>{formatPyg(statements.incomeStatement.costTotal)}</strong>
                </p>
                <p>
                  {t('accounting.grossMargin')}: <strong>{formatPyg(statements.incomeStatement.grossMargin)}</strong>
                </p>
                <p>
                  {t('accounting.expenses')}: <strong>{formatPyg(statements.incomeStatement.expenseTotal)}</strong>
                </p>
                <p>
                  {t('accounting.netIncome')}: <strong>{formatPyg(statements.incomeStatement.netIncome)}</strong>
                </p>
              </section>
              <section>
                <h2>{t('accounting.balanceSheet')}</h2>
                <p>
                  {t('accounting.assets')}: <strong>{formatPyg(statements.balanceSheet.assetTotal)}</strong>
                </p>
                {(statements.balanceSheet.assets.filter(a => a.balance) ?? []).map(row => (
                  <p key={row.code}>
                    {row.code} {row.name}: {formatPyg(row.balance)}
                  </p>
                ))}
                <p>
                  {t('accounting.liabilities')}: <strong>{formatPyg(statements.balanceSheet.liabilityTotal)}</strong>
                </p>
                {statements.balanceSheet.liabilities.filter(a => a.balance).map(row => (
                  <p key={row.code}>
                    {row.code} {row.name}: {formatPyg(row.balance)}
                  </p>
                ))}
                <p>
                  {t('accounting.equity')}: <strong>{formatPyg(statements.balanceSheet.equityTotal)}</strong>
                </p>
              </section>
              <section>
                <h2>{t('accounting.cashFlow')}</h2>
                <p>
                  {t('accounting.operating')}: <strong>{formatPyg(statements.cashFlow.operating)}</strong>
                </p>
                <p>
                  {t('accounting.investing')}: <strong>{formatPyg(statements.cashFlow.investing)}</strong>
                </p>
                <p>
                  {t('accounting.financing')}: <strong>{formatPyg(statements.cashFlow.financing)}</strong>
                </p>
                <p>
                  {t('accounting.netCash')}: <strong>{formatPyg(statements.cashFlow.net)}</strong>
                </p>
              </section>
            </div>
          )}

          {tab === 'expenses' && (
            <>
              {canWrite && (
                <form className="accounting-form" onSubmit={createExpense}>
                  <h2>{t('accounting.addExpense')}</h2>
                  <div className="form-grid">
                    <label>
                      {t('accounting.kind')}
                      <select
                        name="kind"
                        value={expenseKind}
                        onChange={e => setExpenseKind(e.target.value as KamproExpense['kind'])}
                      >
                        <option value="GENERAL">{t('accounting.kinds.GENERAL')}</option>
                        <option value="SALARIO">{t('accounting.kinds.SALARIO')}</option>
                        <option value="PUBLICIDAD">{t('accounting.kinds.PUBLICIDAD')}</option>
                        <option value="OTRO">{t('accounting.kinds.OTRO')}</option>
                      </select>
                    </label>
                    <label>
                      {t('accounting.col.date')}
                      <input name="datedAt" type="date" defaultValue={bounds.to} required />
                    </label>
                    <label>
                      {t('accounting.amount')}
                      <input name="amountGrossPyg" type="number" min={1} required />
                    </label>
                    <label>
                      {t('accounting.treasury')}
                      <select name="treasury" defaultValue="BANCO">
                        <option value="CAJA">{t('accounting.caja')}</option>
                        <option value="BANCO">{t('accounting.banco')}</option>
                      </select>
                    </label>
                    <label>
                      {t('accounting.account')}
                      <select name="accountId">
                        <option value="">{t('accounting.defaultAccount')}</option>
                        {expenseAccounts.map(account => (
                          <option key={account.id} value={account.id}>
                            {account.code} {account.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="full">
                      {t('accounting.description')}
                      <input name="description" required />
                    </label>
                    <label>
                      {t('accounting.vendor')}
                      <input name="vendor" />
                    </label>
                    <label>
                      {t('accounting.reference')}
                      <input name="reference" />
                    </label>
                    <label className="check">
                      <input
                        key={expenseKind}
                        name="ivaIncluded"
                        type="checkbox"
                        defaultChecked={expenseKind !== 'SALARIO'}
                      />
                      {t('accounting.ivaIncluded')}
                    </label>
                  </div>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                    {t('accounting.saveExpense')}
                  </button>
                </form>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('accounting.col.date')}</th>
                      <th>{t('accounting.kind')}</th>
                      <th>{t('accounting.description')}</th>
                      <th>{t('accounting.amount')}</th>
                      <th>{t('accounting.treasury')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(expensesQ.data ?? []).map(expense => (
                      <tr key={expense.id}>
                        <td>{expense.datedAt.slice(0, 10)}</td>
                        <td>{t(`accounting.kinds.${expense.kind}`)}</td>
                        <td>{expense.description}</td>
                        <td>{formatPyg(expense.amountGrossPyg)}</td>
                        <td>{expense.treasury === 'CAJA' ? t('accounting.caja') : t('accounting.banco')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'accounts' && (
            <>
              {canWrite && (
                <form className="accounting-form" onSubmit={createAccount}>
                  <h2>{t('accounting.addAccount')}</h2>
                  <div className="form-grid">
                    <label>
                      {t('accounting.name')}
                      <input name="name" required />
                    </label>
                    <label>
                      {t('accounting.type')}
                      <select name="type" defaultValue="EXPENSE">
                        <option value="ASSET">{t('accounting.types.ASSET')}</option>
                        <option value="LIABILITY">{t('accounting.types.LIABILITY')}</option>
                        <option value="EQUITY">{t('accounting.types.EQUITY')}</option>
                        <option value="INCOME">{t('accounting.types.INCOME')}</option>
                        <option value="COST">{t('accounting.types.COST')}</option>
                        <option value="EXPENSE">{t('accounting.types.EXPENSE')}</option>
                      </select>
                    </label>
                    <label>
                      {t('accounting.parent')}
                      <select name="parentId">
                        <option value="">{t('accounting.noParent')}</option>
                        {accounts.map(account => (
                          <option key={account.id} value={account.id}>
                            {account.code} {account.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                    {t('accounting.saveAccount')}
                  </button>
                </form>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('accounting.code')}</th>
                      <th>{t('accounting.name')}</th>
                      <th>{t('accounting.type')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(account => (
                      <tr key={account.id}>
                        <td>{account.code}</td>
                        <td>{account.name}</td>
                        <td>{t(`accounting.types.${account.type}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'manual' && canWrite && (
            <form className="accounting-form" onSubmit={createManual}>
              <h2>{t('accounting.manualTitle')}</h2>
              <p className="hint">{t('accounting.manualHint')}</p>
              <div className="form-grid">
                <label>
                  {t('accounting.col.date')}
                  <input name="datedAt" type="date" defaultValue={bounds.to} required />
                </label>
                <label className="full">
                  {t('accounting.description')}
                  <input name="memo" required />
                </label>
              </div>
              {manualLines.map((line, index) => (
                <div key={index} className="form-grid">
                  <label>
                    {t('accounting.account')}
                    <select
                      value={line.accountId}
                      onChange={e =>
                        setManualLines(list => list.map((row, i) => (i === index ? { ...row, accountId: e.target.value } : row)))
                      }
                      required
                    >
                      <option value="">{t('accounting.pickAccount')}</option>
                      {postable.map(account => (
                        <option key={account.id} value={account.id}>
                          {account.code} {account.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('accounting.col.debit')}
                    <input
                      type="number"
                      min={0}
                      value={line.debit}
                      onChange={e =>
                        setManualLines(list => list.map((row, i) => (i === index ? { ...row, debit: e.target.value } : row)))
                      }
                    />
                  </label>
                  <label>
                    {t('accounting.col.credit')}
                    <input
                      type="number"
                      min={0}
                      value={line.credit}
                      onChange={e =>
                        setManualLines(list => list.map((row, i) => (i === index ? { ...row, credit: e.target.value } : row)))
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setManualLines(list => [...list, { accountId: '', debit: '', credit: '' }])}
              >
                {t('accounting.addLine')}
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('accounting.saveManual')}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
