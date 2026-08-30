import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MoreVertical } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { useRole } from '../hooks/useRole';
import {
  actionNeedsPayment,
  actionNeedsShipping,
  bootstrapKamproKey,
  kamproFetch,
  type KamproOrder,
  type OrderAction,
  type OrderStatus,
  type PaymentMethod,
} from '../services/kamproApi';
import { formatPyg, parsePygInput } from '../utils/orderPricing';
import './Orders.css';

const STAGES: OrderStatus[] = [
  'CONFIRMADO',
  'PENDIENTE_DE_PAGO',
  'PAGO_CONFIRMADO',
  'LISTO_PARA_DESPACHO',
  'ENVIADO',
  'ENTREGADO',
  'CERRADO',
  'CANCELADO',
  'DEVUELTO',
];

const MOVE_STAGES: OrderStatus[] = [
  'CONFIRMADO',
  'PENDIENTE_DE_PAGO',
  'PAGO_CONFIRMADO',
  'LISTO_PARA_DESPACHO',
  'ENVIADO',
  'ENTREGADO',
  'CERRADO',
];

function allowsShippingCost(order: KamproOrder): boolean {
  if (order.canEditShipping === true) return true;
  return order.status === 'ENVIADO' || order.status === 'ENTREGADO' || order.status === 'CERRADO';
}

function formatOrderDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function ShippingCostCell({
  order,
  disabled,
  onSave,
}: {
  order: KamproOrder;
  disabled: boolean;
  onSave: (order: KamproOrder, value: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(order.shippingCostPyg != null ? String(order.shippingCostPyg) : '');

  useEffect(() => {
    setValue(order.shippingCostPyg != null ? String(order.shippingCostPyg) : '');
  }, [order.id, order.shippingCostPyg]);

  return (
    <input
      className="orders-shipping-input"
      type="number"
      min={0}
      value={value}
      disabled={disabled}
      onChange={e => setValue(e.target.value)}
      onBlur={e => onSave(order, e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      aria-label={t('orders.fields.shippingCost')}
    />
  );
}

function OrderKebabMenu({
  order,
  disabled,
  open,
  onOpenChange,
  onMove,
  onCancel,
  onRefund,
}: {
  order: KamproOrder;
  disabled: boolean;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onMove: (status: OrderStatus) => void;
  onCancel: () => void;
  onRefund: () => void;
}) {
  const { t } = useTranslation();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, maxHeight: 280, openUp: false });

  const place = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = 220;
    const gap = 6;
    const margin = 8;
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(320, (openUp ? spaceAbove : spaceBelow) - gap));
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
    <div className={`orders-menu${open ? ' open' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className="orders-menu-trigger"
        disabled={disabled}
        aria-label={t('orders.moreActions')}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <MoreVertical size={16} />
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              className="orders-menu-pop"
              role="menu"
              style={{
                top: coords.openUp ? 'auto' : coords.top,
                bottom: coords.openUp ? window.innerHeight - coords.top : 'auto',
                left: coords.left,
                maxHeight: coords.maxHeight,
              }}
            >
              <p className="orders-menu-label">{t('orders.setStatus')}</p>
              {MOVE_STAGES.filter(status => status !== order.status).map(status => (
                <button key={status} type="button" role="menuitem" onClick={() => onMove(status)}>
                  {t(`orders.status.${status}`)}
                </button>
              ))}
              {order.canCancel ? (
                <button type="button" role="menuitem" className="danger" onClick={onCancel}>
                  {t('orders.actions.cancel')}
                </button>
              ) : null}
              {order.canReturn ? (
                <button type="button" role="menuitem" onClick={onRefund}>
                  {t('orders.actions.returnOrder')}
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function Orders() {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('nav.orders'));
  const toast = useToast();
  const { canWrite } = useRole();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState<boolean | null>(null);
  const [stage, setStage] = useState<'all' | OrderStatus>('all');
  const [pending, setPending] = useState<KamproOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<KamproOrder | null>(null);
  const [returnTarget, setReturnTarget] = useState<KamproOrder | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('TRANSFERENCIA');
  const [payRef, setPayRef] = useState('');
  const [closeTarget, setCloseTarget] = useState<KamproOrder | null>(null);
  const [closeShipping, setCloseShipping] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void bootstrapKamproKey().then(setOnline);
  }, []);

  const ordersQ = useQuery({
    queryKey: ['kampro', 'orders'],
    queryFn: () => kamproFetch<KamproOrder[]>('/orders'),
    enabled: online === true,
    refetchInterval: 4000,
  });

  const counts = useMemo(() => {
    const map = Object.fromEntries(STAGES.map(s => [s, 0])) as Record<OrderStatus, number>;
    for (const order of ordersQ.data ?? []) {
      if (map[order.status] === undefined) map[order.status] = 0;
      map[order.status] += 1;
    }
    return map;
  }, [ordersQ.data]);

  const rows = useMemo(() => {
    const list = ordersQ.data ?? [];
    if (stage === 'all') return list;
    return list.filter(order => String(order.status) === stage);
  }, [ordersQ.data, stage]);

  const openClose = (order: KamproOrder) => {
    setCloseTarget(order);
    setCloseShipping(order.shippingCostPyg != null ? String(order.shippingCostPyg) : '');
  };

  const startAction = (order: KamproOrder) => {
    if (!order.primaryAction) return;
    if (actionNeedsPayment(order, order.primaryAction)) {
      setPending(order);
      setPayAmount(order.totalAmount);
      setPayMethod(order.zone === 'INTERIOR' ? 'TRANSFERENCIA' : (order.paymentMethodPreferred ?? 'EFECTIVO'));
      setPayRef('');
      return;
    }
    if (actionNeedsShipping(order.primaryAction)) {
      openClose(order);
      return;
    }
    void runTransition(order, order.primaryAction);
  };

  const runTransition = async (order: KamproOrder, action: OrderAction, withPayment = false) => {
    const shippingCostPyg = action === 'close' ? parsePygInput(closeShipping) : undefined;
    if (action === 'close' && (shippingCostPyg == null || Number.isNaN(shippingCostPyg) || shippingCostPyg < 0)) {
      toast.error(t('orders.toast.error'), t('orders.closeShippingRequired'));
      return;
    }
    setSaving(true);
    try {
      const updated = await kamproFetch<KamproOrder>(`/orders/${order.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          ...(withPayment
            ? {
                payment: {
                  amount: payAmount,
                  method: payMethod,
                  paidAt: new Date().toISOString(),
                  reference: payRef.trim() || undefined,
                },
              }
            : {}),
          ...(action === 'close' ? { shippingCostPyg } : {}),
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['kampro'] });
      if (stage !== 'all') setStage(updated.status);
      toast.success(
        action === 'cancel'
          ? t('orders.toast.cancelled')
          : action === 'returnOrder'
            ? t('orders.toast.returned')
            : t('orders.toast.advanced'),
      );
      if (updated.salesNotify && !updated.salesNotify.ok) {
        toast.error(t('orders.toast.notifyFailed'), updated.salesNotify.error);
      }
      if (updated.salesNotify?.ok) {
        toast.success(t('orders.toast.notified'));
      }
      setPending(null);
      setCloseTarget(null);
      setCancelTarget(null);
      setReturnTarget(null);
      setMenuId(null);
    } catch (err) {
      toast.error(t('orders.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (order: KamproOrder, status: OrderStatus) => {
    setSaving(true);
    try {
      const updated = await kamproFetch<KamproOrder>(`/orders/${order.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await queryClient.invalidateQueries({ queryKey: ['kampro'] });
      if (stage !== 'all') setStage(updated.status);
      toast.success(t('orders.toast.statusSet'));
      setMenuId(null);
      setCancelTarget(null);
      setReturnTarget(null);
    } catch (err) {
      toast.error(t('orders.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const saveShipping = async (order: KamproOrder, value: string) => {
    const trimmed = value.trim();
    const next = trimmed === '' ? null : Math.max(0, Math.round(Number(trimmed) || 0));
    if (next === (order.shippingCostPyg ?? null)) return;
    setSaving(true);
    try {
      await kamproFetch(`/orders/${order.id}/shipping`, {
        method: 'PATCH',
        body: JSON.stringify({ shippingCostPyg: next }),
      });
      await queryClient.invalidateQueries({ queryKey: ['kampro'] });
      toast.success(t('orders.toast.shippingSaved'));
    } catch (err) {
      toast.error(t('orders.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="orders-page">
      <PageHeader
        title={t('nav.orders')}
        subtitle={t('orders.subtitle')}
        badge={
          <span className={`status-badge ${online ? 'connected' : 'offline'}`}>
            {online ? t('kampro.connected') : t('kampro.offline')}
          </span>
        }
      />

      {online === false && (
        <div className="orders-offline">
          <p>{t('orders.offlineHint')}</p>
        </div>
      )}

      {online && ordersQ.isLoading && (
        <div className="orders-loading">
          <Loader2 className="animate-spin" size={28} />
        </div>
      )}

      {online && !ordersQ.isLoading && (
        <>
          <div className="orders-tabs">
            <button type="button" className={`orders-tab${stage === 'all' ? ' active' : ''}`} onClick={() => setStage('all')}>
              {t('orders.filterAll')} ({ordersQ.data?.length ?? 0})
            </button>
            {STAGES.map(status => (
              <button
                key={status}
                type="button"
                className={`orders-tab${stage === status ? ' active' : ''}`}
                onClick={() => setStage(status)}
              >
                {t(`orders.status.${status}`)} ({counts[status]})
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="orders-empty">{stage === 'all' ? t('orders.emptyColumn') : t('orders.emptyFiltered')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('accounting.col.number')}</th>
                    <th>{t('orders.col.date')}</th>
                    <th>{t('orders.col.client')}</th>
                    <th>{t('orders.fields.phone')}</th>
                    <th>{t('orders.fields.sku')}</th>
                    <th>{t('orders.fields.zone')}</th>
                    <th>{t('orders.col.amount')}</th>
                    <th>{t('orders.col.shipping')}</th>
                    <th>{t('orders.col.invoice')}</th>
                    <th>{t('orders.col.stage')}</th>
                    <th>{t('orders.col.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(order => (
                    <tr key={order.id}>
                      <td>{order.numberLabel || '—'}</td>
                      <td>{formatOrderDate(order.createdAt, i18n.language)}</td>
                      <td>{order.contactName || order.recipientName}</td>
                      <td>{order.customerPhone}</td>
                      <td>
                        {order.items?.length
                          ? order.items.map(line => `${line.sku} × ${line.quantity}`).join(', ')
                          : `${order.sku} × ${order.quantity}`}
                      </td>
                      <td>
                        <span className={`order-zone ${order.zone.toLowerCase()}`}>
                          {t(`orders.zoneShort.${order.zone === 'ASUNCION' ? 'asuncion' : 'interior'}`)}
                        </span>
                      </td>
                      <td>{formatPyg(order.totalAmount)}</td>
                      <td>
                        {allowsShippingCost(order) && canWrite ? (
                          <ShippingCostCell order={order} disabled={saving} onSave={saveShipping} />
                        ) : order.shippingCostPyg != null ? (
                          formatPyg(order.shippingCostPyg)
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {order.invoiceNumber ? (
                          <span className="orders-invoice" title={order.invoiceIssuer ?? undefined}>
                            {order.invoiceNumber}
                          </span>
                        ) : (
                          '—'
                        )}
                        <div className="orders-settlement">
                          {t(`orders.fields.${order.invoiceSettlement === 'CREDITO' ? 'creditSale' : 'cashSale'}`)}
                        </div>
                      </td>
                      <td>
                        <span className="order-stage">{t(`orders.status.${order.status}`)}</span>
                      </td>
                      <td>
                        <div className="orders-row-actions">
                          {order.primaryAction && canWrite ? (
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={saving}
                              onClick={() => startAction(order)}
                            >
                              {t(`orders.actions.${order.primaryAction}`)}
                            </button>
                          ) : null}
                          {canWrite ? (
                            <OrderKebabMenu
                              order={order}
                              disabled={saving}
                              open={menuId === order.id}
                              onOpenChange={next => setMenuId(next ? order.id : null)}
                              onMove={status => {
                                setMenuId(null);
                                if (status === 'CERRADO') {
                                  if (order.status !== 'ENTREGADO') {
                                    toast.error(t('orders.toast.error'), t('orders.closeNeedsDelivered'));
                                    return;
                                  }
                                  openClose(order);
                                  return;
                                }
                                void setStatus(order, status);
                              }}
                              onCancel={() => {
                                setMenuId(null);
                                setCancelTarget(order);
                              }}
                              onRefund={() => {
                                setMenuId(null);
                                setReturnTarget(order);
                              }}
                            />
                          ) : !order.primaryAction ? (
                            '—'
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={pending?.primaryAction ? t(`orders.actions.${pending.primaryAction}`) : ''}
        footer={
          pending ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saving || payAmount < 1}
                onClick={() => void runTransition(pending, pending.primaryAction!, true)}
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('orders.confirmPay')}
              </button>
            </>
          ) : undefined
        }
      >
        {pending && (
          <div className="orders-pay-form">
            <label>
              {t('orders.fields.total')}
              <input type="number" min={1} value={payAmount} onChange={e => setPayAmount(Number(e.target.value) || 0)} />
            </label>
            <label>
              {t('orders.fields.payMethod')}
              <select
                value={payMethod}
                onChange={e => setPayMethod(e.target.value as PaymentMethod)}
                disabled={pending.zone === 'INTERIOR'}
              >
                <option value="EFECTIVO">{t('orders.pay.cash')}</option>
                <option value="TRANSFERENCIA">{t('orders.pay.transfer')}</option>
              </select>
            </label>
            <label>
              {t('orders.fields.reference')}
              <input value={payRef} onChange={e => setPayRef(e.target.value)} />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(closeTarget)}
        onClose={() => setCloseTarget(null)}
        title={t('orders.actions.close')}
        footer={
          closeTarget ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setCloseTarget(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saving || closeShipping.trim() === '' || Number.isNaN(parsePygInput(closeShipping))}
                onClick={() => void runTransition(closeTarget, 'close')}
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('orders.confirmClose')}
              </button>
            </>
          ) : undefined
        }
      >
        {closeTarget && (
          <div className="orders-pay-form">
            <p>{t('orders.closeShippingHint')}</p>
            <label>
              {t('orders.fields.shippingCost')}
              <input
                inputMode="numeric"
                value={closeShipping}
                onChange={e => setCloseShipping(e.target.value)}
                placeholder="25000"
              />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={t('orders.actions.cancel')}
        footer={
          cancelTarget ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setCancelTarget(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={saving}
                onClick={() => void runTransition(cancelTarget, 'cancel')}
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('orders.actions.cancel')}
              </button>
            </>
          ) : undefined
        }
      >
        <p>
          {(cancelTarget?.netPaid ?? 0) > 0 ? t('orders.cancelPaidConfirm') : t('orders.cancelConfirm')}
        </p>
      </Modal>

      <Modal
        open={Boolean(returnTarget)}
        onClose={() => setReturnTarget(null)}
        title={t('orders.actions.returnOrder')}
        footer={
          returnTarget ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setReturnTarget(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saving}
                onClick={() => void runTransition(returnTarget, 'returnOrder')}
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                {t('orders.actions.returnOrder')}
              </button>
            </>
          ) : undefined
        }
      >
        <p>{t('orders.refundConfirm')}</p>
      </Modal>
    </div>
  );
}
