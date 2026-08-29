import type { FastifyInstance } from 'fastify';
import {
  AccountType,
  ExpenseKind,
  ImportCostType,
  InvoiceSettlement,
  OrderStatus,
  OrderZone,
  PaymentMethod,
  ProductStatus,
  ReceptionIncidentType,
  ShipmentStatus,
  TreasuryAccount,
} from '@prisma/client';
import { z } from 'zod';
import { sendError } from './auth.js';
import * as products from '../services/products.service.js';
import * as suppliers from '../services/suppliers.service.js';
import * as forwarders from '../services/forwarders.service.js';
import * as purchases from '../services/purchases.service.js';
import * as purchaseOrders from '../services/purchase-orders.service.js';
import * as shipments from '../services/shipments.service.js';
import * as costs from '../services/costs.service.js';
import * as receptions from '../services/receptions.service.js';
import * as reports from '../services/reports.service.js';
import * as businessReport from '../services/business-report.service.js';
import * as orders from '../services/orders.service.js';
import * as followUps from '../services/follow-ups.service.js';
import * as accounts from '../services/accounts.service.js';
import * as journal from '../services/journal.service.js';
import * as expenses from '../services/expenses.service.js';
import * as accounting from '../services/accounting.service.js';
import { parsePygInput } from '../domain/pyg-input.js';
import type { OrderAction } from '../domain/order-transitions.js';

const pygAmount = z.preprocess((value) => parsePygInput(value), z.number().int().nonnegative());

const idParam = z.object({ id: z.string().min(1) });
const skuParam = z.object({ sku: z.string().min(1) });

export async function apiRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, service: 'kampro-crm' }));

  app.get('/follow-ups', async (req, reply) => {
    try {
      const query = z.object({ sessionId: z.string().min(1) }).parse(req.query);
      return await followUps.listFollowUps(query.sessionId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put('/follow-ups', async (req, reply) => {
    try {
      const body = z
        .object({
          sessionId: z.string().min(1),
          chatId: z.string().min(1),
          following: z.boolean(),
        })
        .parse(req.body);
      return await followUps.setFollowUp(body.sessionId, body.chatId, body.following);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/products', async (_req, reply) => {
    try {
      return await products.listProducts();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/products', async (req, reply) => {
    try {
      const body = z
        .object({
          sku: z.string().min(1),
          name: z.string().min(1),
          capacityMl: z.number().int().positive(),
          unitPricePyg: z.number().int().positive(),
          stockQty: z.number().int().nonnegative().optional(),
        })
        .parse(req.body);
      return await products.createProduct(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/products/sku/:sku', async (req, reply) => {
    try {
      const { sku } = skuParam.parse(req.params);
      return await products.getProductBySku(sku);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/products/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await products.getProduct(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/products/:id/movements', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await products.listStockMovements(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/products/:id/stock-adjust', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          delta: z.number().int(),
          notes: z.string().optional(),
        })
        .parse(req.body);
      return await products.adjustStock(id, body.delta, body.notes);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/products/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          capacityMl: z.number().int().positive().optional(),
          unitPricePyg: z.number().int().nonnegative().nullable().optional(),
          status: z.nativeEnum(ProductStatus).optional(),
        })
        .parse(req.body);
      return await products.updateProduct(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/suppliers', async (_req, reply) => {
    try {
      return await suppliers.listSuppliers();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/suppliers', async (req, reply) => {
    try {
      const body = z
        .object({
          name: z.string().min(1),
          contact: z.string().optional(),
          country: z.string().optional(),
          alibabaUrl: z.string().url().optional().or(z.literal('')),
          notes: z.string().optional(),
          productIds: z.array(z.string()).optional(),
        })
        .parse(req.body);
      const alibabaUrl = body.alibabaUrl === '' ? undefined : body.alibabaUrl;
      return await suppliers.createSupplier({ ...body, alibabaUrl });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/suppliers/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await suppliers.getSupplier(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/suppliers/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          contact: z.string().nullable().optional(),
          country: z.string().optional(),
          alibabaUrl: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(req.body);
      return await suppliers.updateSupplier(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/suppliers/:id/products', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const { productId } = z.object({ productId: z.string().min(1) }).parse(req.body);
      return await suppliers.linkSupplierProduct(id, productId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete('/suppliers/:id/products/:productId', async (req, reply) => {
    try {
      const params = z.object({ id: z.string(), productId: z.string() }).parse(req.params);
      await suppliers.unlinkSupplierProduct(params.id, params.productId);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/forwarders', async (_req, reply) => {
    try {
      return await forwarders.listForwarders();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/forwarders', async (req, reply) => {
    try {
      const body = z
        .object({
          name: z.string().min(1),
          contact: z.string().optional(),
          country: z.string().optional(),
          notes: z.string().optional(),
        })
        .parse(req.body);
      return await forwarders.createForwarder(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/forwarders/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await forwarders.getForwarder(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/forwarders/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          contact: z.string().nullable().optional(),
          country: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(req.body);
      return await forwarders.updateForwarder(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/purchases', async (_req, reply) => {
    try {
      return await purchases.listPurchases();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/purchases', async (req, reply) => {
    try {
      const body = z
        .object({
          purchasedAt: z.coerce.date(),
          productId: z.string().min(1),
          supplierId: z.string().min(1),
          shipmentId: z.string().optional(),
          quantity: z.number().int().positive(),
          unitPrice: z.string().or(z.number().transform(String)),
          currency: z.string().min(3).max(8).optional(),
          fxRateToPyg: z.string().or(z.number().transform(String)).optional(),
          notes: z.string().optional(),
        })
        .parse(req.body);
      return await purchases.createPurchase(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/purchases/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await purchases.getPurchase(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/purchases/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          purchasedAt: z.coerce.date().optional(),
          shipmentId: z.string().nullable().optional(),
          quantity: z.number().int().positive().optional(),
          unitPrice: z.string().or(z.number().transform(String)).optional(),
          currency: z.string().min(3).max(8).optional(),
          fxRateToPyg: z.string().or(z.number().transform(String)).nullable().optional(),
          notes: z.string().nullable().optional(),
        })
        .parse(req.body);
      return await purchases.updatePurchase(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  const moneyField = z.string().or(z.number().transform(String));

  const poLine = z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: moneyField,
  });

  app.get('/purchase-orders', async (_req, reply) => {
    try {
      return await purchaseOrders.listPurchaseOrders();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/purchase-orders/summary', async (_req, reply) => {
    try {
      return await purchaseOrders.purchaseOrderSummary();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/purchase-orders/invoices', async (_req, reply) => {
    try {
      return await purchaseOrders.listPurchaseOrderInvoices();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/purchase-orders/receptions', async (_req, reply) => {
    try {
      return await purchaseOrders.listClosedReceptions();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/purchase-orders', async (req, reply) => {
    try {
      const body = z
        .object({
          orderedAt: z.coerce.date(),
          forwarderId: z.string().min(1),
          supplierId: z.string().min(1),
          origin: z.string().min(1),
          destination: z.string().min(1),
          productId: z.string().min(1).optional(),
          quantity: z.number().int().positive().optional(),
          unitPrice: moneyField.optional(),
          items: z.array(poLine).min(1).optional(),
          freight: moneyField.optional(),
          otherCharges: moneyField.optional(),
          fxRateToPyg: moneyField.optional(),
          currency: z.string().optional(),
          comments: z.string().optional(),
        })
        .refine((row) => (row.items && row.items.length > 0) || (row.productId && row.quantity && row.unitPrice), {
          message: 'La orden de compra necesita al menos un producto',
        })
        .parse(req.body);
      return await purchaseOrders.createPurchaseOrder(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/purchase-orders/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await purchaseOrders.getPurchaseOrder(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/purchase-orders/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          orderedAt: z.coerce.date().optional(),
          forwarderId: z.string().min(1).optional(),
          supplierId: z.string().min(1).optional(),
          origin: z.string().min(1).optional(),
          destination: z.string().min(1).optional(),
          productId: z.string().min(1).optional(),
          quantity: z.number().int().positive().optional(),
          unitPrice: moneyField.optional(),
          items: z.array(poLine).min(1).optional(),
          freight: moneyField.optional(),
          otherCharges: moneyField.optional(),
          fxRateToPyg: moneyField.nullable().optional(),
          currency: z.string().optional(),
          comments: z.string().nullable().optional(),
        })
        .parse(req.body);
      return await purchaseOrders.updatePurchaseOrder(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/purchase-orders/:id/confirm', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          paymentReceipt: z.string().min(1),
          treasury: z.nativeEnum(TreasuryAccount).optional(),
          fxRateToPyg: z.union([z.string(), z.number()]).transform(String).optional(),
        })
        .parse(req.body);
      return await purchaseOrders.confirmPurchaseOrder(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/purchase-orders/:id/close', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          receivedAt: z.coerce.date(),
          customsCost: moneyField,
          dispatchCost: moneyField,
          invoices: z
            .array(
              z.object({
                invoiceNumber: z.string().optional().default(''),
                ruc: z.string().optional().default(''),
                legalName: z.string().optional().default(''),
                issuedAt: z.coerce.date(),
                amount: z.union([z.string(), z.number()]).transform(String).optional().default(''),
              }),
            )
            .min(1),
          localTreasury: z.nativeEnum(TreasuryAccount).optional(),
        })
        .parse(req.body);
      return await purchaseOrders.closePurchaseOrder(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/purchase-orders/:id/cancel', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          amountPyg: z.number().int().positive().optional(),
          treasury: z.nativeEnum(TreasuryAccount).optional(),
          paidAt: z.coerce.date().optional(),
          reference: z.string().optional(),
        })
        .parse(req.body ?? {});
      const refund =
        body.amountPyg && body.treasury && body.paidAt
          ? {
              amountPyg: body.amountPyg,
              treasury: body.treasury,
              paidAt: body.paidAt,
              reference: body.reference,
            }
          : undefined;
      return await purchaseOrders.cancelPurchaseOrder(id, refund);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/shipments', async (_req, reply) => {
    try {
      return await shipments.listShipments();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/shipments', async (req, reply) => {
    try {
      const body = z
        .object({
          forwarderId: z.string().min(1),
          reference: z.string().min(1),
          departedAt: z.coerce.date().optional(),
          etaAt: z.coerce.date().optional(),
          arrivedAt: z.coerce.date().optional(),
          notes: z.string().optional(),
          purchaseIds: z.array(z.string()).optional(),
        })
        .parse(req.body);
      return await shipments.createShipment(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/shipments/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await shipments.getShipment(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/shipments/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          reference: z.string().min(1).optional(),
          departedAt: z.coerce.date().nullable().optional(),
          etaAt: z.coerce.date().nullable().optional(),
          arrivedAt: z.coerce.date().nullable().optional(),
          notes: z.string().nullable().optional(),
          status: z.nativeEnum(ShipmentStatus).optional(),
        })
        .parse(req.body);
      return await shipments.updateShipment(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/shipments/:id/purchases', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const { purchaseId } = z.object({ purchaseId: z.string().min(1) }).parse(req.body);
      return await shipments.attachPurchase(id, purchaseId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/import-costs', async (req, reply) => {
    try {
      const q = z.object({ shipmentId: z.string().optional() }).parse(req.query);
      return await costs.listImportCosts(q.shipmentId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/import-costs', async (req, reply) => {
    try {
      const body = z
        .object({
          shipmentId: z.string().min(1),
          purchaseId: z.string().optional(),
          type: z.nativeEnum(ImportCostType),
          description: z.string().optional(),
          amount: z.string().or(z.number().transform(String)),
          currency: z.string().min(3).max(8).optional(),
          fxRateToPyg: z.string().or(z.number().transform(String)).optional(),
          incurredAt: z.coerce.date().optional(),
        })
        .parse(req.body);
      return await costs.createImportCost(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/import-costs/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          type: z.nativeEnum(ImportCostType).optional(),
          description: z.string().nullable().optional(),
          amount: z.string().or(z.number().transform(String)).optional(),
          currency: z.string().min(3).max(8).optional(),
          fxRateToPyg: z.string().or(z.number().transform(String)).nullable().optional(),
          incurredAt: z.coerce.date().nullable().optional(),
          purchaseId: z.string().nullable().optional(),
        })
        .parse(req.body);
      return await costs.updateImportCost(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete('/import-costs/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      await costs.deleteImportCost(id);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/receptions', async (_req, reply) => {
    try {
      return await receptions.listReceptions();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/receptions', async (req, reply) => {
    try {
      const body = z
        .object({
          shipmentId: z.string().min(1),
          purchaseId: z.string().min(1),
          receivedQty: z.number().int().nonnegative(),
          receivedAt: z.coerce.date(),
          notes: z.string().optional(),
          incidents: z
            .array(
              z.object({
                type: z.nativeEnum(ReceptionIncidentType),
                quantity: z.number().int().positive(),
                notes: z.string().optional(),
              }),
            )
            .optional(),
        })
        .parse(req.body);
      return await receptions.createReception(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/receptions/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await receptions.getReception(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/reports/sku/:sku/landed-cost', async (req, reply) => {
    try {
      const { sku } = skuParam.parse(req.params);
      return await reports.skuCostReport(sku);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/reports/business', async (req, reply) => {
    try {
      const query = z.object({ period: z.string().optional() }).parse(req.query);
      return await businessReport.businessReport(businessReport.parsePeriod(query.period));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put('/reports/targets', async (req, reply) => {
    try {
      const pyg = z.number().int().positive().nullable().optional();
      const body = z
        .object({
          dayPyg: pyg,
          weekPyg: pyg,
          monthPyg: pyg,
          yearPyg: pyg,
        })
        .parse(req.body ?? {});
      return await businessReport.saveSalesTargets(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  const paymentBody = z.object({
    amount: z.number().int().positive(),
    method: z.nativeEnum(PaymentMethod),
    paidAt: z.coerce.date(),
    reference: z.string().optional(),
  });

  const orderLineBody = z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive(),
    discountApplied: z.number().min(0).max(100).optional(),
    unitPricePyg: z.number().int().nonnegative().optional(),
  });

  app.get('/orders', async (req, reply) => {
    try {
      const query = z
        .object({
          phone: z.string().optional(),
          chatId: z.string().optional(),
        })
        .parse(req.query);
      return await orders.listOrders(query);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/orders/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await orders.getOrder(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/orders', async (req, reply) => {
    try {
      const body = z
        .object({
          items: z.array(orderLineBody).min(1).optional(),
          sku: z.string().min(1).optional(),
          quantity: z.number().int().positive().optional(),
          discountApplied: z.number().min(0).max(100).optional(),
          totalAmount: z.number().int().positive().optional(),
          zone: z.nativeEnum(OrderZone),
          customerPhone: z.string().min(1),
          contactName: z.string().optional(),
          recipientName: z.string().min(1),
          invoiceName: z.string().min(1),
          ruc: z.string().min(1),
          invoiceSettlement: z.nativeEnum(InvoiceSettlement).optional(),
          sessionId: z.string().optional(),
          chatId: z.string().optional(),
          locationLat: z.number().optional(),
          locationLng: z.number().optional(),
          locationText: z.string().optional(),
          preferredTime: z.string().optional(),
          paymentMethodPreferred: z.nativeEnum(PaymentMethod).optional(),
          city: z.string().optional(),
          carrier: z.string().optional(),
        })
        .refine((value) => (value.items && value.items.length > 0) || Boolean(value.sku), {
          message: 'El pedido debe tener al menos un producto',
        })
        .parse(req.body);
      return await orders.createOrder(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/orders/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          items: z.array(orderLineBody).min(1).optional(),
          sku: z.string().min(1).optional(),
          quantity: z.number().int().positive().optional(),
          discountApplied: z.number().min(0).max(100).optional(),
          totalAmount: z.number().int().positive().optional(),
          contactName: z.string().nullable().optional(),
          recipientName: z.string().min(1).optional(),
          invoiceName: z.string().min(1).optional(),
          ruc: z.string().min(1).optional(),
          invoiceSettlement: z.nativeEnum(InvoiceSettlement).optional(),
          locationLat: z.number().nullable().optional(),
          locationLng: z.number().nullable().optional(),
          locationText: z.string().nullable().optional(),
          preferredTime: z.string().nullable().optional(),
          paymentMethodPreferred: z.nativeEnum(PaymentMethod).nullable().optional(),
          city: z.string().nullable().optional(),
          carrier: z.string().nullable().optional(),
          shippingCostPyg: z.number().int().nonnegative().nullable().optional(),
        })
        .parse(req.body);
      return await orders.updateOrder(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/orders/:id/shipping', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({ shippingCostPyg: z.number().int().nonnegative().nullable() })
        .parse(req.body);
      return await orders.updateShippingCost(id, body.shippingCostPyg);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/orders/:id/transition', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          action: z.enum([
            'confirmPayment',
            'markReady',
            'markShipped',
            'markDelivered',
            'close',
            'cancel',
            'returnOrder',
          ]),
          payment: paymentBody.optional(),
          shippingCostPyg: pygAmount.optional(),
        })
        .parse(req.body);
      return await orders.transitionOrder(id, body.action as OrderAction, body.payment, body.shippingCostPyg);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/orders/:id/status', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z.object({ status: z.nativeEnum(OrderStatus) }).parse(req.body);
      return await orders.setOrderStatus(id, body.status);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/accounting/accounts', async (_req, reply) => {
    try {
      return await accounts.listAccounts();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/accounting/accounts', async (req, reply) => {
    try {
      const body = z
        .object({
          name: z.string().min(1),
          type: z.nativeEnum(AccountType),
          parentId: z.string().min(1).nullable().optional(),
          postable: z.boolean().optional(),
        })
        .parse(req.body);
      return await accounts.createAccount(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/accounting/entries', async (req, reply) => {
    try {
      const query = z
        .object({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          sourceId: z.string().optional(),
          accountId: z.string().optional(),
        })
        .parse(req.query);
      return await journal.listEntries(query);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/accounting/entries/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await journal.getEntry(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete('/accounting/entries/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      return await accounting.deleteJournalEntry(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/accounting/ledger/:accountId', async (req, reply) => {
    try {
      const { accountId } = z.object({ accountId: z.string().min(1) }).parse(req.params);
      const query = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
      return await journal.ledger(accountId, query.from, query.to);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/accounting/statements', async (req, reply) => {
    try {
      const query = z
        .object({
          from: z.coerce.date(),
          to: z.coerce.date(),
        })
        .parse(req.query);
      return await journal.financialStatements(query.from, query.to);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/accounting/manual', async (req, reply) => {
    try {
      const body = z
        .object({
          datedAt: z.coerce.date(),
          memo: z.string().min(1),
          lines: z
            .array(
              z.object({
                accountId: z.string().min(1),
                debit: pygAmount,
                credit: pygAmount,
                memo: z.string().optional(),
              }),
            )
            .min(2),
        })
        .parse(req.body);
      return await journal.postManual(body.datedAt, body.memo, body.lines);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/accounting/expenses', async (_req, reply) => {
    try {
      return await expenses.listExpenses();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/accounting/expenses', async (req, reply) => {
    try {
      const body = z
        .object({
          kind: z.nativeEnum(ExpenseKind),
          datedAt: z.coerce.date(),
          description: z.string().min(1),
          amountGrossPyg: z.preprocess((value) => parsePygInput(value), z.number().int().positive()),
          ivaIncluded: z.boolean().optional(),
          treasury: z.nativeEnum(TreasuryAccount),
          accountId: z.string().min(1).optional(),
          vendor: z.string().nullable().optional(),
          reference: z.string().nullable().optional(),
        })
        .parse(req.body);
      return await expenses.createExpense(body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete('/accounting/expenses/:id', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      await expenses.deleteExpense(id);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
