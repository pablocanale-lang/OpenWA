import { useEffect, useMemo, useState, type FormEvent, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { useRole } from '../hooks/useRole';
import {
  bootstrapKamproKey,
  kamproFetch,
  type KamproProduct,
  type KamproStockMovement,
} from '../services/kamproApi';
import { formatPyg } from '../utils/orderPricing';
import './Inventory.css';

export function Inventory() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.inventory'));
  const toast = useToast();
  const { canWrite } = useRole();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [adjustDraft, setAdjustDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    void bootstrapKamproKey().then(setOnline);
  }, []);

  const productsQ = useQuery({
    queryKey: ['kampro', 'products'],
    queryFn: () => kamproFetch<KamproProduct[]>('/products'),
    enabled: online === true,
  });
  const movementsQ = useQuery({
    queryKey: ['kampro', 'movements', openId],
    queryFn: () => kamproFetch<KamproStockMovement[]>(`/products/${openId}/movements`),
    enabled: online === true && Boolean(openId),
  });

  const products = productsQ.data ?? [];
  const stockTotal = useMemo(() => products.reduce((sum, p) => sum + p.stockQty, 0), [products]);
  const withPrice = useMemo(() => products.filter(p => p.unitPricePyg != null && p.unitPricePyg > 0).length, [products]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['kampro'] });
  };

  const createProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setSaving(true);
    try {
      await kamproFetch('/products', {
        method: 'POST',
        body: JSON.stringify({
          sku: String(data.sku ?? ''),
          name: String(data.name ?? ''),
          capacityMl: Number(data.capacityMl),
          unitPricePyg: Number(data.unitPricePyg),
          stockQty: data.stockQty === '' ? 0 : Number(data.stockQty),
        }),
      });
      form.reset();
      refresh();
      toast.success(t('inventory.toast.created'));
    } catch (err) {
      toast.error(t('inventory.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const savePrice = async (product: KamproProduct) => {
    const raw = priceDraft[product.id] ?? String(product.unitPricePyg ?? '');
    const unitPricePyg = Number(raw);
    setSaving(true);
    try {
      await kamproFetch(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ unitPricePyg }),
      });
      refresh();
      toast.success(t('inventory.toast.priceSaved'));
    } catch (err) {
      toast.error(t('inventory.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const adjustStock = async (product: KamproProduct) => {
    const delta = Number(adjustDraft[product.id] ?? '0');
    if (!Number.isInteger(delta) || delta === 0) {
      toast.error(t('inventory.toast.error'), t('inventory.adjustHint'));
      return;
    }
    setSaving(true);
    try {
      await kamproFetch(`/products/${product.id}/stock-adjust`, {
        method: 'POST',
        body: JSON.stringify({ delta }),
      });
      setAdjustDraft(prev => ({ ...prev, [product.id]: '' }));
      refresh();
      toast.success(t('inventory.toast.stockSaved'));
    } catch (err) {
      toast.error(t('inventory.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (product: KamproProduct) => {
    setSaving(true);
    try {
      await kamproFetch(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
      });
      refresh();
    } catch (err) {
      toast.error(t('inventory.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (online === null) {
    return (
      <div className="inventory-page inventory-page--loading">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="inventory-page">
      <PageHeader
        title={t('nav.inventory')}
        subtitle={t('inventory.subtitle')}
        badge={
          <span className={`status-badge ${online ? 'connected' : 'offline'}`}>
            {online ? t('kampro.connected') : t('kampro.offline')}
          </span>
        }
      />

      {!online && <p className="inventory-offline">{t('inventory.offlineHint')}</p>}

      {online && (
        <>
          <div className="inventory-stats">
            <div className="inventory-stat">
              <div className="label">{t('inventory.stats.skus')}</div>
              <div className="value">{products.length}</div>
            </div>
            <div className="inventory-stat">
              <div className="label">{t('inventory.stats.units')}</div>
              <div className="value">{stockTotal}</div>
            </div>
            <div className="inventory-stat">
              <div className="label">{t('inventory.stats.withPrice')}</div>
              <div className="value">{withPrice}</div>
            </div>
          </div>

          {canWrite && (
            <form className="inventory-form" onSubmit={createProduct}>
              <h2>{t('inventory.addTitle')}</h2>
              <div className="inventory-form-grid">
                <label>
                  {t('inventory.fields.sku')}
                  <input name="sku" required placeholder="JER-10ML" />
                </label>
                <label>
                  {t('inventory.fields.name')}
                  <input name="name" required />
                </label>
                <label>
                  {t('inventory.fields.capacity')}
                  <input name="capacityMl" type="number" min={1} required />
                </label>
                <label>
                  {t('inventory.fields.price')}
                  <input name="unitPricePyg" type="number" min={1} required />
                </label>
                <label>
                  {t('inventory.fields.stock')}
                  <input name="stockQty" type="number" min={0} defaultValue={0} />
                </label>
              </div>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('inventory.add')}
              </button>
            </form>
          )}

          {products.length === 0 ? (
            <p className="inventory-empty">{t('inventory.empty')}</p>
          ) : (
            <div className="inventory-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('inventory.fields.sku')}</th>
                    <th>{t('inventory.fields.name')}</th>
                    <th>{t('inventory.fields.capacity')}</th>
                    <th>{t('inventory.fields.stock')}</th>
                    <th>{t('inventory.fields.reserved')}</th>
                    <th>{t('inventory.fields.available')}</th>
                    <th>{t('inventory.fields.price')}</th>
                    <th>{t('inventory.fields.status')}</th>
                    {canWrite ? <th>{t('inventory.fields.actions')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {products.map(product => (
                    <Fragment key={product.id}>
                      <tr className={product.stockQty <= 0 ? 'is-empty' : undefined}>
                        <td>{product.sku}</td>
                        <td>{product.name}</td>
                        <td>{product.capacityMl} ml</td>
                        <td>
                          <strong>{product.stockQty}</strong>
                          {canWrite && (
                            <span className="inventory-adjust">
                              <input
                                type="number"
                                placeholder="+ / −"
                                value={adjustDraft[product.id] ?? ''}
                                onChange={e => setAdjustDraft(prev => ({ ...prev, [product.id]: e.target.value }))}
                              />
                              <button type="button" className="btn-secondary" disabled={saving} onClick={() => void adjustStock(product)}>
                                {t('inventory.adjust')}
                              </button>
                            </span>
                          )}
                        </td>
                        <td>{product.reservedQty ?? 0}</td>
                        <td>
                          <strong>{product.availableQty ?? product.stockQty - (product.reservedQty ?? 0)}</strong>
                        </td>
                        <td>
                          {canWrite ? (
                            <span className="inventory-adjust">
                              <input
                                type="number"
                                min={1}
                                value={priceDraft[product.id] ?? String(product.unitPricePyg ?? '')}
                                onChange={e => setPriceDraft(prev => ({ ...prev, [product.id]: e.target.value }))}
                              />
                              <button type="button" className="btn-secondary" disabled={saving} onClick={() => void savePrice(product)}>
                                {t('inventory.savePrice')}
                              </button>
                            </span>
                          ) : (
                            product.unitPricePyg != null ? formatPyg(product.unitPricePyg) : '—'
                          )}
                        </td>
                        <td>
                          <button type="button" className="inventory-status" disabled={!canWrite || saving} onClick={() => void toggleStatus(product)}>
                            {t(`inventory.status.${product.status === 'ACTIVE' ? 'active' : 'inactive'}`)}
                          </button>
                        </td>
                        {canWrite ? (
                          <td>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => setOpenId(openId === product.id ? null : product.id)}
                            >
                              {t('inventory.movements')}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                      {openId === product.id ? (
                        <tr className="inventory-movements-row">
                          <td colSpan={canWrite ? 7 : 6}>
                            {movementsQ.isLoading ? (
                              <Loader2 className="animate-spin" size={16} />
                            ) : (movementsQ.data ?? []).length === 0 ? (
                              <p>{t('inventory.noMovements')}</p>
                            ) : (
                              <ul>
                                {(movementsQ.data ?? []).map(mov => (
                                  <li key={mov.id}>
                                    {new Date(mov.createdAt).toLocaleString()} · {t(`inventory.reason.${mov.reason}`)} · {mov.quantity > 0 ? `+${mov.quantity}` : mov.quantity}
                                    {mov.notes ? ` · ${mov.notes}` : ''}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
