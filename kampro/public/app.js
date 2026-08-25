const KEY_STORAGE = 'kampro_api_key';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function apiKey() {
  return $('#apiKey').value.trim();
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function table(headers, rows) {
  if (!rows.length) return `<p class="muted" style="padding:1rem">Sin datos todavía.</p>`;
  return `<table class="data"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function opt(list, valueKey, labelFn, selected) {
  return list
    .map((item) => {
      const value = item[valueKey];
      const label = labelFn(item);
      return `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`;
    })
    .join('');
}

function formData(form) {
  const raw = Object.fromEntries(new FormData(form).entries());
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === '') continue;
    out[k] = v;
  }
  return out;
}

let cache = { products: [], suppliers: [], forwarders: [], purchases: [], shipments: [], costs: [], receptions: [] };

async function refresh() {
  const [products, suppliers, forwarders, purchases, shipments, costs, receptions] = await Promise.all([
    api('/products'),
    api('/suppliers'),
    api('/forwarders'),
    api('/purchases'),
    api('/shipments'),
    api('/import-costs'),
    api('/receptions'),
  ]);
  cache = { products, suppliers, forwarders, purchases, shipments, costs, receptions };
  renderAll();
}

function fillSelects() {
  const productOpts = opt(cache.products, 'id', (p) => `${p.sku} — ${p.name}`);
  const supplierOpts = opt(cache.suppliers, 'id', (s) => s.name);
  const forwarderOpts = opt(cache.forwarders, 'id', (f) => f.name);
  const shipmentOpts = opt(cache.shipments, 'id', (s) => `${s.reference} (${s.status})`);
  const purchaseOpts = opt(
    cache.purchases,
    'id',
    (p) => `${p.product?.sku ?? ''} ×${p.quantity} · ${p.supplier?.name ?? ''}`,
  );
  const skuOpts = opt(cache.products, 'sku', (p) => `${p.sku} — ${p.name}`);

  $$('select[name="productId"]').forEach((el) => {
    el.innerHTML = productOpts;
  });
  $$('select[name="supplierId"]').forEach((el) => {
    el.innerHTML = supplierOpts;
  });
  $$('select[name="forwarderId"]').forEach((el) => {
    el.innerHTML = forwarderOpts;
  });
  const shipEmpty = `<option value="">— sin asignar —</option>${shipmentOpts}`;
  const shipRequired = shipmentOpts;
  const purchaseEmpty = `<option value="">— ninguna / prorratear —</option>${purchaseOpts}`;
  $('form[id="formPurchase"] select[name="shipmentId"]').innerHTML = shipEmpty;
  $('form[id="formShipment"] select[name="purchaseId"]').innerHTML = `<option value="">— ninguna —</option>${purchaseOpts}`;
  $('form[id="formCost"] select[name="shipmentId"]').innerHTML = shipRequired;
  $('form[id="formCost"] select[name="purchaseId"]').innerHTML = purchaseEmpty;
  $('form[id="formReception"] select[name="shipmentId"]').innerHTML = shipRequired;
  $('form[id="formReception"] select[name="purchaseId"]').innerHTML = purchaseOpts;
  $('#reportSku').innerHTML = skuOpts;
}

function renderAll() {
  fillSelects();

  $('#productsTable').innerHTML = table(
    ['SKU', 'Nombre', 'Capacidad', 'Stock', 'Costo unit. PYG', 'Precio venta'],
    cache.products.map(
      (p) =>
        `<tr><td>${p.sku}</td><td>${p.name}</td><td>${p.capacityMl} ml</td><td>${p.stockQty}</td><td>${p.unitCostPyg ?? '—'}</td><td>${p.unitPricePyg ?? '—'}</td></tr>`,
    ),
  );

  $('#suppliersTable').innerHTML = table(
    ['Nombre', 'País', 'Contacto', 'Alibaba', 'SKUs'],
    cache.suppliers.map(
      (s) =>
        `<tr><td>${s.name}</td><td>${s.country}</td><td>${s.contact ?? '—'}</td><td>${s.alibabaUrl ? `<a href="${s.alibabaUrl}" target="_blank" rel="noreferrer">perfil</a>` : '—'}</td><td>${(s.products || []).map((x) => x.product?.sku).filter(Boolean).join(', ') || '—'}</td></tr>`,
    ),
  );

  $('#purchasesTable').innerHTML = table(
    ['Fecha', 'SKU', 'Proveedor', 'Cant.', 'Unitario', 'Total', 'FX', 'Envío'],
    cache.purchases.map(
      (p) =>
        `<tr><td>${(p.purchasedAt || '').slice(0, 10)}</td><td>${p.product?.sku ?? ''}</td><td>${p.supplier?.name ?? ''}</td><td>${p.quantity}</td><td>${p.unitPrice} ${p.currency}</td><td>${p.total} ${p.currency}</td><td>${p.fxRateToPyg ?? '—'}</td><td>${p.shipment?.reference ?? '—'}</td></tr>`,
    ),
  );

  $('#shipmentsTable').innerHTML = table(
    ['Referencia', 'Forwarder', 'Estado', 'Salida', 'ETA', 'Llegada', 'Compras'],
    cache.shipments.map(
      (s) =>
        `<tr><td>${s.reference}</td><td>${s.forwarder?.name ?? ''}</td><td>${s.status}</td><td>${(s.departedAt || '').slice(0, 10) || '—'}</td><td>${(s.etaAt || '').slice(0, 10) || '—'}</td><td>${(s.arrivedAt || '').slice(0, 10) || '—'}</td><td>${(s.purchases || []).map((p) => p.product?.sku).join(', ') || '—'}</td></tr>`,
    ),
  );

  $('#costsTable').innerHTML = table(
    ['Envío', 'Tipo', 'Monto', 'FX', 'Compra', 'Descripción'],
    cache.costs.map(
      (c) =>
        `<tr><td>${c.shipment?.reference ?? c.shipmentId}</td><td>${c.type}</td><td>${c.amount} ${c.currency}</td><td>${c.fxRateToPyg ?? '—'}</td><td>${c.purchase?.product?.sku ?? 'prorrateo'}</td><td>${c.description ?? '—'}</td></tr>`,
    ),
  );

  $('#receptionsTable').innerHTML = table(
    ['Fecha', 'SKU', 'Recibido', 'Incidencias', 'Envío'],
    cache.receptions.map((r) => {
      const inc = (r.incidents || []).map((i) => `${i.type} ${i.quantity}`).join(', ') || '—';
      return `<tr><td>${(r.receivedAt || '').slice(0, 10)}</td><td>${r.purchase?.product?.sku ?? ''}</td><td>${r.receivedQty}</td><td>${inc}</td><td>${r.shipment?.reference ?? ''}</td></tr>`;
    }),
  );
}

async function loadReport() {
  const sku = $('#reportSku').value;
  if (!sku) return;
  const report = await api(`/reports/sku/${encodeURIComponent(sku)}/landed-cost`);
  const pyg = report.pygEquivalent;
  $('#reportKpis').innerHTML = `
    <div><span>Stock</span><strong>${report.stockQty}</strong></div>
    <div><span>Comprado</span><strong>${report.qtyPurchased}</strong></div>
    <div><span>Recibido</span><strong>${report.qtyReceived}</strong></div>
    <div><span>Costo acumulado PYG</span><strong>${pyg?.landed ?? '—'}</strong></div>
    <div><span>Costo unit. PYG</span><strong>${pyg?.unitLanded ?? '—'}</strong></div>
  `;
  $('#reportNote').hidden = !report.note;
  $('#reportNote').textContent = report.note || '';
  const currencyLines = Object.entries(report.totalsByCurrency || {})
    .map(([cur, t]) => `${cur}: compra ${t.purchase} + import ${t.import}`)
    .join(' · ');
  $('#reportTable').innerHTML =
    (currencyLines ? `<p class="muted" style="padding:0.8rem 1rem 0">Por moneda: ${currencyLines}</p>` : '') +
    table(
      ['Fecha', 'Proveedor', 'Envío / Forwarder', 'Cant.', 'Recibido', 'Compra', 'Import. alloc.', 'Landed PYG'],
      (report.history || []).map((h) => {
        const importTxt = h.importAllocated
          .map((c) => `${c.allocatedAmount} ${c.currency}${c.shared ? '*' : ''}`)
          .join(', ') || '—';
        return `<tr>
          <td>${String(h.purchase.purchasedAt).slice(0, 10)}</td>
          <td>${h.purchase.supplierName}</td>
          <td>${h.purchase.shipmentReference ?? '—'} ${h.forwarderName ? `/ ${h.forwarderName}` : ''}</td>
          <td>${h.purchase.quantity}</td>
          <td>${h.qtyReceived}</td>
          <td>${h.purchase.total} ${h.purchase.currency}</td>
          <td>${importTxt}</td>
          <td>${h.landedPyg ?? '—'}</td>
        </tr>`;
      }),
    );
}

$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#panel-${btn.dataset.tab}`).classList.add('active');
  });
});

$('#formSupplier').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/suppliers', { method: 'POST', body: JSON.stringify(formData(e.target)) });
    e.target.reset();
    e.target.country.value = 'CN';
    await refresh();
    toast('Proveedor creado');
  } catch (err) {
    toast(err.message);
  }
});

$('#formPurchase').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = formData(e.target);
    body.quantity = Number(body.quantity);
    await api('/purchases', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    e.target.currency.value = 'USD';
    await refresh();
    toast('Compra registrada');
  } catch (err) {
    toast(err.message);
  }
});

$('#formForwarder').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/forwarders', { method: 'POST', body: JSON.stringify(formData(e.target)) });
    e.target.reset();
    await refresh();
    toast('Forwarder creado');
  } catch (err) {
    toast(err.message);
  }
});

$('#formShipment').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = formData(e.target);
    const purchaseId = body.purchaseId;
    delete body.purchaseId;
    if (purchaseId) body.purchaseIds = [purchaseId];
    await api('/shipments', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    await refresh();
    toast('Envío registrado');
  } catch (err) {
    toast(err.message);
  }
});

$('#formCost').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/import-costs', { method: 'POST', body: JSON.stringify(formData(e.target)) });
    e.target.reset();
    e.target.currency.value = 'USD';
    e.target.type.value = 'LOGISTICA';
    await refresh();
    toast('Costo cargado');
  } catch (err) {
    toast(err.message);
  }
});

$('#formReception').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = formData(e.target);
    const payload = {
      shipmentId: body.shipmentId,
      purchaseId: body.purchaseId,
      receivedQty: Number(body.receivedQty),
      receivedAt: body.receivedAt,
      notes: body.notes,
    };
    if (body.incidentType && body.incidentQty) {
      payload.incidents = [{ type: body.incidentType, quantity: Number(body.incidentQty) }];
    }
    await api('/receptions', { method: 'POST', body: JSON.stringify(payload) });
    e.target.reset();
    await refresh();
    toast('Recepción registrada — stock actualizado');
  } catch (err) {
    toast(err.message);
  }
});

$('#btnReport').addEventListener('click', () => loadReport().catch((err) => toast(err.message)));

$('#btnSaveKey').addEventListener('click', () => {
  localStorage.setItem(KEY_STORAGE, apiKey());
  toast('API key guardada');
});

async function boot() {
  try {
    const cfg = await fetch('/ui/config').then((r) => r.json());
    $('#apiKey').value = localStorage.getItem(KEY_STORAGE) || cfg.apiKey || '';
  } catch {
    $('#apiKey').value = localStorage.getItem(KEY_STORAGE) || '';
  }
  try {
    await api('/health');
    $('#healthDot').classList.add('ok');
    await refresh();
    const today = new Date().toISOString().slice(0, 10);
    $$('input[type="date"]').forEach((el) => {
      if (!el.value) el.value = today;
    });
  } catch {
    $('#healthDot').classList.add('bad');
    toast('API no responde. Revisá la key o arrancá start-local.bat');
  }
}

boot();
