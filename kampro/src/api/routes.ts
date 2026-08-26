import type { FastifyInstance } from 'fastify';
import {
  ImportCostType,
  OrderZone,
  PaymentMethod,
  ProductStatus,
  ReceptionIncidentType,
  ShipmentStatus,
} from '@prisma/client';
import { z } from 'zod';
import { sendError } from './auth.js';
import * as products from '../services/products.service.js';
import * as suppliers from '../services/suppliers.service.js';
import * as forwarders from '../services/forwarders.service.js';
import * as purchases from '../services/purchases.service.js';
import * as shipments from '../services/shipments.service.js';
import * as costs from '../services/costs.service.js';
import * as receptions from '../services/receptions.service.js';
import * as reports from '../services/reports.service.js';
import * as orders from '../services/orders.service.js';
import type { OrderAction } from '../domain/order-transitions.js';

const idParam = z.object({ id: z.string().min(1) });
const skuParam = z.object({ sku: z.string().min(1) });

export async function apiRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, service: 'kampro-crm' }));

  app.get('/products', async (_req, reply) => {
    try {
      return await products.listProducts();
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
          locationLat: z.number().nullable().optional(),
          locationLng: z.number().nullable().optional(),
          locationText: z.string().nullable().optional(),
          preferredTime: z.string().nullable().optional(),
          paymentMethodPreferred: z.nativeEnum(PaymentMethod).nullable().optional(),
          city: z.string().nullable().optional(),
          carrier: z.string().nullable().optional(),
        })
        .parse(req.body);
      return await orders.updateOrder(id, body);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/orders/:id/transition', async (req, reply) => {
    try {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          action: z.enum(['confirmPayment', 'markReady', 'markShipped', 'markDelivered', 'close', 'cancel']),
          payment: paymentBody.optional(),
        })
        .parse(req.body);
      return await orders.transitionOrder(id, body.action as OrderAction, body.payment);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
