const { createProductsService } = require('../../src/domains/products/products-service');

function registerProductRoutes(app, deps) {
  const {
    serviceContext,
    cache,
    search,
    utils,
    catalog,
  } = deps;

  const productsService = createProductsService({
    ...serviceContext,
    cache: {
      getProductsCacheVersion: cache.getProductsCacheVersion,
      cacheSegment: cache.cacheSegment,
      PRODUCTS_CACHE_SHAPE_VERSION: cache.PRODUCTS_CACHE_SHAPE_VERSION,
      getJsonCache: cache.getJsonCache,
      setJsonCache: cache.setJsonCache,
      PRODUCTS_CACHE_DEFAULT_LIMIT: cache.PRODUCTS_CACHE_DEFAULT_LIMIT,
    },
    search: {
      PRODUCT_SEARCH_SEMANTIC_ENABLED: search.PRODUCT_SEARCH_SEMANTIC_ENABLED,
      PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH: search.PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH,
      getProductEmbeddings: search.getProductEmbeddings,
      PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY: search.PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY,
      PRODUCT_SEARCH_TRIGRAM_THRESHOLD: search.PRODUCT_SEARCH_TRIGRAM_THRESHOLD,
      NORMALIZED_PRODUCT_SEARCH_TEXT_WEIGHT: search.NORMALIZED_PRODUCT_SEARCH_TEXT_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_VECTOR_WEIGHT: search.NORMALIZED_PRODUCT_SEARCH_VECTOR_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_POPULARITY_WEIGHT: search.NORMALIZED_PRODUCT_SEARCH_POPULARITY_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_STOCK_WEIGHT: search.NORMALIZED_PRODUCT_SEARCH_STOCK_WEIGHT,
    },
    utils: {
      parseInteger: utils.parseInteger,
      clamp: utils.clamp,
      PRODUCTS_CACHE_MIN_LIMIT: utils.PRODUCTS_CACHE_MIN_LIMIT,
      PRODUCTS_CACHE_MAX_LIMIT: utils.PRODUCTS_CACHE_MAX_LIMIT,
      encodeCursor: utils.encodeCursor,
      decodeCursor: utils.decodeCursor,
    },
    catalog: {
      getProductById: catalog.getProductById,
    },
  });

  app.get('/api/products', async (req, res, next) => {
    try {
      const result = await productsService.listProducts(req.query || {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/products/:productId', async (req, res, next) => {
    try {
      const result = await productsService.getProduct(req.params.productId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  registerProductRoutes,
};
