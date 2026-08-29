import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
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
import { formatPyg, parsePygInput } from '../utils/orderPricing';
import './Accounting.css';

type Tab = 'journal' | 'ledger' | 'income' | 'balance' | 'cashflow' | 'expenses' | 'accounts' | 'manual';
const STATEMENT_TABS: Tab[] = ['income', 'balance', 'cashflow'];

function StatementRows({
  rows,
  total,
  totalLabel,
  codeLabel,
  nameLabel,
  balanceLabel,
}: {
  rows: Array<{ code: string; name: string; balance: number }>;
  total: number;
  totalLabel: string;
  codeLabel: string;
  nameLabel: string;
  balanceLabel: string;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{codeLabel}</th>
            <th>{nameLabel}</th>
            <th className="num">{balanceLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.code}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td className="num">{formatPyg(row.balance)}</td>
            </tr>
          ))}
          <tr className="accounting-total">
            <td colSpan={2}>{totalLabel}</td>
            <td className="num">{formatPyg(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

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
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KamproJournalEntry | null>(null);

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
    enabled: enabled && STATEMENT_TABS.includes(tab),
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
    if (saving) return;
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const amountGrossPyg = parsePygInput(data.amountGrossPyg);
    if (!Number.isInteger(amountGrossPyg) || amountGrossPyg < 1) {
      toast.error(t('accounting.toast.error'), t('accounting.amountHint'));
      return;
    }
    const treasury = String(data.treasury) as TreasuryAccount;
    const description = String(data.description);
    setSaving(true);
    try {
      await kamproFetch('/accounting/expenses', {
        method: 'POST',
        body: JSON.stringify({
          kind: String(data.kind),
          datedAt: isoDay(String(data.datedAt)),
          description,
          amountGrossPyg,
          ivaIncluded: data.ivaIncluded === 'on',
          treasury,
          accountId: String(data.accountId || '') || undefined,
          vendor: String(data.vendor || '') || null,
          reference: String(data.reference || '') || null,
        }),
      });
      event.currentTarget.reset();
      setExpenseKind('GENERAL');
      const treasuryAccount = accounts.find(account => account.role === treasury);
      if (treasuryAccount) setLedgerAccountId(treasuryAccount.id);
      setLastSaved(t('accounting.lastSaved', { description, amount: formatPyg(amountGrossPyg) }));
      setTab('journal');
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

  const undoExpense = async (id: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await kamproFetch(`/accounting/expenses/${id}`, { method: 'DELETE' });
      refresh();
      toast.success(t('accounting.toast.expenseUndone'));
    } catch (err) {
      toast.error(t('accounting.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entry: KamproJournalEntry) => {
    if (saving) return;
    setSaving(true);
    try {
      await kamproFetch(`/accounting/entries/${entry.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      refresh();
      toast.success(t('accounting.toast.entryDeleted'));
    } catch (err) {
      toast.error(t('accounting.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const createManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
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
            debit: parsePygInput(line.debit || 0),
            credit: parsePygInput(line.credit || 0),
          })),
        }),
      });
      setManualLines([
        { accountId: '', debit: '', credit: '' },
        { accountId: '', debit: '', credit: '' },
      ]);
      event.currentTarget.reset();
      setLastSaved(t('accounting.lastSaved', { description: String(data.memo), amount: '' }));
      setTab('journal');
      refresh();
      toast.success(t('accounting.toast.manualSaved'));
    } catch (err) {
      toast.error(t('accounting.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const tabs: Tab[] = ['journal', 'ledger', 'income', 'balance', 'cashflow', 'expenses', 'accounts', 'manual'];
  const statements = statementsQ.data;
  const rowLabels = {
    codeLabel: t('accounting.col.accountCode'),
    nameLabel: t('accounting.col.accountName'),
    balanceLabel: t('accounting.balance'),
  };

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

          {lastSaved && <p className="accounting-last-saved">{lastSaved}</p>}
          {STATEMENT_TABS.includes(tab) && !statements && <p className="accounting-empty">{t('common.loading')}</p>}

          {tab === 'journal' && (
            <div className="table-wrap">
              {(entriesQ.data ?? []).length === 0 ? (
                <p className="accounting-empty">{t('accounting.emptyJournal')}</p>
              ) : (
                <table className="accounting-journal">
                  <thead>
                    <tr>
                      <th>{t('accounting.col.number')}</th>
                      <th>{t('accounting.col.date')}</th>
                      <th>{t('accounting.col.accountCode')}</th>
                      <th>{t('accounting.col.accountName')}</th>
                      <th>{t('accounting.col.concept')}</th>
                      <th>{t('accounting.col.description')}</th>
                      <th className="num">{t('accounting.col.debit')}</th>
                      <th className="num">{t('accounting.col.credit')}</th>
                      <th>{t('accounting.col.document')}</th>
                      {canWrite ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {(entriesQ.data ?? []).flatMap((entry, index) =>
                      entry.lines.map((line, lineIndex) => (
                        <tr
                          key={line.id}
                          className={[
                            lineIndex === 0 ? 'accounting-entry-start' : undefined,
                            entry.reversed ? 'accounting-reversed' : undefined,
                            index === 0 && lastSaved ? 'accounting-row-new' : undefined,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <td>
                            {lineIndex === 0 ? entry.numberLabel : ''}
                            {lineIndex === 0 && entry.reversed ? (
                              <span className="accounting-badge">{t('accounting.reversed')}</span>
                            ) : null}
                          </td>
                          <td>{lineIndex === 0 ? entry.datedAt.slice(0, 10) : ''}</td>
                          <td>{line.account.code}</td>
                          <td>{line.account.name}</td>
                          <td>{lineIndex === 0 ? entry.memo : ''}</td>
                          <td>{line.memo || entry.memo}</td>
                          <td className="num">{line.debit ? formatPyg(line.debit) : ''}</td>
                          <td className="num">{line.credit ? formatPyg(line.credit) : ''}</td>
                          <td>{lineIndex === 0 ? entry.documentNumber || '' : ''}</td>
                          {canWrite ? (
                            <td>
                              {lineIndex === 0 && !entry.reversed && !entry.reversesId ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  disabled={saving}
                                  onClick={() => setDeleteTarget(entry)}
                                >
                                  {t('accounting.deleteEntry')}
                                </button>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                      )),
                    )}
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
              <p className="hint">{t('accounting.ledgerHint')}</p>
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

          {tab === 'income' && statements && (
            <div className="accounting-statement">
              <h2>{t('accounting.incomeStatement')}</h2>
              <p className="hint">{t('accounting.incomeHint')}</p>
              <h3>{t('accounting.incomeDetail')}</h3>
              <StatementRows
                rows={statements.incomeStatement.income}
                total={statements.incomeStatement.revenue}
                totalLabel={t('accounting.revenue')}
                {...rowLabels}
              />
              <h3>{t('accounting.costDetail')}</h3>
              <StatementRows
                rows={statements.incomeStatement.costs}
                total={statements.incomeStatement.costTotal}
                totalLabel={t('accounting.cogs')}
                {...rowLabels}
              />
              <p className="accounting-subtotal">
                {t('accounting.grossMargin')}: <strong>{formatPyg(statements.incomeStatement.grossMargin)}</strong>
              </p>
              <h3>{t('accounting.expenseDetail')}</h3>
              <StatementRows
                rows={statements.incomeStatement.expenses}
                total={statements.incomeStatement.expenseTotal}
                totalLabel={t('accounting.expenses')}
                {...rowLabels}
              />
              <h3>{t('accounting.taxDetail')}</h3>
              <StatementRows
                rows={statements.incomeStatement.taxes}
                total={statements.incomeStatement.taxTotal}
                totalLabel={t('accounting.ivaNet')}
                {...rowLabels}
              />
              <p className="accounting-subtotal">
                {t('accounting.netIncome')}: <strong>{formatPyg(statements.incomeStatement.netIncome)}</strong>
              </p>
            </div>
          )}

          {tab === 'balance' && statements && (
            <div className="accounting-statement">
              <h2>{t('accounting.balanceSheet')}</h2>
              <p className="hint">{t('accounting.balanceHint')}</p>
              <h3>{t('accounting.currentAssets')}</h3>
              <StatementRows
                rows={statements.balanceSheet.currentAssets}
                total={statements.balanceSheet.currentAssetTotal}
                totalLabel={t('accounting.currentAssets')}
                {...rowLabels}
              />
              <h3>{t('accounting.nonCurrentAssets')}</h3>
              <StatementRows
                rows={statements.balanceSheet.nonCurrentAssets}
                total={statements.balanceSheet.nonCurrentAssetTotal}
                totalLabel={t('accounting.nonCurrentAssets')}
                {...rowLabels}
              />
              <p className="accounting-subtotal">
                {t('accounting.assets')}: <strong>{formatPyg(statements.balanceSheet.assetTotal)}</strong>
              </p>
              <h3>{t('accounting.currentLiabilities')}</h3>
              <StatementRows
                rows={statements.balanceSheet.currentLiabilities}
                total={statements.balanceSheet.currentLiabilityTotal}
                totalLabel={t('accounting.currentLiabilities')}
                {...rowLabels}
              />
              <p className="accounting-subtotal">
                {t('accounting.liabilities')}: <strong>{formatPyg(statements.balanceSheet.liabilityTotal)}</strong>
              </p>
              <h3>{t('accounting.equity')}</h3>
              <StatementRows
                rows={statements.balanceSheet.equity}
                total={statements.balanceSheet.equityTotal}
                totalLabel={t('accounting.equity')}
                {...rowLabels}
              />
              <p className="accounting-subtotal">
                {t('accounting.liabilities')} + {t('accounting.equity')}:{' '}
                <strong>{formatPyg(statements.balanceSheet.liabilityTotal + statements.balanceSheet.equityTotal)}</strong>
              </p>
            </div>
          )}

          {tab === 'cashflow' && statements && (
            <div className="accounting-statement">
              <h2>{t('accounting.cashFlow')}</h2>
              <p className="hint">{t('accounting.cashHint')}</p>
              <div className="accounting-cash-summary">
                <p>
                  {t('accounting.openingCash')}: <strong>{formatPyg(statements.cashFlow.opening)}</strong>
                </p>
                <p>
                  {t('accounting.inflows')}: <strong>{formatPyg(statements.cashFlow.inflows)}</strong>
                </p>
                <p>
                  {t('accounting.outflows')}: <strong>{formatPyg(statements.cashFlow.outflows)}</strong>
                </p>
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
                <p>
                  {t('accounting.closingCash')}: <strong>{formatPyg(statements.cashFlow.closing)}</strong>
                </p>
              </div>
              <h3>{t('accounting.cashMovements')}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('accounting.col.number')}</th>
                      <th>{t('accounting.col.date')}</th>
                      <th>{t('accounting.col.accountName')}</th>
                      <th>{t('accounting.col.concept')}</th>
                      <th className="num">{t('accounting.inflows')}</th>
                      <th className="num">{t('accounting.outflows')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.cashFlow.lines.map((line, index) => (
                      <tr key={`${line.numberLabel}-${index}`}>
                        <td>{line.numberLabel}</td>
                        <td>{String(line.datedAt).slice(0, 10)}</td>
                        <td>{line.account}</td>
                        <td>{line.memo}</td>
                        <td className="num">{line.debit ? formatPyg(line.debit) : ''}</td>
                        <td className="num">{line.credit ? formatPyg(line.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                      <input name="amountGrossPyg" inputMode="numeric" required placeholder="222000" />
                      <span className="hint">{t('accounting.amountHint')}</span>
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
                      {canWrite ? <th /> : null}
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
                        {canWrite ? (
                          <td>
                            <button type="button" className="btn-secondary" disabled={saving} onClick={() => void undoExpense(expense.id)}>
                              {t('accounting.undo')}
                            </button>
                          </td>
                        ) : null}
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

          <Modal
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            title={t('accounting.deleteEntry')}
            footer={
              deleteTarget ? (
                <>
                  <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn-danger" disabled={saving} onClick={() => void deleteEntry(deleteTarget)}>
                    {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                    {t('accounting.deleteEntry')}
                  </button>
                </>
              ) : undefined
            }
          >
            <p>{t('accounting.confirmDelete')}</p>
            {deleteTarget ? (
              <p>
                <strong>{deleteTarget.numberLabel}</strong> · {deleteTarget.memo}
                {deleteTarget.documentNumber ? ` · ${deleteTarget.documentNumber}` : ''}
              </p>
            ) : null}
          </Modal>
        </>
      )}
    </div>
  );
}
