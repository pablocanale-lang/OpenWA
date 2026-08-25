import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { useRole } from '../hooks/useRole';
import {
  actionNeedsPayment,
  bootstrapKamproKey,
  kamproFetch,
  type KamproOrder,
  type OrderAction,
  type OrderStatus,
  type PaymentMethod,
} from '../services/kamproApi';
import { formatPyg } from '../utils/orderPricing';
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
];

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
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('TRANSFERENCIA');
  const [payRef, setPayRef] = useState('');
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

  const startAction = (order: KamproOrder) => {
    if (!order.primaryAction) return;
    if (actionNeedsPayment(order, order.primaryAction)) {
      setPending(order);
      setPayAmount(order.totalAmount);
      setPayMethod(order.zone === 'INTERIOR' ? 'TRANSFERENCIA' : (order.paymentMethodPreferred ?? 'EFECTIVO'));
      setPayRef('');
      return;
    }
    void runTransition(order, order.primaryAction);
  };

  const runTransition = async (order: KamproOrder, action: OrderAction, withPayment = false) => {
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
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['kampro', 'orders'] });
      if (stage !== 'all') setStage(updated.status);
      toast.success(action === 'cancel' ? t('orders.toast.cancelled') : t('orders.toast.advanced'));
      setPending(null);
      setCancelTarget(null);
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
                    <th>{t('orders.col.date')}</th>
                    <th>{t('orders.col.client')}</th>
                    <th>{t('orders.fields.phone')}</th>
                    <th>{t('orders.fields.sku')}</th>
                    <th>{t('orders.fields.zone')}</th>
                    <th>{t('orders.col.amount')}</th>
                    <th>{t('orders.col.stage')}</th>
                    <th>{t('orders.col.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(order => (
                    <tr key={order.id}>
                      <td>{formatOrderDate(order.createdAt, i18n.language)}</td>
                      <td>{order.contactName || order.recipientName}</td>
                      <td>{order.customerPhone}</td>
                      <td>
                        {order.sku} × {order.quantity}
                      </td>
                      <td>
                        <span className={`order-zone ${order.zone.toLowerCase()}`}>
                          {t(`orders.zoneShort.${order.zone === 'ASUNCION' ? 'asuncion' : 'interior'}`)}
                        </span>
                      </td>
                      <td>{formatPyg(order.totalAmount)}</td>
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
                          {order.canCancel && canWrite ? (
                            <button
                              type="button"
                              className="btn-danger"
                              disabled={saving}
                              onClick={() => setCancelTarget(order)}
                            >
                              {t('orders.actions.cancel')}
                            </button>
                          ) : null}
                          {!order.primaryAction && !order.canCancel ? '—' : null}
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
        <p>{t('orders.cancelConfirm')}</p>
      </Modal>
    </div>
  );
}
