const { registerAdminCatalogRoutes } = require('./routes/admin-catalog-routes');
const { registerCheckoutPaymentRoutes } = require('./routes/checkout-payment-routes');
const { registerCoreRoutes } = require('./routes/core-routes');
const { registerDotbotRoutes } = require('./routes/dotbot-routes');
const { registerFavoriteRoutes } = require('./routes/favorites-routes');
const { registerLocationAddressRoutes } = require('./routes/location-address-routes');
const { registerOrdersDriverRoutes } = require('./routes/orders-driver-routes');
const { registerAdminPricingRoutes } = require('./routes/admin-pricing-routes');
const { registerProductRoutes } = require('./routes/products-routes');
const { registerUserRoutes } = require('./routes/user-routes');

function registerApiRoutes(app, deps) {
  const { serviceContext, groups } = deps;

  registerCoreRoutes(app, {
    serviceContext,
    pool: groups.core.pool,
  });

  registerDotbotRoutes(app, {
    requireFirebaseAuth: groups.auth.requireFirebaseAuth,
    createDotbotRateLimitMiddleware: groups.dotbot.createDotbotRateLimitMiddleware,
    DOTBOT_RATE_LIMIT_MESSAGE_LIMIT: groups.dotbot.DOTBOT_RATE_LIMIT_MESSAGE_LIMIT,
    DOTBOT_RATE_LIMIT_TRANSCRIBE_LIMIT: groups.dotbot.DOTBOT_RATE_LIMIT_TRANSCRIBE_LIMIT,
    DOTBOT_RATE_LIMIT_TTS_LIMIT: groups.dotbot.DOTBOT_RATE_LIMIT_TTS_LIMIT,
    DOTBOT_MESSAGE_MAX_WORDS: groups.dotbot.DOTBOT_MESSAGE_MAX_WORDS,
    countWords: groups.dotbot.countWords,
    getDotbotModule: groups.dotbot.getDotbotModule,
  });

  registerLocationAddressRoutes(app, {
    serviceContext,
    requireFirebaseAuth: groups.auth.requireFirebaseAuth,
    ensureUserRow: groups.users.ensureUserRow,
    parseNullableNumber: groups.utils.parseNullableNumber,
    ACTIVE_ORDER_STATUSES: groups.orders.ACTIVE_ORDER_STATUSES,
  });

  registerProductRoutes(app, {
    serviceContext,
    cache: {
      getProductsCacheVersion: groups.cache.getProductsCacheVersion,
      cacheSegment: groups.cache.cacheSegment,
      PRODUCTS_CACHE_SHAPE_VERSION: groups.products.PRODUCTS_CACHE_SHAPE_VERSION,
      getJsonCache: groups.cache.getJsonCache,
      setJsonCache: groups.cache.setJsonCache,
      PRODUCTS_CACHE_DEFAULT_LIMIT: groups.products.PRODUCTS_CACHE_DEFAULT_LIMIT,
    },
    search: {
      PRODUCT_SEARCH_SEMANTIC_ENABLED: groups.search.PRODUCT_SEARCH_SEMANTIC_ENABLED,
      PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH:
        groups.search.PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH,
      getProductEmbeddings: groups.search.getProductEmbeddings,
      PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY: groups.search.PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY,
      PRODUCT_SEARCH_TRIGRAM_THRESHOLD: groups.search.PRODUCT_SEARCH_TRIGRAM_THRESHOLD,
      NORMALIZED_PRODUCT_SEARCH_TEXT_WEIGHT: groups.search.NORMALIZED_PRODUCT_SEARCH_TEXT_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_VECTOR_WEIGHT:
        groups.search.NORMALIZED_PRODUCT_SEARCH_VECTOR_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_POPULARITY_WEIGHT:
        groups.search.NORMALIZED_PRODUCT_SEARCH_POPULARITY_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_STOCK_WEIGHT: groups.search.NORMALIZED_PRODUCT_SEARCH_STOCK_WEIGHT,
    },
    utils: {
      parseInteger: groups.utils.parseInteger,
      clamp: groups.utils.clamp,
      PRODUCTS_CACHE_MIN_LIMIT: groups.products.PRODUCTS_CACHE_MIN_LIMIT,
      PRODUCTS_CACHE_MAX_LIMIT: groups.products.PRODUCTS_CACHE_MAX_LIMIT,
      encodeCursor: groups.utils.encodeCursor,
      decodeCursor: groups.utils.decodeCursor,
    },
    catalog: {
      getProductById: groups.products.getProductById,
    },
  });

  registerCheckoutPaymentRoutes(app, {
    serviceContext,
    auth: {
      requireFirebaseAuth: groups.auth.requireFirebaseAuth,
    },
    utils: {
      parseInteger: groups.utils.parseInteger,
      normalizePromoCode: groups.utils.normalizePromoCode,
      roundCurrencyAmount: groups.utils.roundCurrencyAmount,
    },
    checkout: {
      createPendingOrderWithStockLock: groups.checkout.createPendingOrderWithStockLock,
      ensurePricingSchema: groups.checkout.ensurePricingSchema,
      calculateItemTotalFromItems: groups.checkout.calculateItemTotalFromItems,
      calculatePricingBreakdown: groups.checkout.calculatePricingBreakdown,
      recalculatePendingOrderPricing: groups.checkout.recalculatePendingOrderPricing,
      maybeCompleteReferralRewardForFirstPaidOrder:
        groups.checkout.maybeCompleteReferralRewardForFirstPaidOrder,
    },
    cache: {
      bumpProductsCacheVersion: groups.cache.bumpProductsCacheVersion,
      bumpOrdersCacheVersion: groups.cache.bumpOrdersCacheVersion,
    },
    realtime: {
      publishOrderRealtimeUpdate: groups.realtime.publishOrderRealtimeUpdate,
      publishOrderRealtimeUpdateFromRow: groups.realtime.publishOrderRealtimeUpdateFromRow,
      publishUserRealtimeWalletSnapshot: groups.realtime.publishUserRealtimeWalletSnapshot,
    },
    payment: {
      stripeClient: groups.payment.stripeClient,
      stripePublishableKey: groups.payment.stripePublishableKey,
      PLATFORM_CURRENCY: groups.payment.PLATFORM_CURRENCY,
    },
    users: {
      resolveUserIdFromIdentity: groups.users.resolveUserIdFromIdentity,
    },
  });

  registerFavoriteRoutes(app, {
    serviceContext,
    requireFirebaseAuth: groups.auth.requireFirebaseAuth,
    parseInteger: groups.utils.parseInteger,
    normalizeFavoriteBookLabel: groups.utils.normalizeFavoriteBookLabel,
  });

  registerOrdersDriverRoutes(app, {
    serviceContext,
    auth: {
      requireFirebaseAuth: groups.auth.requireFirebaseAuth,
      requireDriverRole: groups.auth.requireDriverRole,
    },
    pricing: {
      ensurePricingSchema: groups.checkout.ensurePricingSchema,
    },
    orders: {
      PREVIOUS_ORDER_STATUSES: groups.orders.PREVIOUS_ORDER_STATUSES,
      ACTIVE_ORDER_STATUSES: groups.orders.ACTIVE_ORDER_STATUSES,
      ORDERS_CACHE_SHAPE_VERSION: groups.orders.ORDERS_CACHE_SHAPE_VERSION,
      ORDERS_CACHE_TTL_SECONDS: groups.orders.ORDERS_CACHE_TTL_SECONDS,
      ensureDriverOrderColumns: groups.orders.ensureDriverOrderColumns,
      DRIVER_EXECUTED_VISIBLE_LIMIT: groups.orders.DRIVER_EXECUTED_VISIBLE_LIMIT,
      hydrateDriverOrderCustomerNames: groups.orders.hydrateDriverOrderCustomerNames,
      DRIVER_UPDATABLE_STATUSES: groups.orders.DRIVER_UPDATABLE_STATUSES,
      archiveDeliveredOrdersForDriver: groups.orders.archiveDeliveredOrdersForDriver,
    },
    utils: {
      clamp: groups.utils.clamp,
      parseInteger: groups.utils.parseInteger,
      decodeCursor: groups.utils.decodeCursor,
      encodeCursor: groups.utils.encodeCursor,
    },
    cache: {
      getOrdersCacheVersion: groups.cache.getOrdersCacheVersion,
      cacheSegment: groups.cache.cacheSegment,
      getJsonCache: groups.cache.getJsonCache,
      setJsonCache: groups.cache.setJsonCache,
      bumpOrdersCacheVersion: groups.cache.bumpOrdersCacheVersion,
    },
    realtime: {
      publishOrderRealtimeUpdateFromRow: groups.realtime.publishOrderRealtimeUpdateFromRow,
      publishUserRealtimeWalletSnapshot: groups.realtime.publishUserRealtimeWalletSnapshot,
    },
    users: {
      resolveUserIdFromIdentity: groups.users.resolveUserIdFromIdentity,
    },
  });

  registerAdminCatalogRoutes(app, {
    serviceContext,
    checkout: {
      ensurePricingSchema: groups.checkout.ensurePricingSchema,
    },
    products: {
      getProductById: groups.products.getProductById,
      toSlug: groups.products.toSlug,
    },
    admin: {
      resolveCategory: groups.admin.resolveCategory,
      safeNum: groups.admin.safeNum,
      CATEGORIES_CACHE_TTL_SECONDS: groups.admin.CATEGORIES_CACHE_TTL_SECONDS,
    },
    search: {
      getProductEmbeddings: groups.search.getProductEmbeddings,
    },
    cache: {
      bumpProductsCacheVersion: groups.cache.bumpProductsCacheVersion,
      cacheSegment: groups.cache.cacheSegment,
      getProductsCacheVersion: groups.cache.getProductsCacheVersion,
      getJsonCache: groups.cache.getJsonCache,
      setJsonCache: groups.cache.setJsonCache,
    },
    utils: {
      parseInteger: groups.utils.parseInteger,
      clamp: groups.utils.clamp,
      encodeCursor: groups.utils.encodeCursor,
      decodeCursor: groups.utils.decodeCursor,
    },
    platform: {
      randomUUID: groups.admin.randomUUID,
    },
  });

  registerAdminPricingRoutes(app, {
    serviceContext,
    checkout: {
      ensurePricingSchema: groups.checkout.ensurePricingSchema,
    },
    admin: {
      normalizeFeeRuleRow: groups.admin.normalizeFeeRuleRow,
      coerceFeeType: groups.admin.coerceFeeType,
      normalizeDeliveryFeeSlabRow: groups.admin.normalizeDeliveryFeeSlabRow,
      assertNoActiveDeliverySlabOverlap: groups.admin.assertNoActiveDeliverySlabOverlap,
      normalizePromoRow: groups.admin.normalizePromoRow,
      coercePromoDiscountType: groups.admin.coercePromoDiscountType,
    },
    utils: {
      parseNullableNumber: groups.utils.parseNullableNumber,
      roundCurrencyAmount: groups.utils.roundCurrencyAmount,
      normalizePromoCodeForStorage: groups.utils.normalizePromoCodeForStorage,
      parseOptionalTimestamp: groups.utils.parseOptionalTimestamp,
    },
    realtime: {
      publishUserRealtimeWalletSnapshot: groups.realtime.publishUserRealtimeWalletSnapshot,
    },
    cache: {
      bumpOrdersCacheVersion: groups.cache.bumpOrdersCacheVersion,
    },
  });

  registerUserRoutes(app, {
    serviceContext,
    auth: {
      requireFirebaseAuth: groups.auth.requireFirebaseAuth,
    },
    identity: {
      resolveUserRole: groups.users.resolveUserRole,
      ensurePricingSchema: groups.checkout.ensurePricingSchema,
      ensureUserRow: groups.users.ensureUserRow,
    },
    wallet: {
      getDeliveryCreditBalance: groups.wallet.getDeliveryCreditBalance,
      getOrderCreditBalance: groups.wallet.getOrderCreditBalance,
      getAvailableOrderCreditBalance: groups.wallet.getAvailableOrderCreditBalance,
      publishUserRealtimeWalletSnapshot: groups.realtime.publishUserRealtimeWalletSnapshot,
    },
    utils: {
      normalizePhoneNumber: groups.utils.normalizePhoneNumber,
      normalizeReferralCode: groups.utils.normalizeReferralCode,
    },
  });
}

module.exports = {
  registerApiRoutes,
};
