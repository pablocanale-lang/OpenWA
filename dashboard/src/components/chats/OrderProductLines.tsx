import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type { KamproProduct } from '../../services/kamproApi';
import {
  discountPercentForQty,
  formatPyg,
  lineTotalPyg,
  quoteLinesTotalPyg,
  type OrderLineDraft,
} from '../../utils/orderPricing';

const SKU_MIME = 'application/x-kampro-sku';

type Props = {
  products: KamproProduct[];
  lines: OrderLineDraft[];
  disabled?: boolean;
  onChange: (lines: OrderLineDraft[]) => void;
};

function newKey() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addProductLine(lines: OrderLineDraft[], product: KamproProduct): OrderLineDraft[] {
  const existing = lines.find(line => line.sku === product.sku);
  if (existing) {
    return lines.map(line => {
      if (line.key !== existing.key) return line;
      const quantity = line.quantity + 1;
      return {
        ...line,
        quantity,
        discount: quantity === 2 ? discountPercentForQty(2) : line.quantity === 2 ? 0 : line.discount,
      };
    });
  }
  return [
    ...lines,
    {
      key: newKey(),
      sku: product.sku,
      quantity: 1,
      discount: 0,
      unitPrice: product.unitPricePyg ?? 0,
    },
  ];
}

export function OrderProductLines({ products, lines, disabled, onChange }: Props) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const dragged = useRef(false);
  const catalog = Object.fromEntries(products.map(p => [p.sku, p]));
  const total = quoteLinesTotalPyg(lines);

  useEffect(() => {
    let changed = false;
    const next = lines.map(line => {
      const product = products.find(item => item.sku === line.sku);
      if (!product || product.unitPricePyg == null || product.unitPricePyg === line.unitPrice) return line;
      changed = true;
      return { ...line, unitPrice: product.unitPricePyg };
    });
    if (changed) onChange(next);
  }, [products, lines, onChange]);

  const applySku = (sku: string) => {
    const product = products.find(p => p.sku === sku);
    if (!product) return;
    onChange(addProductLine(lines, product));
  };

  const updateLine = (key: string, patch: Partial<OrderLineDraft>) => {
    onChange(lines.map(line => (line.key === key ? { ...line, ...patch } : line)));
  };

  const onQty = (line: OrderLineDraft, next: number) => {
    const quantity = Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1;
    updateLine(line.key, {
      quantity,
      discount: quantity === 2 ? discountPercentForQty(2) : line.quantity === 2 ? 0 : line.discount,
    });
  };

  return (
    <div className="order-lines">
      <p className="order-lines__label">{t('orders.fields.products')}</p>
      <div className="order-lines__palette" role="list">
        {products.map(product => (
          <button
            key={product.id}
            type="button"
            role="listitem"
            className="order-lines__chip"
            draggable={!disabled && product.status === 'ACTIVE' && product.unitPricePyg != null}
            disabled={disabled || product.status !== 'ACTIVE' || product.unitPricePyg == null}
            title={t('orders.dragHint')}
            onDragStart={event => {
              dragged.current = true;
              event.dataTransfer.setData(SKU_MIME, product.sku);
              event.dataTransfer.setData('text/plain', product.sku);
              event.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              applySku(product.sku);
            }}
          >
            <GripVertical size={14} aria-hidden />
            <span>
              {product.sku} — {product.name}
            </span>
            <strong>
              {product.unitPricePyg != null ? formatPyg(product.unitPricePyg) : t('orders.noCatalogPriceShort')}
              {' · '}
              {t('orders.stockShort', { count: product.availableQty ?? product.stockQty })}
            </strong>
          </button>
        ))}
      </div>

      <div
        className={`order-lines__drop${over ? ' is-over' : ''}${lines.length === 0 ? ' is-empty' : ''}`}
        onDragOver={event => {
          if (disabled) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={event => {
          event.preventDefault();
          setOver(false);
          if (disabled) return;
          const sku = event.dataTransfer.getData(SKU_MIME) || event.dataTransfer.getData('text/plain');
          if (sku) applySku(sku);
        }}
      >
        {lines.length === 0 ? (
          <p className="order-lines__empty">{t('orders.dropHint')}</p>
        ) : (
          lines.map(line => {
            const product = catalog[line.sku];
            const missingPrice = product && product.unitPricePyg == null && line.unitPrice <= 0;
            return (
              <div key={line.key} className="order-lines__row">
                <div className="order-lines__row-head">
                  <span>
                    {line.sku} — {product?.name ?? line.sku}
                  </span>
                  {!disabled && (
                    <button
                      type="button"
                      className="order-lines__remove"
                      onClick={() => onChange(lines.filter(item => item.key !== line.key))}
                      aria-label={t('orders.removeProduct')}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="order-quick-panel__row">
                  <label>
                    {t('orders.fields.qty')}
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      disabled={disabled}
                      onChange={e => onQty(line, Number(e.target.value))}
                    />
                  </label>
                  <label>
                    {t('orders.fields.discount')}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={line.discount}
                      disabled={disabled}
                      onChange={e => updateLine(line.key, { discount: Number(e.target.value) || 0 })}
                    />
                  </label>
                </div>
                <p className="order-quick-panel__quote">
                  {t('orders.fields.unitPrice')}: {formatPyg(line.unitPrice)}
                </p>
                <p className="order-quick-panel__quote">{formatPyg(lineTotalPyg(line))}</p>
                {line.quantity !== 2 && <p className="order-quick-panel__hint">{t('orders.discountHint')}</p>}
                {missingPrice && <p className="order-quick-panel__hint">{t('orders.noCatalogPrice')}</p>}
                {product && line.quantity > (product.availableQty ?? product.stockQty) && (
                  <p className="order-quick-panel__hint">{t('orders.stockShortfall', { have: product.availableQty ?? product.stockQty })}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {!disabled && products.some(p => !lines.some(line => line.sku === p.sku)) && (
        <button
          type="button"
          className="btn-secondary order-lines__add"
          onClick={() => {
            const next = products.find(p => !lines.some(line => line.sku === p.sku));
            if (next) applySku(next.sku);
          }}
        >
          <Plus size={14} />
          {t('orders.addProduct')}
        </button>
      )}

      <p className="order-lines__total">
        {t('orders.fields.total')}: {formatPyg(total)}
      </p>
    </div>
  );
}
