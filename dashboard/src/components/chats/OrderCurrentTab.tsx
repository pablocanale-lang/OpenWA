import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin } from 'lucide-react';
import { messageApi, templateApi, type Chat } from '../../services/api';
import {
  actionNeedsPayment,
  actionNeedsShipping,
  kamproFetch,
  type KamproOrder,
  type KamproProduct,
  type OrderAction,
  type PaymentMethod,
  type InvoiceSettlement,
  type UpdateOrderPayload,
} from '../../services/kamproApi';
import { latestIncomingLocation, type LocationPin } from '../../utils/chatLocation';
import { formatPyg, parsePygInput, sanitizeRucInput, toDatetimeLocalValue, type OrderLineDraft } from '../../utils/orderPricing';
import { useRole } from '../../hooks/useRole';
import { useToast } from '../../hooks/useToast';
import { Modal } from '../Modal';
import type { ChatMessageView } from '../../utils/chatMessages';
import { OrderProductLines } from './OrderProductLines';

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

function linesFromOrder(order: KamproOrder): OrderLineDraft[] {
  const source: Array<{ id?: string; sku: string; quantity: number; discountApplied: number; unitPricePyg: number }> =
    order.items && order.items.length > 0
      ? order.items
      : [
          {
            sku: order.sku,
            quantity: order.quantity,
            discountApplied: order.discountApplied,
            unitPricePyg:
              order.quantity > 0
                ? Math.round(order.totalAmount / (order.quantity * (1 - order.discountApplied / 100) || 1))
                : 0,
          },
        ];
  return source.map((item, index) => ({
    key: item.id ?? `legacy-${index}`,
    sku: item.sku,
    quantity: item.quantity,
    discount: item.discountApplied,
    unitPrice: item.unitPricePyg,
  }));
}

function hydrateFromOrder(order: KamproOrder) {
  return {
    lines: linesFromOrder(order),
    recipientName: order.recipientName,
    invoiceName: order.invoiceName,
    ruc: order.ruc,
    invoiceSettlement: (order.invoiceSettlement ?? 'CONTADO') as InvoiceSettlement,
    preferredTime: toDatetimeLocalValue(order.preferredTime ?? ''),
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

  const paid = (order.netPaid ?? 0) > 0;
  const commercialLocked = !canWrite || order.canEditCommercial === false;
  const detailsLocked = !canWrite || order.canEditDetails === false;

  const [form, setForm] = useState(() => hydrateFromOrder(order));
  const [pin, setPin] = useState<LocationPin | null>(
    order.locationLat != null && order.locationLng != null
      ? {
          latitude: order.locationLat,
          longitude: order.locationLng,
          text: order.locationText ?? '',
          captured: true,
        }
      : null,
  );
  const [saving, setSaving] = useState(false);
  const [askingLocation, setAskingLocation] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(order.totalAmount);
  const [payMethodConfirm, setPayMethodConfirm] = useState<PaymentMethod>(
    order.zone === 'INTERIOR' ? 'TRANSFERENCIA' : (order.paymentMethodPreferred ?? 'EFECTIVO'),
  );
  const [payRef, setPayRef] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeShipping, setCloseShipping] = useState(
    order.shippingCostPyg != null ? String(order.shippingCostPyg) : '',
  );

  useEffect(() => {
    setForm(hydrateFromOrder(order));
    setPin(
      order.locationLat != null && order.locationLng != null
        ? {
          latitude: order.locationLat,
          longitude: order.locationLng,
          text: order.locationText ?? '',
          captured: true,
        }
        : null,
    );
    setCloseShipping(order.shippingCostPyg != null ? String(order.shippingCostPyg) : '');
  }, [order.id, order.updatedAt, order.status, order.totalAmount, order.locationText, order.shippingCostPyg]);

  useEffect(() => {
    if (order.zone !== 'ASUNCION' || detailsLocked) return;
    const found = latestIncomingLocation(messages);
    if (found && !form.locationManual.trim()) {
      setPin(found);
      setForm(prev => ({ ...prev, locationManual: found.text }));
    }
  }, [messages, order.zone, detailsLocked, form.locationManual]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['kampro'] });

  const saveDetails = async () => {
    setSaving(true);
    try {
      const payload: UpdateOrderPayload = {
        recipientName: form.recipientName.trim(),
        invoiceName: form.invoiceName.trim(),
        ruc: form.ruc.trim(),
        invoiceSettlement: form.invoiceSettlement,
      };
      if (!commercialLocked) {
        payload.items = form.lines.map(line => ({
          sku: line.sku,
          quantity: line.quantity,
          discountApplied: line.discount,
          unitPricePyg: line.unitPrice,
        }));
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
      if (order.canEditShipping) {
        const shipping = parsePygInput(closeShipping);
        payload.shippingCostPyg = closeShipping.trim() === '' || !Number.isFinite(shipping) ? null : shipping;
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
    const shippingCostPyg = action === 'close' ? parsePygInput(closeShipping) : undefined;
    if (action === 'close' && (!Number.isFinite(shippingCostPyg) || (shippingCostPyg as number) < 0)) {
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
                  method: payMethodConfirm,
                  paidAt: new Date().toISOString(),
                  reference: payRef.trim() || undefined,
                },
              }
            : {}),
          ...(action === 'close' ? { shippingCostPyg } : {}),
        }),
      });
      await invalidate();
      toast.success(action === 'cancel' ? t('orders.toast.cancelled') : action === 'returnOrder' ? t('orders.toast.returned') : t('orders.toast.advanced'));
      if (updated.salesNotify && !updated.salesNotify.ok) {
        toast.error(t('orders.toast.notifyFailed'), updated.salesNotify.error);
      }
      if (updated.salesNotify?.ok) {
        toast.success(t('orders.toast.notified'));
      }
      setPayOpen(false);
      setCloseOpen(false);
      setCancelOpen(false);
      setReturnOpen(false);
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
    if (actionNeedsShipping(action)) {
      setCloseShipping(order.shippingCostPyg != null ? String(order.shippingCostPyg) : '');
      setCloseOpen(true);
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
        {order.invoiceNumber ? ` · ${t('orders.fields.invoice')} ${order.invoiceNumber}` : ''}
      </p>

      <OrderProductLines
        products={products}
        lines={form.lines}
        disabled={commercialLocked}
        onChange={next => setForm(prev => ({ ...prev, lines: next }))}
      />

      {order.zone === 'ASUNCION' ? (
        <div className="order-quick-panel__zone-fields">
          <label>
            {t('orders.fields.maps')}
            <input
              value={form.locationManual}
              disabled={detailsLocked}
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
              type="datetime-local"
              value={form.preferredTime}
              disabled={detailsLocked}
              onChange={e => setForm(prev => ({ ...prev, preferredTime: e.target.value }))}
            />
          </label>
          <label>
            {t('orders.fields.payMethod')}
            <select
              value={form.payMethod}
              disabled={detailsLocked}
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
              disabled={detailsLocked}
              onChange={e => setForm(prev => ({ ...prev, city: e.target.value }))}
            />
          </label>
          <label>
            {t('orders.fields.carrier')}
            <input
              value={form.carrier}
              disabled={detailsLocked}
              onChange={e => setForm(prev => ({ ...prev, carrier: e.target.value }))}
            />
          </label>
        </div>
      )}

      <label>
        {t('orders.fields.recipient')}
        <input
          value={form.recipientName}
          disabled={detailsLocked}
          onChange={e => setForm(prev => ({ ...prev, recipientName: e.target.value }))}
        />
      </label>
      <label>
        {t('orders.fields.invoiceName')}
        <input
          value={form.invoiceName}
          disabled={detailsLocked}
          onChange={e => setForm(prev => ({ ...prev, invoiceName: e.target.value }))}
        />
      </label>
      <label>
        {t('orders.fields.ruc')}
        <input
          value={form.ruc}
          disabled={detailsLocked}
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]+(-[0-9]+)?"
          onChange={e => setForm(prev => ({ ...prev, ruc: sanitizeRucInput(e.target.value) }))}
        />
      </label>
      <label>
        {t('orders.fields.settlement')}
        <select
          value={form.invoiceSettlement}
          disabled={detailsLocked}
          onChange={e => setForm(prev => ({ ...prev, invoiceSettlement: e.target.value as InvoiceSettlement }))}
        >
          <option value="CONTADO">{t('orders.fields.cashSale')}</option>
          <option value="CREDITO">{t('orders.fields.creditSale')}</option>
        </select>
      </label>

      {order.canEditShipping && (
        <label>
          {t('orders.fields.shippingCost')}
          <input
            value={closeShipping}
            disabled={!canWrite}
            inputMode="numeric"
            placeholder="25000"
            onChange={e => setCloseShipping(e.target.value)}
          />
          <span className="order-quick-panel__hint">{t('orders.closeShippingHint')}</span>
        </label>
      )}

      {canWrite && order.canEditDetails !== false && (
        <button type="button" className="btn-secondary" disabled={saving} onClick={() => void saveDetails()}>
          {saving ? <Loader2 className="animate-spin" size={16} /> : null}
          {t('orders.saveData')}
        </button>
      )}

      {canWrite && (order.primaryAction || order.canCancel || order.canReturn) && (
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
          {order.canReturn && (
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => setReturnOpen(true)}>
              {t('orders.actions.returnOrder')}
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
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={t('orders.actions.close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCloseOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || closeShipping.trim() === '' || Number.isNaN(parsePygInput(closeShipping))}
              onClick={() => void runTransition('close')}
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : null}
              {t('orders.confirmClose')}
            </button>
          </>
        }
      >
        <p>{t('orders.closeShippingHint')}</p>
        <div className="order-pay-form">
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
        <p>{paid ? t('orders.cancelPaidConfirm') : t('orders.cancelConfirm')}</p>
      </Modal>

      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title={t('orders.actions.returnOrder')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReturnOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void runTransition('returnOrder')}>
              {saving ? <Loader2 className="animate-spin" size={16} /> : null}
              {t('orders.actions.returnOrder')}
            </button>
          </>
        }
      >
        <p>{t('orders.refundConfirm')}</p>
      </Modal>
    </div>
  );
}
