const { createDriverOrdersService } = require('../../src/domains/orders/driver-orders-service');

function registerOrdersDriverRoutes(app, deps) {
  const {
    serviceContext,
    auth,
    pricing,
    orders,
    utils,
    cache,
    realtime,
    users,
  } = deps;

  const driverOrdersService = createDriverOrdersService({
    db: serviceContext.db,
    logger: serviceContext.logger,
    ensurePricingSchema: pricing.ensurePricingSchema,
    ensureDriverOrderColumns: orders.ensureDriverOrderColumns,
    PREVIOUS_ORDER_STATUSES: orders.PREVIOUS_ORDER_STATUSES,
    ACTIVE_ORDER_STATUSES: orders.ACTIVE_ORDER_STATUSES,
    clamp: utils.clamp,
    parseInteger: utils.parseInteger,
    getOrdersCacheVersion: cache.getOrdersCacheVersion,
    ORDERS_CACHE_SHAPE_VERSION: orders.ORDERS_CACHE_SHAPE_VERSION,
    cacheSegment: cache.cacheSegment,
    getJsonCache: cache.getJsonCache,
    setJsonCache: cache.setJsonCache,
    ORDERS_CACHE_TTL_SECONDS: orders.ORDERS_CACHE_TTL_SECONDS,
    decodeCursor: utils.decodeCursor,
    DRIVER_EXECUTED_VISIBLE_LIMIT: orders.DRIVER_EXECUTED_VISIBLE_LIMIT,
    hydrateDriverOrderCustomerNames: orders.hydrateDriverOrderCustomerNames,
    encodeCursor: utils.encodeCursor,
    bumpOrdersCacheVersion: cache.bumpOrdersCacheVersion,
    publishOrderRealtimeUpdateFromRow: realtime.publishOrderRealtimeUpdateFromRow,
    publishUserRealtimeWalletSnapshot: realtime.publishUserRealtimeWalletSnapshot,
    DRIVER_UPDATABLE_STATUSES: orders.DRIVER_UPDATABLE_STATUSES,
    archiveDeliveredOrdersForDriver: orders.archiveDeliveredOrdersForDriver,
    resolveUserIdFromIdentity: users.resolveUserIdFromIdentity,
  });

  app.get('/api/orders', auth.requireFirebaseAuth, async (req, res, next) => {
    try {
      const result = await driverOrdersService.listCustomerOrders({
        firebaseUid: req.auth?.uid || '',
        type: req.query.type,
        limit: req.query.limit,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    '/api/orders/:orderId/generate-delivery-pin',
    auth.requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const result = await driverOrdersService.generateDeliveryPin({
          orderId: req.params.orderId,
          firebaseUid: req.auth?.uid || '',
        });
        return res.status(200).json(result);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get('/api/driver/me', auth.requireFirebaseAuth, auth.requireDriverRole, async (req, res) => {
    return res.status(200).json({
      ok: true,
      driver: {
        id: req.driver?.user?.id,
        firebase_uid: req.driver?.user?.firebase_uid,
        phone_number: req.driver?.user?.phone_number,
        display_name: req.driver?.user?.display_name,
        role: req.driver?.user?.role || 'driver',
      },
    });
  });

  app.get('/api/driver/orders', auth.requireFirebaseAuth, auth.requireDriverRole, async (req, res, next) => {
    try {
      const result = await driverOrdersService.listDriverOrders({
        firebaseUid: String(req.auth?.uid || '').trim(),
        type: req.query.type,
        cursor: req.query.cursor,
        limit: req.query.limit,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    '/api/driver/orders/:orderId/assign',
    auth.requireFirebaseAuth,
    auth.requireDriverRole,
    async (req, res, next) => {
      try {
        const result = await driverOrdersService.assignOrder({
          orderId: req.params.orderId,
          firebaseUid: String(req.auth?.uid || '').trim(),
          driverPhone: String(req.driver?.approvedPhone || '').trim(),
        });
        return res.status(200).json(result);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    '/api/driver/orders/:orderId/unassign',
    auth.requireFirebaseAuth,
    auth.requireDriverRole,
    async (req, res, next) => {
      try {
        const result = await driverOrdersService.unassignOrder({
          orderId: req.params.orderId,
          firebaseUid: String(req.auth?.uid || '').trim(),
        });
        return res.status(200).json(result);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.patch(
    '/api/driver/orders/:orderId/status',
    auth.requireFirebaseAuth,
    auth.requireDriverRole,
    async (req, res, next) => {
      try {
        const result = await driverOrdersService.updateOrderStatus({
          orderId: req.params.orderId,
          nextStatus: req.body?.status,
          firebaseUid: String(req.auth?.uid || '').trim(),
          body: req.body,
        });
        return res.status(200).json(result);
      } catch (error) {
        return next(error);
      }
    },
  );
}

module.exports = {
  registerOrdersDriverRoutes,
};
