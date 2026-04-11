const { createCheckoutPaymentService } = require('../../src/domains/payments/checkout-service');

function registerCheckoutPaymentRoutes(app, deps) {
  const {
    serviceContext,
    auth,
    utils,
    checkout,
    cache,
    realtime,
    payment,
    users,
  } = deps;

  const checkoutPaymentService = createCheckoutPaymentService({
    db: serviceContext.db,
    clock: serviceContext.clock,
    logger: serviceContext.logger,
    parseInteger: utils.parseInteger,
    normalizePromoCode: utils.normalizePromoCode,
    createPendingOrderWithStockLock: checkout.createPendingOrderWithStockLock,
    bumpProductsCacheVersion: cache.bumpProductsCacheVersion,
    bumpOrdersCacheVersion: cache.bumpOrdersCacheVersion,
    publishOrderRealtimeUpdate: realtime.publishOrderRealtimeUpdate,
    ensurePricingSchema: checkout.ensurePricingSchema,
    calculateItemTotalFromItems: checkout.calculateItemTotalFromItems,
    calculatePricingBreakdown: checkout.calculatePricingBreakdown,
    roundCurrencyAmount: utils.roundCurrencyAmount,
    stripeClient: payment.stripeClient,
    recalculatePendingOrderPricing: checkout.recalculatePendingOrderPricing,
    publishOrderRealtimeUpdateFromRow: realtime.publishOrderRealtimeUpdateFromRow,
    publishUserRealtimeWalletSnapshot: realtime.publishUserRealtimeWalletSnapshot,
    stripePublishableKey: payment.stripePublishableKey,
    resolveUserIdFromIdentity: users.resolveUserIdFromIdentity,
    maybeCompleteReferralRewardForFirstPaidOrder:
      checkout.maybeCompleteReferralRewardForFirstPaidOrder,
    platformCurrency: payment.PLATFORM_CURRENCY,
  });

  app.post('/api/checkout', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await checkoutPaymentService.checkout({
        firebaseUid: req.auth?.uid || null,
        body: req.body,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/promos/apply', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await checkoutPaymentService.applyPromo({
        firebaseUid: req.auth?.uid || null,
        body: req.body,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/pricing/preview', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await checkoutPaymentService.previewPricing({
        firebaseUid: req.auth?.uid || null,
        body: req.body,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  const createPaymentIntentHandler = async (req, res, next) => {
    try {
      const result = await checkoutPaymentService.createPaymentIntent({
        firebaseUid: req.auth?.uid || null,
        body: req.body,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  app.post('/api/create-payment-intent', auth.requireFirebaseAuth, createPaymentIntentHandler);
  app.post('/api/payments/create-intent', auth.requireFirebaseAuth, createPaymentIntentHandler);
}

module.exports = {
  registerCheckoutPaymentRoutes,
};
