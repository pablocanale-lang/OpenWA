import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin } from 'lucide-react';
import { messageApi, templateApi, type Chat } from '../../services/api';
import {
  actionNeedsPayment,
  kamproFetch,
  type KamproOrder,
  type KamproProduct,
  type OrderAction,
  type PaymentMethod,
  type UpdateOrderPayload,
} from '../../services/kamproApi';
import { latestIncomingLocation, type LocationPin } from '../../utils/chatLocation';
import { discountPercentForQty, formatPyg, quoteTotalPyg } from '../../utils/orderPricing';
import { useRole } from '../../hooks/useRole';
import { useToast } from '../../hooks/useToast';
import { Modal } from '../Modal';
import type { ChatMessageView } from '../../utils/chatMessages';

type Props = {
  order: KamproOrder;
  products: KamproProduct[];
  sessionId: string;
  chat: Chat;
  messages: ChatMessageView[];
};

function composeTemplate(t: { header?: string | null; body: string; footer?: string | null }) {
  return [t.header, t.body, t.footer].filter(Boolean).join('\n\n');
}

function hydrateFromOrder(order: KamproOrder) {
  const catalog = order.quantity > 0 ? Math.round(order.totalAmount / (order.quantity * (1 - order.discountApplied / 100))) : 0;
  return {
    sku: order.sku,
    qty: order.quantity,
    discount: order.discountApplied,
    unitPrice: Number.isFinite(catalog) ? catalog : 0,
    total: order.totalAmount,
    recipientName: order.recipientName,
    invoiceName: order.invoiceName,
    ruc: order.ruc,
    preferredTime: order.preferredTime ?? '',
    payMethod: (order.paymentMethodPreferred ?? 'EFECTIVO') as PaymentMethod,
    locationManual: order.locationText ?? '',
    city: order.city ?? '',
    carrier: order.carrier ?? '',
  };
}

export function OrderCurrentTab({ order, products, sessionId, chat, messages }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { canWrite } = useRole();
  const queryClient = useQueryClient();

  const paid = order.payments.some(p => p.status === 'CONFIRMADO');
  const commercialLocked = paid || (order.status !== 'CONFIRMADO' && order.status !== 'PENDIENTE_DE_PAGO');
  const detailsLocked =
    order.status === 'ENVIADO' ||
    order.status === 'ENTREGADO' ||
    order.status === 'CERRADO' ||
    order.status === 'CANCELADO';

  const [form, setForm] = useState(() => hydrateFromOrder(order));
  const [totalDirty, setTotalDirty] = useState(true);
  const [pin, setPin] = useState<LocationPin | null>(
    order.locationLat != null && order.locationLng != null
      ? { latitude: order.locationLat, longitude: order.locationLng, text: order.locationText ?? '' }
      : null,
  );
  const [saving, setSaving] = useState(false);
  const [askingLocation, setAskingLocation] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(order.totalAmount);
  const [payMethodConfirm, setPayMethodConfirm] = useState<PaymentMethod>(
    order.zone === 'INTERIOR' ? 'TRANSFERENCIA' : (order.paymentMethodPreferred ?? 'EFECTIVO'),
  );
  const [payRef, setPayRef] = useState('');

  useEffect(() => {
    setForm(hydrateFromOrder(order));
    setTotalDirty(true);
    setPin(
      order.locationLat != null && order.locationLng != null
        ? { latitude: order.locationLat, longitude: order.locationLng, text: order.locationText ?? '' }
        : null,
    );
  }, [order.id, order.updatedAt, order.status, order.totalAmount, order.locationText]);

  useEffect(() => {
    if (order.zone !== 'ASUNCION' || detailsLocked) return;
    const found = latestIncomingLocation(messages);
    if (found && !form.locationManual.trim()) {
      setPin(found);
      setForm(prev => ({ ...prev, locationManual: found.text }));
    }
  }, [messages, order.zone, detailsLocked, form.locationManual]);

  const quoted = useMemo(
    () => quoteTotalPyg(form.unitPrice, form.qty, form.discount),
    [form.unitPrice, form.qty, form.discount],
  );
  useEffect(() => {
    if (!totalDirty) setForm(prev => ({ ...prev, total: quoted }));
  }, [quoted, totalDirty]);

  const onQtyChange = (next: number) => {
    const safe = Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1;
    setForm(prev => ({
      ...prev,
      qty: safe,
      discount: safe === 2 ? discountPercentForQty(safe) : prev.qty === 2 ? 0 : prev.discount,
    }));
    setTotalDirty(false);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['kampro', 'orders'] });

  const saveDetails = async () => {
    setSaving(true);
    try {
      const payload: UpdateOrderPayload = {
        recipientName: form.recipientName.trim(),
        invoiceName: form.invoiceName.trim(),
        ruc: form.ruc.trim(),
      };
      if (!commercialLocked) {
        payload.sku = form.sku;
        payload.quantity = form.qty;
        payload.discountApplied = form.discount;
        payload.totalAmount = form.total;
      }
      if (order.zone === 'ASUNCION') {
        payload.locationText = pin?.text || form.locationManual.trim();
        if (pin) {
          payload.locationLat = pin.latitude;
          payload.locationLng = pin.longitude;
        }
        payload.preferredTime = form.preferredTime.trim();
        payload.paymentMethodPreferred = form.payMethod;
      } else {
        payload.city = form.city.trim();
        payload.carrier = form.carrier.trim();
      }
      await kamproFetch(`/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      await invalidate();
      toast.success(t('orders.toast.updated'));
    } catch (err) {
      toast.error(t('orders.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const runTransition = async (action: OrderAction, withPayment = false) => {
    setSaving(true);
    try {
      await kamproFetch(`/orders/${order.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          ...(withPayment
            ? {
                payment: {
                  amount: payAmount,
                  method: payMethodConfirm,
                  paidAt: new Date().toISOString(),
                  reference: payRef.trim() || undefined,
                },
              }
            : {}),
        }),
      });
      await invalidate();
      toast.success(action === 'cancel' ? t('orders.toast.cancelled') : t('orders.toast.advanced'));
      setPayOpen(false);
      setCancelOpen(false);
    } catch (err) {
      toast.error(t('orders.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const startAction = (action: OrderAction) => {
    if (actionNeedsPayment(order, action)) {
      setPayAmount(order.totalAmount);
      setPayMethodConfirm(order.zone === 'INTERIOR' ? 'TRANSFERENCIA' : (order.paymentMethodPreferred ?? 'EFECTIVO'));
      setPayRef('');
      setPayOpen(true);
      return;
    }
    void runTransition(action);
  };

  const askLocation = async () => {
    setAskingLocation(true);
    try {
      let body = t('orders.locationRequestBody');
      try {
        const templates = await templateApi.list(sessionId);
        const match = templates.find(tpl => /ubicaci[oó]n|location|kampro-pedir-ubicacion/i.test(tpl.name));
        if (match) body = composeTemplate(match);
      } catch {
        /* canned body */
      }
      await messageApi.sendText(sessionId, chat.id, body);
      toast.success(t('orders.toast.locationAsked'));
    } catch (err) {
      toast.error(t('orders.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setAskingLocation(false);
    }
  };

  return (
    <div className="order-quick-panel__body">
      <p className="order-quick-panel__status">
        {t(`orders.status.${order.status}`)} · {formatPyg(order.totalAmount)}
      </p>

      <label>
        {t('orders.fields.sku')}
        <select
          value={form.sku}
          disabled={commercialLocked || !canWrite}
          onChange={e => {
            setForm(prev => ({ ...prev, sku: e.target.value }));
            setTotalDirty(false);
          }}
        >
          {products.map(p => (
            <option key={p.id} value={p.sku}>
              {p.sku} — {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="order-quick-panel__row">
        <label>
          {t('orders.fields.qty')}
          <input
            type="number"
            min={1}
            value={form.qty}
            disabled={commercialLocked || !canWrite}
            onChange={e => onQtyChange(Number(e.target.value))}
          />
        </label>
        <label>
          {t('orders.fields.discount')}
          <input
            type="number"
            min={0}
            max={100}
            value={form.discount}
            disabled={commercialLocked || !canWrite}
            onChange={e => {
              setForm(prev => ({ ...prev, discount: Number(e.target.value) || 0 }));
              setTotalDirty(false);
            }}
          />
        </label>
      </div>
      <label>
        {t('orders.fields.unitPrice')}
        <input
          type="number"
          min={0}
          value={form.unitPrice}
          disabled={commercialLocked || !canWrite}
          onChange={e => {
            setForm(prev => ({ ...prev, unitPrice: Number(e.target.value) || 0 }));
            setTotalDirty(false);
          }}
        />
      </label>
      <label>
        {t('orders.fields.total')}
        <input
          type="number"
          min={1}
          value={form.total}
          disabled={commercialLocked || !canWrite}
          onChange={e => {
            setForm(prev => ({ ...prev, total: Number(e.target.value) || 0 }));
            setTotalDirty(true);
          }}
        />
      </label>
      <p className="order-quick-panel__quote">{formatPyg(form.total)}</p>

      {order.zone === 'ASUNCION' ? (
        <div className="order-quick-panel__zone-fields">
          <label>
            {t('orders.fields.maps')}
            <input
              value={form.locationManual}
              disabled={detailsLocked || !canWrite}
              onChange={e => {
                setForm(prev => ({ ...prev, locationManual: e.target.value }));
                if (pin && e.target.value !== pin.text) setPin(null);
              }}
              placeholder={t('orders.fields.mapsPlaceholder')}
            />
          </label>
          {pin ? (
            <p className="order-quick-panel__captured">
              <MapPin size={14} /> {t('orders.locationCaptured')}
            </p>
          ) : (
            !detailsLocked && (
              <button type="button" className="btn-secondary" disabled={askingLocation} onClick={() => void askLocation()}>
                {askingLocation ? <Loader2 className="animate-spin" size={14} /> : null}
                {t('orders.askLocation')}
              </button>
            )
          )}
          <label>
            {t('orders.fields.preferredTime')}
            <input
              value={form.preferredTime}
              disabled={detailsLocked || !canWrite}
              onChange={e => setForm(prev => ({ ...prev, preferredTime: e.target.value }))}
            />
          </label>
          <label>
            {t('orders.fields.payMethod')}
            <select
              value={form.payMethod}
              disabled={detailsLocked || !canWrite}
              onChange={e => setForm(prev => ({ ...prev, payMethod: e.target.value as PaymentMethod }))}
            >
              <option value="EFECTIVO">{t('orders.pay.cash')}</option>
              <option value="TRANSFERENCIA">{t('orders.pay.transfer')}</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="order-quick-panel__zone-fields">
          <label>
            {t('orders.fields.city')}
            <input
              value={form.city}
              disabled={detailsLocked || !canWrite}
              onChange={e => setForm(prev => ({ ...prev, city: e.target.value }))}
            />
          </label>
          <label>
            {t('orders.fields.carrier')}
            <input
              value={form.carrier}
              disabled={detailsLocked || !canWrite}
              onChange={e => setForm(prev => ({ ...prev, carrier: e.target.value }))}
            />
          </label>
        </div>
      )}

      <label>
        {t('orders.fields.recipient')}
        <input
          value={form.recipientName}
          disabled={detailsLocked || !canWrite}
          onChange={e => setForm(prev => ({ ...prev, recipientName: e.target.value }))}
        />
      </label>
      <label>
        {t('orders.fields.invoiceName')}
        <input
          value={form.invoiceName}
          disabled={detailsLocked || !canWrite}
          onChange={e => setForm(prev => ({ ...prev, invoiceName: e.target.value }))}
        />
      </label>
      <label>
        {t('orders.fields.ruc')}
        <input
          value={form.ruc}
          disabled={detailsLocked || !canWrite}
          onChange={e => setForm(prev => ({ ...prev, ruc: e.target.value }))}
        />
      </label>

      {canWrite && !detailsLocked && (
        <button type="button" className="btn-secondary" disabled={saving} onClick={() => void saveDetails()}>
          {saving ? <Loader2 className="animate-spin" size={16} /> : null}
          {t('orders.saveData')}
        </button>
      )}

      {canWrite && (order.primaryAction || order.canCancel) && (
        <div className="order-quick-panel__actions">
          {order.primaryAction && (
            <button
              type="button"
              className="btn-primary"
              disabled={saving}
              onClick={() => startAction(order.primaryAction!)}
            >
              {t(`orders.actions.${order.primaryAction}`)}
            </button>
          )}
          {order.canCancel && (
            <button type="button" className="btn-danger" disabled={saving} onClick={() => setCancelOpen(true)}>
              {t('orders.actions.cancel')}
            </button>
          )}
        </div>
      )}

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={order.primaryAction ? t(`orders.actions.${order.primaryAction}`) : ''}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPayOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || payAmount < 1 || !order.primaryAction}
              onClick={() => void runTransition(order.primaryAction!, true)}
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : null}
              {t('orders.confirmPay')}
            </button>
          </>
        }
      >
        <div className="order-pay-form">
          <label>
            {t('orders.fields.total')}
            <input type="number" min={1} value={payAmount} onChange={e => setPayAmount(Number(e.target.value) || 0)} />
          </label>
          <label>
            {t('orders.fields.payMethod')}
            <select
              value={payMethodConfirm}
              onChange={e => setPayMethodConfirm(e.target.value as PaymentMethod)}
              disabled={order.zone === 'INTERIOR'}
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
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('orders.actions.cancel')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCancelOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-danger" disabled={saving} onClick={() => void runTransition('cancel')}>
              {saving ? <Loader2 className="animate-spin" size={16} /> : null}
              {t('orders.actions.cancel')}
            </button>
          </>
        }
      >
        <p>{t('orders.cancelConfirm')}</p>
      </Modal>
    </div>
  );
}
