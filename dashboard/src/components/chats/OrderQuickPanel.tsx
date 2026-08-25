import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, X } from 'lucide-react';
import { messageApi, templateApi, type Chat } from '../../services/api';
import {
  bootstrapKamproKey,
  isOpenOrder,
  kamproFetch,
  type CreateOrderPayload,
  type KamproOrder,
  type KamproProduct,
  type OrderZone,
  type PaymentMethod,
} from '../../services/kamproApi';
import { latestIncomingLocation, type LocationPin } from '../../utils/chatLocation';
import { discountPercentForQty, formatPyg, quoteTotalPyg } from '../../utils/orderPricing';
import { useRole } from '../../hooks/useRole';
import { useToast } from '../../hooks/useToast';
import type { ChatMessageView } from '../../utils/chatMessages';
import { OrderCurrentTab } from './OrderCurrentTab';
import './OrderQuickPanel.css';

type Props = {
  sessionId: string;
  chat: Chat;
  phoneDigits: string | null;
  phoneDisplay: string;
  contactName: string;
  messages: ChatMessageView[];
  onClose: () => void;
};

function composeTemplate(t: { header?: string | null; body: string; footer?: string | null }) {
  return [t.header, t.body, t.footer].filter(Boolean).join('\n\n');
}

export function OrderQuickPanel({
  sessionId,
  chat,
  phoneDigits,
  phoneDisplay,
  contactName,
  messages,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { canWrite } = useRole();
  const queryClient = useQueryClient();

  const [online, setOnline] = useState<boolean | null>(null);
  const [sku, setSku] = useState('');
  const [qty, setQty] = useState(2);
  const [discount, setDiscount] = useState(() => discountPercentForQty(2));
  const [unitPrice, setUnitPrice] = useState(0);
  const [total, setTotal] = useState(0);
  const [totalDirty, setTotalDirty] = useState(false);
  const [zone, setZone] = useState<OrderZone | ''>('');
  const [recipientName, setRecipientName] = useState(contactName);
  const [invoiceName, setInvoiceName] = useState(contactName);
  const [ruc, setRuc] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('EFECTIVO');
  const [pin, setPin] = useState<LocationPin | null>(null);
  const [locationManual, setLocationManual] = useState('');
  const [city, setCity] = useState('');
  const [carrier, setCarrier] = useState('');
  const [saving, setSaving] = useState(false);
  const [askingLocation, setAskingLocation] = useState(false);
  const [tab, setTab] = useState<'current' | 'new' | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  useEffect(() => {
    void bootstrapKamproKey().then(setOnline);
  }, []);

  const productsQ = useQuery({
    queryKey: ['kampro', 'products'],
    queryFn: () => kamproFetch<KamproProduct[]>('/products'),
    enabled: online === true,
  });
  const products = useMemo(
    () => (productsQ.data ?? []).filter(p => p.status !== 'INACTIVE'),
    [productsQ.data],
  );

  const contactOrdersQ = useQuery({
    queryKey: ['kampro', 'orders', 'chat', phoneDigits, chat.id],
    queryFn: () => {
      const q = new URLSearchParams();
      if (phoneDigits) q.set('phone', phoneDigits);
      q.set('chatId', chat.id);
      return kamproFetch<KamproOrder[]>(`/orders?${q.toString()}`);
    },
    enabled: online === true,
    refetchInterval: 4000,
  });

  const openOrders = useMemo(
    () => (contactOrdersQ.data ?? []).filter(order => isOpenOrder(order.status)),
    [contactOrdersQ.data],
  );
  const currentOrder = openOrders.find(order => order.id === selectedOrderId) ?? openOrders[0] ?? null;
  const resolvedTab = tab ?? (currentOrder ? 'current' : 'new');

  useEffect(() => {
    if (!sku && products[0]) setSku(products[0].sku);
  }, [products, sku]);

  const selected = products.find(p => p.sku === sku);

  useEffect(() => {
    if (!selected) return;
    setUnitPrice(selected.unitPricePyg ?? 0);
    setTotalDirty(false);
  }, [selected?.id, selected?.unitPricePyg]);

  const quoted = useMemo(() => quoteTotalPyg(unitPrice, qty, discount), [unitPrice, qty, discount]);
  useEffect(() => {
    if (!totalDirty) setTotal(quoted);
  }, [quoted, totalDirty]);

  useEffect(() => {
    if (zone !== 'ASUNCION') return;
    const found = latestIncomingLocation(messages);
    if (found) {
      setPin(found);
      setLocationManual(found.text);
    }
  }, [messages, zone]);

  const locationText = pin?.text || locationManual.trim();
  const asuncionReady =
    Boolean(locationText) && Boolean(preferredTime.trim()) && Boolean(payMethod);
  const interiorReady = Boolean(city.trim()) && Boolean(carrier.trim());
  const commonReady =
    Boolean(sku) &&
    qty >= 1 &&
    total > 0 &&
    Boolean(phoneDigits) &&
    Boolean(recipientName.trim()) &&
    Boolean(invoiceName.trim()) &&
    Boolean(ruc.trim()) &&
    Boolean(zone);
  const canCreate =
    canWrite &&
    commonReady &&
    (zone === 'ASUNCION' ? asuncionReady : zone === 'INTERIOR' ? interiorReady : false);

  const onQtyChange = (next: number) => {
    const safe = Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1;
    setDiscount(prev => (safe === 2 ? discountPercentForQty(safe) : qty === 2 ? 0 : prev));
    setQty(safe);
    setTotalDirty(false);
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

  const create = async () => {
    if (!canCreate || !phoneDigits || !zone) return;
    setSaving(true);
    try {
      const payload: CreateOrderPayload = {
        sku,
        quantity: qty,
        discountApplied: discount,
        totalAmount: total,
        zone,
        customerPhone: phoneDigits,
        contactName: contactName || undefined,
        recipientName: recipientName.trim(),
        invoiceName: invoiceName.trim(),
        ruc: ruc.trim(),
        sessionId,
        chatId: chat.id,
      };
      if (zone === 'ASUNCION') {
        payload.locationText = locationText;
        if (pin) {
          payload.locationLat = pin.latitude;
          payload.locationLng = pin.longitude;
        }
        payload.preferredTime = preferredTime.trim();
        payload.paymentMethodPreferred = payMethod;
      } else {
        payload.city = city.trim();
        payload.carrier = carrier.trim();
      }
      await kamproFetch('/orders', { method: 'POST', body: JSON.stringify(payload) });
      await queryClient.invalidateQueries({ queryKey: ['kampro', 'orders'] });
      toast.success(t('orders.toast.created'));
      setTab('current');
    } catch (err) {
      toast.error(t('orders.toast.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="order-quick-panel" aria-label={t('orders.panelTitle')}>
      <header className="order-quick-panel__header">
        <div>
          <h2>{t('orders.panelTitle')}</h2>
          <p>{currentOrder && resolvedTab === 'current' ? t('orders.currentHint') : t('orders.panelHint')}</p>
        </div>
        <button type="button" className="order-quick-panel__close" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} />
        </button>
      </header>

      {online === false && <p className="order-quick-panel__warn">{t('orders.offlineHint')}</p>}
      {online === null || (online && productsQ.isLoading) ? (
        <div className="order-quick-panel__loading">
          <Loader2 className="animate-spin" size={22} />
        </div>
      ) : (
        <>
          {currentOrder && (
            <div className="order-quick-panel__tabs">
              <button
                type="button"
                className={`order-quick-panel__tab${resolvedTab === 'current' ? ' active' : ''}`}
                onClick={() => setTab('current')}
              >
                {t('orders.tab.current')}
              </button>
              <button
                type="button"
                className={`order-quick-panel__tab${resolvedTab === 'new' ? ' active' : ''}`}
                onClick={() => setTab('new')}
              >
                {t('orders.tab.new')}
              </button>
            </div>
          )}
          {openOrders.length > 1 && resolvedTab === 'current' && (
            <label className="order-quick-panel__pick">
              {t('orders.tab.current')}
              <select value={currentOrder?.id ?? ''} onChange={e => setSelectedOrderId(e.target.value)}>
                {openOrders.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.sku} × {item.quantity} — {t(`orders.status.${item.status}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {resolvedTab === 'current' && currentOrder ? (
            <OrderCurrentTab
              key={currentOrder.id}
              order={currentOrder}
              products={products}
              sessionId={sessionId}
              chat={chat}
              messages={messages}
            />
          ) : (
        <div className="order-quick-panel__body">
          <label>
            {t('orders.fields.sku')}
            <select
              value={sku}
              onChange={e => {
                setSku(e.target.value);
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
              <input type="number" min={1} value={qty} onChange={e => onQtyChange(Number(e.target.value))} />
            </label>
            <label>
              {t('orders.fields.discount')}
              <input
                type="number"
                min={0}
                max={100}
                value={discount}
                onChange={e => {
                  setDiscount(Number(e.target.value) || 0);
                  setTotalDirty(false);
                }}
              />
            </label>
          </div>
          {qty !== 2 && <p className="order-quick-panel__hint">{t('orders.discountHint')}</p>}
          {selected && selected.unitPricePyg == null && (
            <p className="order-quick-panel__hint">{t('orders.noCatalogPrice')}</p>
          )}
          <label>
            {t('orders.fields.unitPrice')}
            <input
              type="number"
              min={0}
              value={unitPrice}
              onChange={e => {
                setUnitPrice(Number(e.target.value) || 0);
                setTotalDirty(false);
              }}
            />
          </label>
          <label>
            {t('orders.fields.total')}
            <input
              type="number"
              min={1}
              value={total}
              onChange={e => {
                setTotal(Number(e.target.value) || 0);
                setTotalDirty(true);
              }}
            />
          </label>
          <p className="order-quick-panel__quote">{formatPyg(total)}</p>

          <label>
            {t('orders.fields.phone')}
            <input value={phoneDisplay} readOnly />
          </label>
          {!phoneDigits && <p className="order-quick-panel__warn">{t('orders.noPhone')}</p>}

          <fieldset className="order-quick-panel__zone">
            <legend>{t('orders.fields.zone')}</legend>
            <label>
              <input
                type="radio"
                name="order-zone"
                checked={zone === 'ASUNCION'}
                onChange={() => setZone('ASUNCION')}
              />
              {t('orders.zone.asuncion')}
            </label>
            <label>
              <input
                type="radio"
                name="order-zone"
                checked={zone === 'INTERIOR'}
                onChange={() => setZone('INTERIOR')}
              />
              {t('orders.zone.interior')}
            </label>
          </fieldset>

          {zone === 'ASUNCION' && (
            <div className="order-quick-panel__zone-fields">
              <label>
                {t('orders.fields.maps')}
                <input
                  value={locationManual}
                  onChange={e => {
                    setLocationManual(e.target.value);
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
                <button type="button" className="btn-secondary" disabled={askingLocation} onClick={() => void askLocation()}>
                  {askingLocation ? <Loader2 className="animate-spin" size={14} /> : null}
                  {t('orders.askLocation')}
                </button>
              )}
              <label>
                {t('orders.fields.recipient')}
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} />
              </label>
              <label>
                {t('orders.fields.invoiceName')}
                <input value={invoiceName} onChange={e => setInvoiceName(e.target.value)} />
              </label>
              <label>
                {t('orders.fields.ruc')}
                <input value={ruc} onChange={e => setRuc(e.target.value)} />
              </label>
              <label>
                {t('orders.fields.preferredTime')}
                <input value={preferredTime} onChange={e => setPreferredTime(e.target.value)} />
              </label>
              <label>
                {t('orders.fields.payMethod')}
                <select value={payMethod} onChange={e => setPayMethod(e.target.value as PaymentMethod)}>
                  <option value="EFECTIVO">{t('orders.pay.cash')}</option>
                  <option value="TRANSFERENCIA">{t('orders.pay.transfer')}</option>
                </select>
              </label>
              <p className="order-quick-panel__hint">{t('orders.codHint')}</p>
            </div>
          )}

          {zone === 'INTERIOR' && (
            <div className="order-quick-panel__zone-fields">
              <label>
                {t('orders.fields.city')}
                <input value={city} onChange={e => setCity(e.target.value)} />
              </label>
              <label>
                {t('orders.fields.carrier')}
                <input value={carrier} onChange={e => setCarrier(e.target.value)} />
              </label>
              <label>
                {t('orders.fields.recipient')}
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} />
              </label>
              <label>
                {t('orders.fields.invoiceName')}
                <input value={invoiceName} onChange={e => setInvoiceName(e.target.value)} />
              </label>
              <label>
                {t('orders.fields.ruc')}
                <input value={ruc} onChange={e => setRuc(e.target.value)} />
              </label>
              <p className="order-quick-panel__hint">{t('orders.prepaidHint')}</p>
            </div>
          )}

          <button type="button" className="btn-primary" disabled={!canCreate || saving} onClick={() => void create()}>
            {saving ? <Loader2 className="animate-spin" size={16} /> : null}
            {t('orders.create')}
          </button>
        </div>
          )}
        </>
      )}
    </aside>
  );
}
