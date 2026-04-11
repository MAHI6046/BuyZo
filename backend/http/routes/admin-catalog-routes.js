const { createAdminProductsService } = require('../../src/domains/admin/admin-products-service');

function registerAdminCatalogRoutes(app, deps) {
  const {
    serviceContext,
    checkout,
    products,
    admin,
    search,
    cache,
    utils,
    platform,
  } = deps;

  const adminProductsService = createAdminProductsService({
    ...serviceContext,
    ensurePricingSchema: checkout.ensurePricingSchema,
    getProductById: products.getProductById,
    toSlug: products.toSlug,
    bumpProductsCacheVersion: cache.bumpProductsCacheVersion,
    resolveCategory: admin.resolveCategory,
    safeNum: admin.safeNum,
    getProductEmbeddings: search.getProductEmbeddings,
    cacheSegment: cache.cacheSegment,
    getProductsCacheVersion: cache.getProductsCacheVersion,
    getJsonCache: cache.getJsonCache,
    setJsonCache: cache.setJsonCache,
    CATEGORIES_CACHE_TTL_SECONDS: admin.CATEGORIES_CACHE_TTL_SECONDS,
    randomUUID: platform.randomUUID,
    parseInteger: utils.parseInteger,
    clamp: utils.clamp,
    encodeCursor: utils.encodeCursor,
    decodeCursor: utils.decodeCursor,
  });

  app.get('/api/admin/products', async (req, res, next) => {
    try {
      const result = await adminProductsService.listProducts(req.query || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/orders', async (req, res, next) => {
    try {
      const result = await adminProductsService.listOrders(req.query || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/dashboard-stats', async (_req, res, next) => {
    try {
      const result = await adminProductsService.getDashboardStats();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/analytics/metrics', async (req, res, next) => {
    try {
      const result = await adminProductsService.getAnalyticsMetrics(req.query || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/analytics/top-items', async (req, res, next) => {
    try {
      const result = await adminProductsService.getAnalyticsTopItems(req.query || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/products/:productId', async (req, res, next) => {
    try {
      const result = await adminProductsService.getProduct(req.params.productId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/categories', async (_req, res, next) => {
    try {
      const result = await adminProductsService.listAdminCategories();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/categories', async (req, res, next) => {
    try {
      const result = await adminProductsService.listPublicCategories(req.query || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/categories', async (req, res, next) => {
    try {
      const result = await adminProductsService.createCategory(req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/admin/categories/:categoryId', async (req, res, next) => {
    try {
      const result = await adminProductsService.updateCategory(
        req.params.categoryId,
        req.body || {},
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/products', async (req, res, next) => {
    try {
      const result = await adminProductsService.createProduct(req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/admin/products/:productId', async (req, res, next) => {
    try {
      const result = await adminProductsService.updateProduct(req.params.productId, req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/admin/products/:productId', async (req, res, next) => {
    try {
      const result = await adminProductsService.deleteProduct(req.params.productId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/admin/categories/:categoryId', async (req, res, next) => {
    try {
      const result = await adminProductsService.deleteCategory(req.params.categoryId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/upload-url', async (req, res, next) => {
    try {
      const result = await adminProductsService.createUploadUrl(req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  registerAdminCatalogRoutes,
};
