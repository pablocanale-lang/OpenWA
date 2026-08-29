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
  const headers = { 'x-api-key': apiKey(), ...(opts.headers || {}) };
  if (opts.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function table(headers, rows) {
  if (!rows.length) return `<p class="muted" style="padding:1rem">Sin datos todavía.</p>`;
  return `<table class="data"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function opt(list, valueKey, labelFn) {
  return list.map((item) => `<option value="${item[valueKey]}">${labelFn(item)}</option>`).join('');
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

function d(iso) {
  return (iso || '').slice(0, 10) || '—';
}

const statusLabel = { BORRADOR: 'Borrador', CONFIRMADA: 'Confirmada', CERRADA: 'Cerrada', CANCELADA: 'Cancelada' };

let cache = { products: [], suppliers: [], forwarders: [], orders: [], invoices: [], summary: null };

async function refresh() {
  const [products, suppliers, forwarders, orders, invoices, summary] = await Promise.all([
    api('/products'),
    api('/suppliers'),
    api('/forwarders'),
    api('/purchase-orders'),
    api('/purchase-orders/invoices'),
    api('/purchase-orders/summary'),
  ]);
  cache = { products, suppliers, forwarders, orders, invoices, summary };
  renderAll();
}

function fillSelects() {
  $$('select[name="supplierId"]').forEach((el) => {
    el.innerHTML = opt(cache.suppliers, 'id', (s) => s.name);
  });
  $$('select[name="forwarderId"]').forEach((el) => {
    el.innerHTML = opt(cache.forwarders, 'id', (f) => f.name);
  });
  $$('.po-line-product').forEach((el) => {
    const current = el.value;
    el.innerHTML = opt(cache.products, 'id', (p) => p.name);
    if (current) el.value = current;
  });
}

function productNames(order) {
  return order.productName || (order.items || []).map((l) => l.product?.name).filter(Boolean).join(', ') || order.product?.name || '';
}

function lineRow(line = {}) {
  return `<tr class="po-line">
    <td><select class="po-line-product" required>${opt(cache.products, 'id', (p) => p.name)}</select></td>
    <td><input class="po-line-qty" type="number" min="1" required value="${line.quantity ?? 1}" /></td>
    <td><input class="po-line-price" required value="${line.unitPrice ?? ''}" /></td>
    <td><button type="button" class="btn ghost po-line-remove">Quitar</button></td>
  </tr>`;
}

function collectLines(tbody) {
  return [...tbody.querySelectorAll('tr.po-line')].map((tr) => ({
    productId: tr.querySelector('.po-line-product').value,
    quantity: Number(tr.querySelector('.po-line-qty').value),
    unitPrice: tr.querySelector('.po-line-price').value,
  }));
}

function setLines(tbody, lines) {
  tbody.innerHTML = (lines.length ? lines : [{}]).map(lineRow).join('');
  tbody.querySelectorAll('.po-line-product').forEach((el, i) => {
    if (lines[i]?.productId) el.value = lines[i].productId;
  });
}

function toggleFx(select, wrap) {
  const needed = select.value !== 'PYG';
  wrap.hidden = !needed;
  const input = wrap.querySelector('input');
  if (input) input.required = needed;
  if (!needed && input) input.value = '';
}

function invoiceBlock() {
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="invoice-block form-grid">
    <label>N.º factura <input name="invoiceNumber" /></label>
    <label>RUC <input name="ruc" /></label>
    <label>Razón social <input name="legalName" /></label>
    <label>Fecha factura <input name="issuedAt" type="date" value="${today}" /></label>
    <label>Monto <input name="amount" /></label>
    <div class="full"><button type="button" class="btn ghost invoice-remove">Quitar factura</button></div>
  </div>`;
}

function renderAll() {
  fillSelects();
  const s = cache.summary || { draft: 0, open: 0, closed: 0, quantity: 0, spent: '0' };
  $('#kpis').innerHTML = `
    <div><span>Borrador</span><strong>${s.draft}</strong></div>
    <div><span>Abiertas</span><strong>${s.open}</strong></div>
    <div><span>Cerradas</span><strong>${s.closed}</strong></div>
    <div><span>Unidades</span><strong>${s.quantity}</strong></div>
    <div><span>Total gastado</span><strong>${s.spent}</strong></div>
  `;

  $('#ordersTable').innerHTML = table(
    ['Fecha', 'Proveedor', 'Producto', 'Cant.', 'Total', 'Estado', 'Acciones'],
    cache.orders.map((o) => {
      const primary =
        o.status === 'BORRADOR'
          ? `<button class="btn primary" data-confirm="${o.id}">Confirmar</button>`
          : o.status === 'CONFIRMADA'
            ? `<button class="btn primary" data-close="${o.id}">Cerrar</button>`
            : '';
      const extras =
        o.status === 'CANCELADA'
          ? `<button type="button" data-detail="${o.id}">Ver detalle</button>`
          : `<button type="button" data-edit="${o.id}">Editar</button>
             <button type="button" data-detail="${o.id}">Ver detalle</button>
             <button type="button" class="danger" data-cancel="${o.id}">Cancelar orden</button>`;
      return `<tr>
        <td>${d(o.orderedAt)}</td>
        <td>${o.supplier?.name ?? ''}</td>
        <td>${productNames(o)}</td>
        <td>${o.quantity}</td>
        <td>${o.status === 'CANCELADA' ? '—' : (o.spentPyg ?? o.landedTotal)}</td>
        <td>${statusLabel[o.status] ?? o.status}</td>
        <td><div class="po-actions"><div class="po-menu">
          <button type="button" class="po-menu-trigger" data-menu="${o.id}" aria-label="Más acciones">⋮</button>
          <div class="po-menu-pop">${extras}</div>
        </div>${primary}</div></td>
      </tr>`;
    }),
  );

  $('#suppliersTable').innerHTML = table(
    ['Nombre', 'País', 'Contacto', 'Alibaba'],
    cache.suppliers.map(
      (s) =>
        `<tr><td>${s.name}</td><td>${s.country}</td><td>${s.contact ?? '—'}</td><td>${s.alibabaUrl ?? '—'}</td></tr>`,
    ),
  );

  $('#forwardersTable').innerHTML = table(
    ['Nombre', 'Contacto', 'País'],
    cache.forwarders.map(
      (f) => `<tr><td>${f.name}</td><td>${f.contact ?? '—'}</td><td>${f.country ?? '—'}</td></tr>`,
    ),
  );

  const receptions = cache.orders.filter((o) => o.status === 'CERRADA');
  $('#receptionsTable').innerHTML = table(
    ['Recepción', 'Producto', 'Cant.', 'Proveedor', 'Aduana', 'Despacho'],
    receptions.map(
      (r) =>
        `<tr><td>${d(r.receivedAt)}</td><td>${productNames(r)}</td><td>${r.quantity}</td><td>${r.supplier?.name ?? ''}</td><td>${r.customsCost ?? '—'}</td><td>${r.dispatchCost ?? '—'}</td></tr>`,
    ),
  );

  $('#invoicesTable').innerHTML = table(
    ['N.º', 'RUC', 'Razón social', 'Fecha', 'Monto', 'Proveedor', 'Producto'],
    cache.invoices.map(
      (inv) =>
        `<tr><td>${inv.invoiceNumber}</td><td>${inv.ruc}</td><td>${inv.legalName}</td><td>${d(inv.issuedAt)}</td><td>${inv.amount}</td><td>${inv.purchaseOrder?.supplierName ?? '—'}</td><td>${inv.purchaseOrder?.productName ?? '—'}</td></tr>`,
    ),
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

$('#formOrder').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = formData(e.target);
    body.currency = $('#orderCurrency').value;
    body.items = collectLines($('#orderLines'));
    if (body.currency === 'PYG') delete body.fxRateToPyg;
    await api('/purchase-orders', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    e.target.freight.value = '0';
    e.target.otherCharges.value = '0';
    await refresh();
    toast('Orden de compra en borrador');
  } catch (err) {
    toast(err.message);
  }
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

document.addEventListener('click', (e) => {
  const menuBtn = e.target.closest?.('[data-menu]');
  const insidePop = e.target.closest?.('.po-menu-pop');
  if (menuBtn) {
    const menu = menuBtn.closest('.po-menu');
    const willOpen = !menu.classList.contains('open');
    $$('.po-menu.open').forEach((el) => el.classList.remove('open'));
    if (willOpen) {
      menu.classList.add('open');
      const pop = menu.querySelector('.po-menu-pop');
      const rect = menuBtn.getBoundingClientRect();
      pop.style.top = `${rect.bottom + 6}px`;
      pop.style.left = `${Math.max(8, rect.right - 200)}px`;
    }
    return;
  }
  if (!insidePop) {
    $$('.po-menu.open').forEach((el) => el.classList.remove('open'));
  }

  const btn = e.target.closest?.('[data-confirm],[data-close],[data-edit],[data-cancel],[data-detail]');
  if (!btn) return;
  $$('.po-menu.open').forEach((el) => el.classList.remove('open'));
  const confirmId = btn.dataset.confirm;
  const closeId = btn.dataset.close;
  const editId = btn.dataset.edit;
  const cancelId = btn.dataset.cancel;
  const detailId = btn.dataset.detail;
  if (confirmId) {
    const form = $('#dlgConfirm form');
    form.id.value = confirmId;
    form.paymentReceipt.value = '';
    form.treasury.value = 'BANCO';
    $('#dlgConfirm').showModal();
  }
  if (closeId) {
    const form = $('#dlgClose form');
    form.id.value = closeId;
    const today = new Date().toISOString().slice(0, 10);
    form.receivedAt.value = today;
    form.localTreasury.value = 'BANCO';
    $('#closeInvoices').innerHTML = invoiceBlock();
    $('#dlgClose').showModal();
  }
  if (editId) {
    const order = cache.orders.find((o) => o.id === editId);
    if (!order) return;
    fillSelects();
    const form = $('#dlgEdit form');
    form.id.value = order.id;
    form.forwarderId.value = order.forwarderId || order.forwarder?.id || '';
    form.orderedAt.value = d(order.orderedAt);
    form.supplierId.value = order.supplierId || order.supplier?.id || '';
    form.origin.value = order.origin || '';
    form.destination.value = order.destination || '';
    $('#editCurrency').value = order.currency === 'YEN' ? 'JPY' : order.currency || 'USD';
    toggleFx($('#editCurrency'), $('#editFxWrap'));
    setLines($('#editLines'), order.items?.length ? order.items : [{ productId: order.productId, quantity: order.quantity, unitPrice: order.unitPrice }]);
    form.freight.value = order.freight ?? '0';
    form.otherCharges.value = order.otherCharges ?? '0';
    form.fxRateToPyg.value = order.fxRateToPyg || '';
    form.comments.value = order.comments || '';
    $('#dlgEdit').showModal();
  }
  if (detailId) {
    const order = cache.orders.find((o) => o.id === detailId);
    if (!order) return;
    const invoices = (order.invoices || [])
      .map((inv) => `${inv.invoiceNumber} · ${inv.legalName} · ${inv.ruc} · ${d(inv.issuedAt)} · ${inv.amount}`)
      .join('<br>') || '—';
    $('#detailBody').innerHTML = `
      <p><strong>Forwarder:</strong> ${order.forwarder?.name ?? '—'}</p>
      <p><strong>Origen:</strong> ${order.origin} → ${order.destination}</p>
      <p><strong>Precio:</strong> ${(order.items || []).map((l) => `${l.product?.name || ''} ${l.quantity} × ${l.unitPrice}`).join('<br>') || `${order.unitPrice} × ${order.quantity}`}</p>
      <p><strong>Moneda:</strong> ${order.currency || 'USD'} · Flete: ${order.freight} · Otros: ${order.otherCharges}${order.fxRateToPyg ? ` · Tipo de cambio: ${order.fxRateToPyg}` : ''}</p>
      <p><strong>Monto en Gs:</strong> ${order.spentPyg ?? order.chinaPyg ?? '—'}</p>
      ${order.paymentReceipt ? `<p><strong>Comprobante:</strong> ${order.paymentReceipt}</p>` : ''}
      ${order.status === 'CERRADA' ? `<p><strong>Recepción:</strong> ${d(order.receivedAt)} · Aduana: ${order.customsCost ?? '—'} · Despacho: ${order.dispatchCost ?? '—'}</p>` : ''}
      ${order.comments ? `<p><strong>Comentarios:</strong> ${order.comments}</p>` : ''}
      <p><strong>Facturas:</strong><br>${invoices}</p>
    `;
    $('#dlgDetail').showModal();
  }
  if (cancelId) {
    const order = cache.orders.find((o) => o.id === cancelId);
    const form = $('#dlgCancel form');
    form.id.value = cancelId;
    const paid = order?.status && order.status !== 'BORRADOR';
    $('#cancelHint').textContent = paid
      ? order.status === 'CERRADA'
        ? 'Hay que registrar la devolución del dinero. Al cancelar una cerrada también se revierte el inventario.'
        : 'Hay que registrar la devolución del dinero a caja o banco.'
      : 'La orden queda cancelada y deja de contar como compra.';
    const refund = $('#cancelRefundFields');
    refund.hidden = !paid;
    form.amountPyg.value = '';
    form.treasury.value = 'BANCO';
    form.paidAt.value = new Date().toISOString().slice(0, 10);
    form.reference.value = '';
    $('#dlgCancel').showModal();
  }
});

$('#btnCancelConfirm').addEventListener('click', () => $('#dlgConfirm').close());
$('#btnCancelClose').addEventListener('click', () => $('#dlgClose').close());
$('#btnCancelEdit').addEventListener('click', () => $('#dlgEdit').close());
$('#btnCancelCancel').addEventListener('click', () => $('#dlgCancel').close());
$('#btnCloseDetail').addEventListener('click', () => $('#dlgDetail').close());

$('#btnConfirm').addEventListener('click', async () => {
  const form = $('#dlgConfirm form');
  try {
    await api(`/purchase-orders/${form.id.value}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        paymentReceipt: form.paymentReceipt.value,
        treasury: form.treasury.value,
      }),
    });
    $('#dlgConfirm').close();
    await refresh();
    toast('Orden de compra confirmada');
  } catch (err) {
    toast(err.message);
  }
});

$('#btnClose').addEventListener('click', async () => {
  const form = $('#dlgClose form');
  const body = formData(form);
  const invoices = [...$('#closeInvoices').querySelectorAll('.invoice-block')].map((block) => ({
    invoiceNumber: block.querySelector('[name="invoiceNumber"]').value,
    ruc: block.querySelector('[name="ruc"]').value,
    legalName: block.querySelector('[name="legalName"]').value,
    issuedAt: block.querySelector('[name="issuedAt"]').value,
    amount: block.querySelector('[name="amount"]').value,
  })).filter((row) => [row.invoiceNumber, row.ruc, row.legalName, row.amount].some((v) => String(v).trim()));
  try {
    await api(`/purchase-orders/${body.id}/close`, {
      method: 'POST',
      body: JSON.stringify({
        receivedAt: body.receivedAt,
        customsCost: body.customsCost,
        dispatchCost: body.dispatchCost,
        localTreasury: body.localTreasury,
        invoices,
      }),
    });
    $('#dlgClose').close();
    await refresh();
    toast('Orden cerrada — inventario actualizado');
  } catch (err) {
    toast(err.message);
  }
});

$('#btnSaveEdit').addEventListener('click', async () => {
  const form = $('#dlgEdit form');
  const body = formData(form);
  try {
    const id = body.id;
    delete body.id;
    body.currency = $('#editCurrency').value;
    body.items = collectLines($('#editLines'));
    if (body.currency === 'PYG') delete body.fxRateToPyg;
    await api(`/purchase-orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    $('#dlgEdit').close();
    await refresh();
    toast('Orden de compra actualizada');
  } catch (err) {
    toast(err.message);
  }
});

$('#btnDoCancel').addEventListener('click', async () => {
  const form = $('#dlgCancel form');
  try {
    const order = cache.orders.find((o) => o.id === form.id.value);
    const body = {};
    if (order?.status && order.status !== 'BORRADOR') {
      const amountPyg = Number(form.amountPyg.value);
      if (!Number.isFinite(amountPyg) || amountPyg < 1) {
        toast('Para cancelar una orden pagada hay que registrar la devolución del dinero');
        return;
      }
      body.amountPyg = Math.round(amountPyg);
      body.treasury = form.treasury.value;
      body.paidAt = form.paidAt.value;
      body.reference = form.reference.value || undefined;
    }
    await api(`/purchase-orders/${form.id.value}/cancel`, { method: 'POST', body: JSON.stringify(body) });
    $('#dlgCancel').close();
    await refresh();
    toast('Orden de compra cancelada');
  } catch (err) {
    toast(err.message);
  }
});

$('#btnSaveKey').addEventListener('click', () => {
  localStorage.setItem(KEY_STORAGE, apiKey());
  toast('API key guardada');
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'btnAddOrderLine') {
    $('#orderLines').insertAdjacentHTML('beforeend', lineRow());
    fillSelects();
  }
  if (e.target.id === 'btnAddEditLine') {
    $('#editLines').insertAdjacentHTML('beforeend', lineRow());
    fillSelects();
  }
  if (e.target.classList.contains('po-line-remove')) {
    const tbody = e.target.closest('tbody');
    if (tbody.querySelectorAll('tr.po-line').length > 1) e.target.closest('tr').remove();
  }
  if (e.target.id === 'btnAddCloseInvoice') {
    $('#closeInvoices').insertAdjacentHTML('beforeend', invoiceBlock());
  }
  if (e.target.classList.contains('invoice-remove')) {
    const wrap = $('#closeInvoices');
    if (wrap.querySelectorAll('.invoice-block').length > 1) e.target.closest('.invoice-block').remove();
  }
});

$('#orderCurrency')?.addEventListener('change', () => toggleFx($('#orderCurrency'), $('#orderFxWrap')));
$('#editCurrency')?.addEventListener('change', () => toggleFx($('#editCurrency'), $('#editFxWrap')));

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
    setLines($('#orderLines'), [{}]);
    toggleFx($('#orderCurrency'), $('#orderFxWrap'));
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
