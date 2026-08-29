import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, MoreVertical } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import {
  bootstrapKamproKey,
  kamproFetch,
  type KamproForwarder,
  type KamproProduct,
  type KamproPurchaseOrder,
  type KamproPurchaseOrderInvoice,
  type KamproPurchaseOrderSummary,
  type KamproSupplier,
  type PurchaseOrderStatus,
  type TreasuryAccount,
} from '../services/kamproApi';
import './Kampro.css';

type Tab = 'orders' | 'suppliers' | 'forwarders' | 'receptions' | 'invoices';

const TABS: Tab[] = ['orders', 'suppliers', 'forwarders', 'receptions', 'invoices'];

type InvoiceDraft = {
  invoiceNumber: string;
  ruc: string;
  legalName: string;
  issuedAt: string;
  amount: string;
};

type LineDraft = {
  productId: string;
  quantity: string;
  unitPrice: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyInvoice(): InvoiceDraft {
  return { invoiceNumber: '', ruc: '', legalName: '', issuedAt: today(), amount: '' };
}

function invoiceIsBlank(row: InvoiceDraft) {
  return ![row.invoiceNumber, row.ruc, row.legalName, row.amount].some(value => value.trim());
}

function productLabel(order: KamproPurchaseOrder) {
  if (order.productName) return order.productName;
  if (order.items?.length) return order.items.map(line => line.product?.name).filter(Boolean).join(', ');
  return order.product?.name || '';
}

function formValues(event: FormEvent<HTMLFormElement>) {
  const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== '') out[key] = String(value);
  }
  return out;
}

function formatAmount(value: string | number | null | undefined) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('es-PY', { maximumFractionDigits: 2 }).format(n);
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function linesFromOrder(order: KamproPurchaseOrder | undefined, products: KamproProduct[]): LineDraft[] {
  if (order?.items?.length) {
    return order.items.map(line => ({
      productId: line.productId,
      quantity: String(line.quantity),
      unitPrice: line.unitPrice,
    }));
  }
  if (order) {
    return [
      {
        productId: order.productId || order.product?.id || products[0]?.id || '',
        quantity: String(order.quantity || 1),
        unitPrice: order.unitPrice || '',
      },
    ];
  }
  return [{ productId: products[0]?.id || '', quantity: '1', unitPrice: '' }];
}

function PurchaseOrderFields({
  t,
  products,
  suppliers,
  forwarders,
  order,
  lines,
  currency,
  onLinesChange,
  onCurrencyChange,
}: {
  t: (key: string) => string;
  products: KamproProduct[];
  suppliers: KamproSupplier[];
  forwarders: KamproForwarder[];
  order?: KamproPurchaseOrder;
  lines: LineDraft[];
  currency: string;
  onLinesChange: (lines: LineDraft[]) => void;
  onCurrencyChange: (currency: string) => void;
}) {
  const catalogReady = products.length > 0 && suppliers.length > 0 && forwarders.length > 0;
  const fxNeeded = currency !== 'PYG';
  const setLine = (index: number, patch: Partial<LineDraft>) => {
    onLinesChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };
  return (
    <>
      <label>
        {t('kampro.col.forwarder')}
        <select
          name="forwarderId"
          required
          disabled={!forwarders.length}
          defaultValue={order?.forwarderId ?? order?.forwarder?.id}
        >
          {forwarders.map(f => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('kampro.col.orderedAt')}
        <input name="orderedAt" type="date" defaultValue={order ? formatDate(order.orderedAt) : today()} required />
      </label>
      <label>
        {t('kampro.col.supplier')}
        <select name="supplierId" required disabled={!suppliers.length} defaultValue={order?.supplierId ?? order?.supplier?.id}>
          {suppliers.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('kampro.col.origin')}
        <input name="origin" required defaultValue={order?.origin} />
      </label>
      <label>
        {t('kampro.col.destination')}
        <input name="destination" required defaultValue={order?.destination} />
      </label>
      <label>
        {t('kampro.col.currency')}
        <select name="currency" value={currency} onChange={e => onCurrencyChange(e.target.value)}>
          <option value="PYG">{t('kampro.currency.PYG')}</option>
          <option value="USD">{t('kampro.currency.USD')}</option>
          <option value="JPY">{t('kampro.currency.JPY')}</option>
        </select>
      </label>
      {fxNeeded ? (
        <label>
          {t('kampro.col.fx')}
          <input name="fxRateToPyg" inputMode="decimal" required placeholder="7500" defaultValue={order?.fxRateToPyg ?? ''} />
        </label>
      ) : (
        <p className="hint">{t('kampro.fxHintPyg')}</p>
      )}
      <label>
        {t('kampro.col.freight')}
        <input name="freight" inputMode="decimal" defaultValue={order?.freight ?? '0'} />
      </label>
      <label>
        {t('kampro.col.otherCharges')}
        <input name="otherCharges" inputMode="decimal" defaultValue={order?.otherCharges ?? '0'} />
      </label>
      <div className="full po-lines">
        <div className="po-lines-head">
          <h3 className="form-subtitle">{t('kampro.form.products')}</h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              onLinesChange([...lines, { productId: products[0]?.id || '', quantity: '1', unitPrice: '' }])
            }
            disabled={!products.length}
          >
            {t('kampro.form.addProductLine')}
          </button>
        </div>
        <div className="table-wrap po-lines-table">
          <table>
            <thead>
              <tr>
                <th>{t('kampro.col.product')}</th>
                <th>{t('kampro.col.qty')}</th>
                <th>{t('kampro.col.unit')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <select
                      required
                      disabled={!products.length}
                      value={line.productId}
                      onChange={e => setLine(index, { productId: e.target.value })}
                    >
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      required
                      value={line.quantity}
                      onChange={e => setLine(index, { quantity: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      required
                      value={line.unitPrice}
                      onChange={e => setLine(index, { unitPrice: e.target.value })}
                    />
                  </td>
                  <td>
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => onLinesChange(lines.filter((_, i) => i !== index))}
                      >
                        {t('kampro.form.removeProductLine')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <label className="full">
        {t('kampro.col.comments')}
        <textarea name="comments" rows={2} defaultValue={order?.comments ?? ''} />
      </label>
      {!catalogReady ? <p className="hint full">{t('kampro.catalogHint')}</p> : null}
    </>
  );
}

export function Kampro() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.imports'));
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('orders');
  const [online, setOnline] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<KamproPurchaseOrder | null>(null);
  const [closeTarget, setCloseTarget] = useState<KamproPurchaseOrder | null>(null);
  const [editTarget, setEditTarget] = useState<KamproPurchaseOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<KamproPurchaseOrder | null>(null);
  const [receipt, setReceipt] = useState('');
  const [payTreasury, setPayTreasury] = useState<TreasuryAccount>('BANCO');
  const [localTreasury, setLocalTreasury] = useState<TreasuryAccount>('BANCO');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundTreasury, setRefundTreasury] = useState<TreasuryAccount>('BANCO');
  const [refundReference, setRefundReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(today());
  const [customsCost, setCustomsCost] = useState('');
  const [dispatchCost, setDispatchCost] = useState('');
  const [invoices, setInvoices] = useState<InvoiceDraft[]>([emptyInvoice()]);
  const [createLines, setCreateLines] = useState<LineDraft[]>([{ productId: '', quantity: '1', unitPrice: '' }]);
  const [createCurrency, setCreateCurrency] = useState('USD');
  const [editLines, setEditLines] = useState<LineDraft[]>([]);
  const [editCurrency, setEditCurrency] = useState('USD');
  const [formNonce, setFormNonce] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    void bootstrapKamproKey().then(setOnline);
  }, []);

  const productsQ = useQuery({
    queryKey: ['kampro', 'products'],
    queryFn: () => kamproFetch<KamproProduct[]>('/products'),
    enabled: online === true,
  });
  const suppliersQ = useQuery({
    queryKey: ['kampro', 'suppliers'],
    queryFn: () => kamproFetch<KamproSupplier[]>('/suppliers'),
    enabled: online === true,
  });
  const forwardersQ = useQuery({
    queryKey: ['kampro', 'forwarders'],
    queryFn: () => kamproFetch<KamproForwarder[]>('/forwarders'),
    enabled: online === true,
  });
  const ordersQ = useQuery({
    queryKey: ['kampro', 'purchase-orders'],
    queryFn: () => kamproFetch<KamproPurchaseOrder[]>('/purchase-orders'),
    enabled: online === true,
  });
  const summaryQ = useQuery({
    queryKey: ['kampro', 'purchase-orders-summary'],
    queryFn: () => kamproFetch<KamproPurchaseOrderSummary>('/purchase-orders/summary'),
    enabled: online === true,
  });
  const invoicesQ = useQuery({
    queryKey: ['kampro', 'purchase-order-invoices'],
    queryFn: () => kamproFetch<KamproPurchaseOrderInvoice[]>('/purchase-orders/invoices'),
    enabled: online === true,
  });

  const products = productsQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];
  const forwarders = forwardersQ.data ?? [];
  const orders = ordersQ.data ?? [];
  const invoiceRows = invoicesQ.data ?? [];
  const summary = summaryQ.data;
  const receptions = orders.filter(o => o.status === 'CERRADA');
  const catalogReady = products.length > 0 && suppliers.length > 0 && forwarders.length > 0;

  useEffect(() => {
    if (!products[0]) return;
    setCreateLines(current =>
      current.map(line => ({ ...line, productId: line.productId || products[0].id })),
    );
  }, [products]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['kampro'] });
  };

  const submit = async (
    event: FormEvent<HTMLFormElement>,
    path: string,
    map: (body: Record<string, string>) => unknown,
    ok: string,
    onSuccess?: () => void,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    try {
      await kamproFetch(path, { method: 'POST', body: JSON.stringify(map(formValues(event))) });
      form.reset();
      onSuccess?.();
      refresh();
      toast.success(ok);
    } catch (err) {
      toast.error(t('kampro.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const poBody = (body: Record<string, string>, lines: LineDraft[], currency: string) => {
    const rest = { ...body };
    delete rest.productId;
    delete rest.quantity;
    delete rest.unitPrice;
    const payload: Record<string, unknown> = {
      ...rest,
      currency,
      items: lines.map(line => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        unitPrice: line.unitPrice,
      })),
    };
    if (currency === 'PYG') delete payload.fxRateToPyg;
    return payload;
  };

  const confirmOrder = async () => {
    if (!confirmTarget) return;
    setSaving(true);
    try {
      await kamproFetch(`/purchase-orders/${confirmTarget.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ paymentReceipt: receipt, treasury: payTreasury }),
      });
      setConfirmTarget(null);
      setReceipt('');
      refresh();
      toast.success(t('kampro.toast.confirmed'));
    } catch (err) {
      toast.error(t('kampro.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const closeOrder = async () => {
    if (!closeTarget) return;
    setSaving(true);
    try {
      await kamproFetch(`/purchase-orders/${closeTarget.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          receivedAt,
          customsCost,
          dispatchCost,
          invoices: invoices.filter(row => !invoiceIsBlank(row)).map(row => ({
            invoiceNumber: row.invoiceNumber,
            ruc: row.ruc,
            legalName: row.legalName,
            issuedAt: row.issuedAt,
            amount: row.amount,
          })),
          localTreasury,
        }),
      });
      setCloseTarget(null);
      setInvoices([emptyInvoice()]);
      refresh();
      toast.success(t('kampro.toast.closed'));
    } catch (err) {
      toast.error(t('kampro.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const startClose = (order: KamproPurchaseOrder) => {
    setCloseTarget(order);
    setReceivedAt(today());
    setCustomsCost('');
    setDispatchCost('');
    setInvoices([emptyInvoice()]);
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    if (!editTarget) return;
    event.preventDefault();
    setSaving(true);
    try {
      await kamproFetch(`/purchase-orders/${editTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify(poBody(formValues(event), editLines, editCurrency)),
      });
      setEditTarget(null);
      refresh();
      toast.success(t('kampro.toast.updated'));
    } catch (err) {
      toast.error(t('kampro.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const cancelOrder = async () => {
    if (!cancelTarget) return;
    setSaving(true);
    try {
      await kamproFetch(`/purchase-orders/${cancelTarget.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify(
          cancelTarget.status === 'BORRADOR'
            ? {}
            : {
                amountPyg: Number(refundAmount),
                treasury: refundTreasury,
                paidAt: new Date().toISOString(),
                reference: refundReference || undefined,
              },
        ),
      });
      setCancelTarget(null);
      refresh();
      toast.success(t('kampro.toast.cancelled'));
    } catch (err) {
      toast.error(t('kampro.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (online === null) {
    return (
      <div className="kampro-page" style={{ display: 'flex', justifyContent: 'center', minHeight: 320 }}>
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="kampro-page">
      <PageHeader
        title={t('nav.imports')}
        subtitle={t('kampro.subtitle')}
        badge={
          <span className={`status-badge ${online ? 'connected' : 'offline'}`}>
            {online ? t('kampro.connected') : t('kampro.offline')}
          </span>
        }
      />

      {!online && (
        <div className="offline-banner">
          <p>{t('kampro.offlineHint')}</p>
        </div>
      )}

      {online && (
        <>
          <div className="stats-grid stats-grid-5">
            <div className="stat-card">
              <div className="label">{t('kampro.stats.draft')}</div>
              <div className="value">{summary?.draft ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('kampro.stats.open')}</div>
              <div className="value">{summary?.open ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('kampro.stats.closed')}</div>
              <div className="value">{summary?.closed ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('kampro.stats.units')}</div>
              <div className="value">{summary?.quantity ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('kampro.stats.spent')}</div>
              <div className="value value-sm">{formatAmount(summary?.spent)}</div>
            </div>
          </div>

          <div className="tabs">
            {TABS.map(id => (
              <button key={id} type="button" className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                {t(`kampro.tabs.${id}`)}
              </button>
            ))}
          </div>

          {tab === 'orders' && (
            <>
              <form
                key={formNonce}
                className="card form-grid"
                onSubmit={e =>
                  submit(
                    e,
                    '/purchase-orders',
                    body => poBody(body, createLines, createCurrency),
                    t('kampro.toast.drafted'),
                    () => {
                      setCreateCurrency('USD');
                      setCreateLines([{ productId: products[0]?.id || '', quantity: '1', unitPrice: '' }]);
                      setFormNonce(n => n + 1);
                    },
                  )
                }
              >
                <h2 className="full form-title">{t('kampro.form.newOrder')}</h2>
                <PurchaseOrderFields
                  t={t}
                  products={products}
                  suppliers={suppliers}
                  forwarders={forwarders}
                  lines={createLines}
                  currency={createCurrency}
                  onLinesChange={setCreateLines}
                  onCurrencyChange={setCreateCurrency}
                />
                <div className="full">
                  <button className="btn-primary" type="submit" disabled={saving || !catalogReady}>
                    {t('kampro.form.createOrder')}
                  </button>
                </div>
              </form>

              <Table
                headers={[
                  t('kampro.col.orderedAt'),
                  t('kampro.col.supplier'),
                  t('kampro.col.product'),
                  t('kampro.col.qty'),
                  t('kampro.col.total'),
                  t('kampro.col.status'),
                  t('kampro.col.actions'),
                ]}
                rows={orders.map(order => [
                  formatDate(order.orderedAt),
                  order.supplier?.name || '',
                  productLabel(order),
                  String(order.quantity),
                  formatAmount(order.status === 'CANCELADA' ? null : (order.spentPyg ?? order.landedTotal)),
                  <StatusPill key={`${order.id}-st`} status={order.status} label={t(`kampro.status.${order.status}`)} />,
                  <RowActions
                    key={`${order.id}-act`}
                    order={order}
                    confirmLabel={t('kampro.form.confirm')}
                    closeLabel={t('kampro.form.close')}
                    editLabel={t('kampro.form.edit')}
                    cancelLabel={t('kampro.form.cancelOrder')}
                    detailLabel={t('kampro.form.detail')}
                    moreLabel={t('kampro.moreActions')}
                    menuOpen={menuId === order.id}
                    onMenuOpenChange={open => setMenuId(open ? order.id : null)}
                    onConfirm={() => {
                      setMenuId(null);
                      setConfirmTarget(order);
                      setReceipt('');
                    }}
                    onClose={() => {
                      setMenuId(null);
                      startClose(order);
                    }}
                    onEdit={() => {
                      setMenuId(null);
                      setEditTarget(order);
                      setEditLines(linesFromOrder(order, products));
                      setEditCurrency(order.currency === 'YEN' ? 'JPY' : order.currency || 'USD');
                    }}
                    onCancel={() => {
                      setMenuId(null);
                      setCancelTarget(order);
                    }}
                    onToggle={() => {
                      setMenuId(null);
                      setOpenId(openId === order.id ? null : order.id);
                    }}
                  />,
                ])}
                details={orders.map(order =>
                  openId === order.id ? <OrderDetail key={order.id} order={order} t={t} /> : null,
                )}
              />
            </>
          )}

          {tab === 'suppliers' && (
            <>
              <form className="card form-grid" onSubmit={e => submit(e, '/suppliers', body => body, t('kampro.toast.created'))}>
                <label>
                  {t('kampro.col.name')}
                  <input name="name" required />
                </label>
                <label>
                  {t('kampro.col.contact')}
                  <input name="contact" />
                </label>
                <label>
                  {t('kampro.col.country')}
                  <input name="country" defaultValue="CN" />
                </label>
                <label>
                  {t('kampro.col.alibaba')}
                  <input name="alibabaUrl" placeholder="https://" />
                </label>
                <div className="full">
                  <button className="btn-primary" type="submit" disabled={saving}>
                    {t('kampro.form.createSupplier')}
                  </button>
                </div>
              </form>
              <Table
                headers={[t('kampro.col.name'), t('kampro.col.country'), t('kampro.col.contact'), t('kampro.col.alibaba'), t('kampro.col.orders')]}
                rows={suppliers.map(s => [
                  s.name,
                  s.country,
                  s.contact || '—',
                  s.alibabaUrl || '—',
                  String(orders.filter(o => o.supplier?.id === s.id).length),
                ])}
              />
            </>
          )}

          {tab === 'forwarders' && (
            <>
              <form className="card form-grid" onSubmit={e => submit(e, '/forwarders', body => body, t('kampro.toast.created'))}>
                <label>
                  {t('kampro.col.forwarder')}
                  <input name="name" required />
                </label>
                <label>
                  {t('kampro.col.contact')}
                  <input name="contact" />
                </label>
                <label>
                  {t('kampro.col.country')}
                  <input name="country" />
                </label>
                <div className="full">
                  <button className="btn-primary" type="submit" disabled={saving}>
                    {t('kampro.form.createForwarder')}
                  </button>
                </div>
              </form>
              <Table
                headers={[t('kampro.col.name'), t('kampro.col.contact'), t('kampro.col.country'), t('kampro.col.orders')]}
                rows={forwarders.map(f => [
                  f.name,
                  f.contact || '—',
                  f.country || '—',
                  String(orders.filter(o => o.forwarder?.id === f.id).length),
                ])}
              />
            </>
          )}

          {tab === 'receptions' && (
            <>
              <p className="hint">{t('kampro.receiveHint')}</p>
              <Table
                headers={[
                  t('kampro.col.receivedAt'),
                  t('kampro.col.product'),
                  t('kampro.col.qty'),
                  t('kampro.col.supplier'),
                  t('kampro.col.customs'),
                  t('kampro.col.dispatch'),
                ]}
                rows={receptions.map(r => [
                  formatDate(r.receivedAt),
                  productLabel(r),
                  String(r.quantity),
                  r.supplier?.name || '',
                  formatAmount(r.customsCost),
                  formatAmount(r.dispatchCost),
                ])}
              />
            </>
          )}

          {tab === 'invoices' && (
            <Table
              headers={[
                t('kampro.col.invoiceNumber'),
                t('kampro.col.ruc'),
                t('kampro.col.legalName'),
                t('kampro.col.date'),
                t('kampro.col.amount'),
                t('kampro.col.supplier'),
                t('kampro.col.product'),
              ]}
              rows={invoiceRows.map(inv => [
                inv.invoiceNumber,
                inv.ruc,
                inv.legalName,
                formatDate(inv.issuedAt),
                formatAmount(inv.amount),
                inv.purchaseOrder?.supplierName || '—',
                inv.purchaseOrder?.productName || '—',
              ])}
            />
          )}
        </>
      )}

      <Modal
        open={Boolean(confirmTarget)}
        onClose={() => setConfirmTarget(null)}
        title={t('kampro.form.confirm')}
        footer={
          confirmTarget ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setConfirmTarget(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn-primary" disabled={saving || !receipt.trim()} onClick={() => void confirmOrder()}>
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('kampro.form.confirm')}
              </button>
            </>
          ) : undefined
        }
      >
        <p className="hint">{t('kampro.confirmHint')}</p>
        <label className="kampro-modal-field">
          {t('kampro.col.paymentReceipt')}
          <input value={receipt} onChange={e => setReceipt(e.target.value)} />
        </label>
        <label className="kampro-modal-field">
          {t('kampro.col.treasury')}
          <select value={payTreasury} onChange={e => setPayTreasury(e.target.value as TreasuryAccount)}>
            <option value="BANCO">{t('accounting.banco')}</option>
            <option value="CAJA">{t('accounting.caja')}</option>
          </select>
        </label>
      </Modal>

      <Modal
        open={Boolean(closeTarget)}
        onClose={() => setCloseTarget(null)}
        title={t('kampro.form.close')}
        footer={
          closeTarget ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setCloseTarget(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void closeOrder()}>
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('kampro.form.close')}
              </button>
            </>
          ) : undefined
        }
      >
        <p className="hint">{t('kampro.closeHint')}</p>
        <div className="form-grid">
          <label>
            {t('kampro.col.receivedAt')}
            <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} required />
          </label>
          <label>
            {t('kampro.col.customs')}
            <input value={customsCost} onChange={e => setCustomsCost(e.target.value)} inputMode="decimal" required />
          </label>
          <label>
            {t('kampro.col.dispatch')}
            <input value={dispatchCost} onChange={e => setDispatchCost(e.target.value)} inputMode="decimal" required />
          </label>
          <label>
            {t('kampro.col.treasury')}
            <select value={localTreasury} onChange={e => setLocalTreasury(e.target.value as TreasuryAccount)}>
              <option value="BANCO">{t('accounting.banco')}</option>
              <option value="CAJA">{t('accounting.caja')}</option>
            </select>
          </label>
        </div>
        <h3 className="form-subtitle">{t('kampro.form.invoices')}</h3>
        {invoices.map((row, index) => (
          <div key={index} className="form-grid invoice-row">
            <label>
              {t('kampro.col.invoiceNumber')}
              <input
                value={row.invoiceNumber}
                onChange={e => setInvoices(list => list.map((item, i) => (i === index ? { ...item, invoiceNumber: e.target.value } : item)))}
              />
            </label>
            <label>
              {t('kampro.col.ruc')}
              <input
                value={row.ruc}
                onChange={e => setInvoices(list => list.map((item, i) => (i === index ? { ...item, ruc: e.target.value } : item)))}
              />
            </label>
            <label>
              {t('kampro.col.legalName')}
              <input
                value={row.legalName}
                onChange={e => setInvoices(list => list.map((item, i) => (i === index ? { ...item, legalName: e.target.value } : item)))}
              />
            </label>
            <label>
              {t('kampro.col.date')}
              <input
                type="date"
                value={row.issuedAt}
                onChange={e => setInvoices(list => list.map((item, i) => (i === index ? { ...item, issuedAt: e.target.value } : item)))}
              />
            </label>
            <label>
              {t('kampro.col.amount')}
              <input
                value={row.amount}
                onChange={e => setInvoices(list => list.map((item, i) => (i === index ? { ...item, amount: e.target.value } : item)))}
                inputMode="decimal"
              />
            </label>
            {invoices.length > 1 ? (
              <div className="full invoice-row-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setInvoices(list => list.filter((_, i) => i !== index))}
                >
                  {t('kampro.form.removeInvoice')}
                </button>
              </div>
            ) : null}
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={() => setInvoices(list => [...list, emptyInvoice()])}>
          {t('kampro.form.addInvoice')}
        </button>
      </Modal>

      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={t('kampro.form.edit')}
        footer={
          editTarget ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>
                {t('common.cancel')}
              </button>
              <button form="edit-po-form" className="btn-primary" type="submit" disabled={saving || !catalogReady}>
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('kampro.form.saveEdit')}
              </button>
            </>
          ) : undefined
        }
      >
        {editTarget ? (
          <form id="edit-po-form" key={editTarget.id} className="form-grid" onSubmit={e => void saveEdit(e)}>
            <p className="hint full">{t('kampro.editHint')}</p>
            <PurchaseOrderFields
              t={t}
              products={products}
              suppliers={suppliers}
              forwarders={forwarders}
              order={editTarget}
              lines={editLines}
              currency={editCurrency}
              onLinesChange={setEditLines}
              onCurrencyChange={setEditCurrency}
            />
            {editTarget.status === 'CERRADA' ? (
              <>
                <label>
                  {t('kampro.col.customs')}
                  <input name="customsCost" inputMode="decimal" defaultValue={editTarget.customsCost ?? '0'} />
                </label>
                <label>
                  {t('kampro.col.dispatch')}
                  <input name="dispatchCost" inputMode="decimal" defaultValue={editTarget.dispatchCost ?? '0'} />
                </label>
              </>
            ) : null}
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('kampro.form.cancelOrder')}
        footer={
          cancelTarget ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setCancelTarget(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn-danger" disabled={saving || (cancelTarget.status !== 'BORRADOR' && !Number(refundAmount))} onClick={() => void cancelOrder()}>
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('kampro.form.cancelOrder')}
              </button>
            </>
          ) : undefined
        }
      >
        <p>
          {cancelTarget?.status === 'CERRADA'
            ? t('kampro.cancelClosedHint')
            : cancelTarget?.status === 'BORRADOR'
              ? t('kampro.cancelHint')
              : t('kampro.cancelRefundHint')}
        </p>
        {cancelTarget && cancelTarget.status !== 'BORRADOR' ? (
          <div className="form-grid">
            <label>
              {t('kampro.col.refundAmount')}
              <input value={refundAmount} onChange={e => setRefundAmount(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              {t('kampro.col.treasury')}
              <select value={refundTreasury} onChange={e => setRefundTreasury(e.target.value as TreasuryAccount)}>
                <option value="BANCO">{t('accounting.banco')}</option>
                <option value="CAJA">{t('accounting.caja')}</option>
              </select>
            </label>
            <label className="full">
              {t('kampro.col.refundReference')}
              <input value={refundReference} onChange={e => setRefundReference(e.target.value)} />
            </label>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function StatusPill({ status, label }: { status: PurchaseOrderStatus; label: string }) {
  return <span className={`po-status po-status-${status.toLowerCase()}`}>{label}</span>;
}

function RowActions({
  order,
  confirmLabel,
  closeLabel,
  editLabel,
  cancelLabel,
  detailLabel,
  moreLabel,
  menuOpen,
  onMenuOpenChange,
  onConfirm,
  onClose,
  onEdit,
  onCancel,
  onToggle,
}: {
  order: KamproPurchaseOrder;
  confirmLabel: string;
  closeLabel: string;
  editLabel: string;
  cancelLabel: string;
  detailLabel: string;
  moreLabel: string;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onToggle: () => void;
}) {
  const active = order.status !== 'CANCELADA';
  return (
    <div className="po-actions">
      <PoMenu open={menuOpen} moreLabel={moreLabel} onOpenChange={onMenuOpenChange}>
        {active ? (
          <button type="button" role="menuitem" onClick={onEdit}>
            {editLabel}
          </button>
        ) : null}
        <button type="button" role="menuitem" onClick={onToggle}>
          {detailLabel}
        </button>
        {active ? (
          <button type="button" role="menuitem" className="danger" onClick={onCancel}>
            {cancelLabel}
          </button>
        ) : null}
      </PoMenu>
      {order.status === 'BORRADOR' ? (
        <button type="button" className="btn-primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      ) : null}
      {order.status === 'CONFIRMADA' ? (
        <button type="button" className="btn-primary" onClick={onClose}>
          {closeLabel}
        </button>
      ) : null}
    </div>
  );
}

function PoMenu({
  open,
  moreLabel,
  onOpenChange,
  children,
}: {
  open: boolean;
  moreLabel: string;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, maxHeight: 240, openUp: false });

  const place = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = 200;
    const gap = 6;
    const margin = 8;
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(240, (openUp ? spaceAbove : spaceBelow) - gap));
    setCoords({
      top: openUp ? rect.top - gap : rect.bottom + gap,
      left,
      maxHeight,
      openUp,
    });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, onOpenChange]);

  return (
    <div className={`po-menu${open ? ' open' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className="po-menu-trigger"
        aria-label={moreLabel}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <MoreVertical size={16} />
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              className="po-menu-pop"
              role="menu"
              style={{
                top: coords.openUp ? 'auto' : coords.top,
                bottom: coords.openUp ? window.innerHeight - coords.top : 'auto',
                left: coords.left,
                maxHeight: coords.maxHeight,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function OrderDetail({
  order,
  t,
}: {
  order: KamproPurchaseOrder;
  t: (key: string) => string;
}) {
  return (
    <div className="po-detail">
      <p>
        <strong>{t('kampro.col.forwarder')}:</strong> {order.forwarder?.name || '—'}
      </p>
      <p>
        <strong>{t('kampro.col.origin')}:</strong> {order.origin} → {order.destination}
      </p>
      <p>
        <strong>{t('kampro.col.currency')}:</strong> {t(`kampro.currency.${order.currency === 'YEN' ? 'JPY' : order.currency}`)}
        {order.fxRateToPyg ? (
          <>
            {' '}
            · {t('kampro.col.fx')}: {formatAmount(order.fxRateToPyg)}
          </>
        ) : null}
      </p>
      {(order.items?.length ? order.items : null) ? (
        <ul>
          {order.items!.map((line, index) => (
            <li key={`${line.productId}-${index}`}>
              {line.product?.name || line.productId} · {line.quantity} × {formatAmount(line.unitPrice)}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          <strong>{t('kampro.col.unit')}:</strong> {formatAmount(order.unitPrice)} · {t('kampro.col.qty')}: {order.quantity}
        </p>
      )}
      <p>
        <strong>{t('kampro.col.freight')}:</strong> {formatAmount(order.freight)} · {t('kampro.col.otherCharges')}:{' '}
        {formatAmount(order.otherCharges)}
      </p>
      <p>
        <strong>{t('kampro.col.pygTotal')}:</strong> {formatAmount(order.spentPyg ?? order.chinaPyg)} Gs
      </p>
      {order.paymentReceipt ? (
        <p>
          <strong>{t('kampro.col.paymentReceipt')}:</strong> {order.paymentReceipt}
        </p>
      ) : null}
      {order.status === 'CERRADA' ? (
        <p>
          <strong>{t('kampro.col.receivedAt')}:</strong> {formatDate(order.receivedAt)} · {t('kampro.col.customs')}:{' '}
          {formatAmount(order.customsCost)} · {t('kampro.col.dispatch')}: {formatAmount(order.dispatchCost)}
        </p>
      ) : null}
      {order.status === 'CANCELADA' && order.cancelledAt ? (
        <p>
          <strong>{t('kampro.status.CANCELADA')}:</strong> {formatDate(order.cancelledAt)}
        </p>
      ) : null}
      {order.comments ? (
        <p>
          <strong>{t('kampro.col.comments')}:</strong> {order.comments}
        </p>
      ) : null}
      {order.invoices.length ? (
        <ul>
          {order.invoices.map(inv => (
            <li key={inv.id}>
              {inv.invoiceNumber} · {inv.legalName} · {inv.ruc} · {formatDate(inv.issuedAt)} · {formatAmount(inv.amount)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Table({
  headers,
  rows,
  details,
}: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
  details?: Array<ReactNode>;
}) {
  if (!rows.length) return <p className="empty">{'—'}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <FragmentRow key={i} cols={headers.length} cells={row} detail={details?.[i] ?? null} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  cols,
  cells,
  detail,
}: {
  cols: number;
  cells: Array<ReactNode>;
  detail: ReactNode;
}) {
  return (
    <>
      <tr>
        {cells.map((cell, j) => (
          <td key={j}>{cell}</td>
        ))}
      </tr>
      {detail ? (
        <tr className="po-detail-row">
          <td colSpan={cols}>{detail}</td>
        </tr>
      ) : null}
    </>
  );
}
