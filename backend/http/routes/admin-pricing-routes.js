const { createAdminOrdersService } = require('../../src/domains/admin/admin-orders-service');

function registerAdminPricingRoutes(app, deps) {
  const {
    serviceContext,
    checkout,
    admin,
    utils,
    realtime,
    cache,
  } = deps;

  const adminOrdersService = createAdminOrdersService({
    ...serviceContext,
    ensurePricingSchema: checkout.ensurePricingSchema,
    normalizeFeeRuleRow: admin.normalizeFeeRuleRow,
    coerceFeeType: admin.coerceFeeType,
    parseNullableNumber: utils.parseNullableNumber,
    roundCurrencyAmount: utils.roundCurrencyAmount,
    normalizeDeliveryFeeSlabRow: admin.normalizeDeliveryFeeSlabRow,
    assertNoActiveDeliverySlabOverlap: admin.assertNoActiveDeliverySlabOverlap,
    normalizePromoRow: admin.normalizePromoRow,
    normalizePromoCodeForStorage: utils.normalizePromoCodeForStorage,
    coercePromoDiscountType: admin.coercePromoDiscountType,
    parseOptionalTimestamp: utils.parseOptionalTimestamp,
    publishUserRealtimeWalletSnapshot: realtime.publishUserRealtimeWalletSnapshot,
    bumpOrdersCacheVersion: cache.bumpOrdersCacheVersion,
  });

  app.get('/api/admin/fee-rules', async (_req, res, next) => {
    try {
      const result = await adminOrdersService.listFeeRules();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/admin/fee-rules/current', async (req, res, next) => {
    try {
      const result = await adminOrdersService.upsertCurrentFeeRule(req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/delivery-fee-slabs', async (_req, res, next) => {
    try {
      const result = await adminOrdersService.listDeliveryFeeSlabs();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/delivery-fee-slabs', async (req, res, next) => {
    try {
      const result = await adminOrdersService.createDeliveryFeeSlab(req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/admin/delivery-fee-slabs/:slabId', async (req, res, next) => {
    try {
      const result = await adminOrdersService.updateDeliveryFeeSlab(req.params.slabId, req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/promos', async (_req, res, next) => {
    try {
      const result = await adminOrdersService.listPromos();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/promos', async (req, res, next) => {
    try {
      const result = await adminOrdersService.createPromo(req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/admin/promos/:promoId', async (req, res, next) => {
    try {
      const result = await adminOrdersService.updatePromo(req.params.promoId, req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/wallet-health', async (_req, res, next) => {
    try {
      const result = await adminOrdersService.getWalletHealth();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/order-credits/adjust', async (req, res, next) => {
    try {
      const result = await adminOrdersService.adjustOrderCredits(req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  registerAdminPricingRoutes,
};
