import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import {
  bootstrapKamproKey,
  kamproFetch,
  type KamproCost,
  type KamproForwarder,
  type KamproProduct,
  type KamproPurchase,
  type KamproReception,
  type KamproShipment,
  type KamproSkuReport,
  type KamproSupplier,
} from '../services/kamproApi';
import './Kampro.css';

type Tab = 'products' | 'suppliers' | 'purchases' | 'shipments' | 'costs' | 'receptions' | 'report';

const TABS: Tab[] = ['products', 'suppliers', 'purchases', 'shipments', 'costs', 'receptions', 'report'];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formValues(event: FormEvent<HTMLFormElement>) {
  const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== '') out[key] = String(value);
  }
  return out;
}

export function Kampro() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.imports'));
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('products');
  const [online, setOnline] = useState<boolean | null>(null);
  const [reportSku, setReportSku] = useState('');

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
  const purchasesQ = useQuery({
    queryKey: ['kampro', 'purchases'],
    queryFn: () => kamproFetch<KamproPurchase[]>('/purchases'),
    enabled: online === true,
  });
  const shipmentsQ = useQuery({
    queryKey: ['kampro', 'shipments'],
    queryFn: () => kamproFetch<KamproShipment[]>('/shipments'),
    enabled: online === true,
  });
  const costsQ = useQuery({
    queryKey: ['kampro', 'costs'],
    queryFn: () => kamproFetch<KamproCost[]>('/import-costs'),
    enabled: online === true,
  });
  const receptionsQ = useQuery({
    queryKey: ['kampro', 'receptions'],
    queryFn: () => kamproFetch<KamproReception[]>('/receptions'),
    enabled: online === true,
  });
  const reportQ = useQuery({
    queryKey: ['kampro', 'report', reportSku],
    queryFn: () => kamproFetch<KamproSkuReport>(`/reports/sku/${encodeURIComponent(reportSku)}/landed-cost`),
    enabled: online === true && tab === 'report' && !!reportSku,
  });

  const products = productsQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];
  const forwarders = forwardersQ.data ?? [];
  const purchases = purchasesQ.data ?? [];
  const shipments = shipmentsQ.data ?? [];
  const costs = costsQ.data ?? [];
  const receptions = receptionsQ.data ?? [];

  useEffect(() => {
    if (!reportSku && products[0]) setReportSku(products[0].sku);
  }, [products, reportSku]);

  const stockTotal = useMemo(() => products.reduce((sum, p) => sum + p.stockQty, 0), [products]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['kampro'] });
  };

  const submit = async (event: FormEvent<HTMLFormElement>, path: string, map: (body: Record<string, string>) => unknown, ok: string) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await kamproFetch(path, { method: 'POST', body: JSON.stringify(map(formValues(event))) });
      form.reset();
      refresh();
      toast.success(ok);
    } catch (err) {
      toast.error(t('kampro.toast.error'), err instanceof Error ? err.message : undefined);
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
          <div className="stats-grid">
            <div className="stat-card">
              <div className="label">{t('kampro.stats.skus')}</div>
              <div className="value">{products.length}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('kampro.stats.stock')}</div>
              <div className="value">{stockTotal}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('kampro.stats.purchases')}</div>
              <div className="value">{purchases.length}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('kampro.stats.shipments')}</div>
              <div className="value">{shipments.length}</div>
            </div>
          </div>

          <div className="tabs">
            {TABS.map(id => (
              <button key={id} type="button" className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                {t(`kampro.tabs.${id}`)}
              </button>
            ))}
          </div>

          {tab === 'products' && (
            <>
              <p className="hint">{t('kampro.todoStock')}</p>
              <Table
                headers={[t('kampro.col.sku'), t('kampro.col.name'), t('kampro.col.capacity'), t('kampro.col.stock'), t('kampro.col.unitCost')]}
                rows={products.map(p => [p.sku, p.name, `${p.capacityMl} ml`, String(p.stockQty), p.unitCostPyg == null ? '—' : String(p.unitCostPyg)])}
              />
            </>
          )}

          {tab === 'suppliers' && (
            <>
              <form
                className="card form-grid"
                onSubmit={e =>
                  submit(e, '/suppliers', body => body, t('kampro.toast.created'))
                }
              >
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
                  <button className="btn-primary" type="submit">
                    {t('kampro.form.createSupplier')}
                  </button>
                </div>
              </form>
              <Table
                headers={[t('kampro.col.name'), t('kampro.col.country'), t('kampro.col.contact'), t('kampro.col.alibaba')]}
                rows={suppliers.map(s => [s.name, s.country, s.contact || '—', s.alibabaUrl || '—'])}
              />
            </>
          )}

          {tab === 'purchases' && (
            <>
              <form
                className="card form-grid"
                onSubmit={e =>
                  submit(
                    e,
                    '/purchases',
                    body => ({ ...body, quantity: Number(body.quantity) }),
                    t('kampro.toast.created'),
                  )
                }
              >
                <label>
                  {t('kampro.col.date')}
                  <input name="purchasedAt" type="date" defaultValue={today()} required />
                </label>
                <label>
                  {t('kampro.col.supplier')}
                  <select name="supplierId" required>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('kampro.col.sku')}
                  <select name="productId" required>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('kampro.col.qty')}
                  <input name="quantity" type="number" min={1} required />
                </label>
                <label>
                  {t('kampro.col.unit')}
                  <input name="unitPrice" required />
                </label>
                <label>
                  {t('kampro.col.fx')}
                  <input name="fxRateToPyg" />
                </label>
                <input type="hidden" name="currency" value="USD" />
                <div className="full">
                  <button className="btn-primary" type="submit">
                    {t('kampro.form.createPurchase')}
                  </button>
                </div>
              </form>
              <Table
                headers={[t('kampro.col.date'), t('kampro.col.sku'), t('kampro.col.supplier'), t('kampro.col.qty'), t('kampro.col.total'), t('kampro.col.shipment')]}
                rows={purchases.map(p => [
                  p.purchasedAt.slice(0, 10),
                  p.product?.sku || '',
                  p.supplier?.name || '',
                  String(p.quantity),
                  `${p.total} ${p.currency}`,
                  p.shipment?.reference || '—',
                ])}
              />
            </>
          )}

          {tab === 'shipments' && (
            <>
              <form
                className="card form-grid"
                onSubmit={e =>
                  submit(e, '/forwarders', body => body, t('kampro.toast.created'))
                }
              >
                <label>
                  {t('kampro.col.forwarder')}
                  <input name="name" required />
                </label>
                <label>
                  {t('kampro.col.contact')}
                  <input name="contact" />
                </label>
                <div className="full">
                  <button className="btn-primary" type="submit">
                    {t('kampro.form.createForwarder')}
                  </button>
                </div>
              </form>
              <form
                className="card form-grid"
                onSubmit={e =>
                  submit(
                    e,
                    '/shipments',
                    body => {
                      const purchaseId = body.purchaseId;
                      delete body.purchaseId;
                      return purchaseId ? { ...body, purchaseIds: [purchaseId] } : body;
                    },
                    t('kampro.toast.created'),
                  )
                }
              >
                <label>
                  {t('kampro.col.forwarder')}
                  <select name="forwarderId" required>
                    {forwarders.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('kampro.col.shipment')}
                  <input name="reference" required />
                </label>
                <label>
                  {t('kampro.col.departed')}
                  <input name="departedAt" type="date" />
                </label>
                <label>
                  {t('kampro.col.eta')}
                  <input name="etaAt" type="date" />
                </label>
                <label>
                  {t('kampro.col.arrived')}
                  <input name="arrivedAt" type="date" />
                </label>
                <label>
                  {t('kampro.form.assignPurchase')}
                  <select name="purchaseId">
                    <option value="">{t('kampro.form.none')}</option>
                    {purchases.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.product?.sku} ×{p.quantity}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="full">
                  <button className="btn-primary" type="submit">
                    {t('kampro.form.createShipment')}
                  </button>
                </div>
              </form>
              <Table
                headers={[t('kampro.col.shipment'), t('kampro.col.forwarder'), t('kampro.col.status'), t('kampro.col.eta'), t('kampro.col.sku')]}
                rows={shipments.map(s => [
                  s.reference,
                  s.forwarder?.name || '',
                  s.status,
                  (s.etaAt || '').slice(0, 10) || '—',
                  (s.purchases || []).map(p => p.product?.sku).filter(Boolean).join(', ') || '—',
                ])}
              />
            </>
          )}

          {tab === 'costs' && (
            <>
              <p className="hint">{t('kampro.costHint')}</p>
              <form
                className="card form-grid"
                onSubmit={e => submit(e, '/import-costs', body => body, t('kampro.toast.created'))}
              >
                <label>
                  {t('kampro.col.shipment')}
                  <select name="shipmentId" required>
                    {shipments.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.reference}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('kampro.form.assignPurchase')}
                  <select name="purchaseId">
                    <option value="">{t('kampro.prorate')}</option>
                    {purchases.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.product?.sku} ×{p.quantity}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('kampro.col.type')}
                  <select name="type">
                    <option value="LOGISTICA">LOGISTICA</option>
                    <option value="ADUANA">ADUANA</option>
                    <option value="IMPUESTO">IMPUESTO</option>
                    <option value="OTRO">OTRO</option>
                  </select>
                </label>
                <label>
                  {t('kampro.col.amount')}
                  <input name="amount" required />
                </label>
                <label>
                  {t('kampro.col.fx')}
                  <input name="fxRateToPyg" />
                </label>
                <label>
                  {t('kampro.form.description')}
                  <input name="description" />
                </label>
                <input type="hidden" name="currency" value="USD" />
                <div className="full">
                  <button className="btn-primary" type="submit">
                    {t('kampro.form.createCost')}
                  </button>
                </div>
              </form>
              <Table
                headers={[t('kampro.col.shipment'), t('kampro.col.type'), t('kampro.col.amount'), t('kampro.col.allocation')]}
                rows={costs.map(c => [
                  c.shipment?.reference || '',
                  c.type,
                  `${c.amount} ${c.currency}`,
                  c.purchase?.product?.sku || t('kampro.prorate'),
                ])}
              />
            </>
          )}

          {tab === 'receptions' && (
            <>
              <p className="hint">{t('kampro.receiveHint')}</p>
              <form
                className="card form-grid"
                onSubmit={e =>
                  submit(
                    e,
                    '/receptions',
                    body => {
                      const payload: Record<string, unknown> = {
                        shipmentId: body.shipmentId,
                        purchaseId: body.purchaseId,
                        receivedQty: Number(body.receivedQty),
                        receivedAt: body.receivedAt,
                      };
                      if (body.incidentType && body.incidentQty) {
                        payload.incidents = [{ type: body.incidentType, quantity: Number(body.incidentQty) }];
                      }
                      return payload;
                    },
                    t('kampro.toast.received'),
                  )
                }
              >
                <label>
                  {t('kampro.col.shipment')}
                  <select name="shipmentId" required>
                    {shipments.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.reference}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('kampro.form.assignPurchase')}
                  <select name="purchaseId" required>
                    {purchases.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.product?.sku} ×{p.quantity}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('kampro.col.received')}
                  <input name="receivedQty" type="number" min={0} required />
                </label>
                <label>
                  {t('kampro.col.date')}
                  <input name="receivedAt" type="date" defaultValue={today()} required />
                </label>
                <label>
                  {t('kampro.col.incidents')}
                  <select name="incidentType">
                    <option value="">{t('kampro.form.none')}</option>
                    <option value="FALTANTE">FALTANTE</option>
                    <option value="SOBRANTE">SOBRANTE</option>
                    <option value="DANADO">DANADO</option>
                    <option value="OTRO">OTRO</option>
                  </select>
                </label>
                <label>
                  {t('kampro.col.qty')}
                  <input name="incidentQty" type="number" min={1} />
                </label>
                <div className="full">
                  <button className="btn-primary" type="submit">
                    {t('kampro.form.createReception')}
                  </button>
                </div>
              </form>
              <Table
                headers={[t('kampro.col.date'), t('kampro.col.sku'), t('kampro.col.received'), t('kampro.col.incidents')]}
                rows={receptions.map(r => [
                  r.receivedAt.slice(0, 10),
                  r.purchase?.product?.sku || '',
                  String(r.receivedQty),
                  (r.incidents || []).map(i => `${i.type} ${i.quantity}`).join(', ') || '—',
                ])}
              />
            </>
          )}

          {tab === 'report' && (
            <>
              <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
                <label style={{ display: 'grid', gap: '0.35rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {t('kampro.col.sku')}
                  <select value={reportSku} onChange={e => setReportSku(e.target.value)}>
                    {products.map(p => (
                      <option key={p.sku} value={p.sku}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {reportQ.data && (
                <>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="label">{t('kampro.col.stock')}</div>
                      <div className="value">{reportQ.data.stockQty}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">{t('kampro.stats.purchased')}</div>
                      <div className="value">{reportQ.data.qtyPurchased}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">{t('kampro.col.received')}</div>
                      <div className="value">{reportQ.data.qtyReceived}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">{t('kampro.col.landed')}</div>
                      <div className="value">{reportQ.data.pygEquivalent?.landed ?? '—'}</div>
                    </div>
                  </div>
                  {reportQ.data.note && <p className="hint">{t('kampro.reportNote')}</p>}
                  <Table
                    headers={[t('kampro.col.date'), t('kampro.col.supplier'), t('kampro.col.shipment'), t('kampro.col.qty'), t('kampro.col.received'), t('kampro.col.total'), t('kampro.col.landed')]}
                    rows={reportQ.data.history.map(h => [
                      String(h.purchase.purchasedAt).slice(0, 10),
                      h.purchase.supplierName,
                      h.purchase.shipmentReference || '—',
                      String(h.purchase.quantity),
                      String(h.qtyReceived),
                      `${h.purchase.total} ${h.purchase.currency}`,
                      h.landedPyg == null ? '—' : String(h.landedPyg),
                    ])}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
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
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
