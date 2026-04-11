const { ValidationError, NotFoundError } = require('../../errors');

function createProductsService({
  db,
  cache,
  search,
  utils,
  catalog,
}) {
  const {
    getProductsCacheVersion,
    cacheSegment,
    PRODUCTS_CACHE_SHAPE_VERSION,
    getJsonCache,
    setJsonCache,
    PRODUCTS_CACHE_DEFAULT_LIMIT,
  } = cache;

  const {
    PRODUCT_SEARCH_SEMANTIC_ENABLED,
    PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH,
    getProductEmbeddings,
    PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY,
    PRODUCT_SEARCH_TRIGRAM_THRESHOLD,
    NORMALIZED_PRODUCT_SEARCH_TEXT_WEIGHT,
    NORMALIZED_PRODUCT_SEARCH_VECTOR_WEIGHT,
    NORMALIZED_PRODUCT_SEARCH_POPULARITY_WEIGHT,
    NORMALIZED_PRODUCT_SEARCH_STOCK_WEIGHT,
  } = search;

  const {
    parseInteger,
    clamp,
    PRODUCTS_CACHE_MIN_LIMIT,
    PRODUCTS_CACHE_MAX_LIMIT,
    encodeCursor,
    decodeCursor,
  } = utils;

  const { getProductById } = catalog;

  async function listProducts(filters = {}) {
    const { q, category, store, cursor, limit: rawLimit, offset: rawOffset } = filters;
    const normalizedQuery = String(q || '').trim().toLowerCase();
    const trimmedQuery = normalizedQuery.length >= 2 ? normalizedQuery : '';
    const isSearchQuery = trimmedQuery.length >= 2;
    const trimmedCategory = String(category || '').trim();
    const trimmedStore = String(store || '').trim();
    const decodedCursor = isSearchQuery ? null : decodeCursor(cursor);
    if (!isSearchQuery && cursor && !decodedCursor) {
      throw new ValidationError('Invalid cursor');
    }

    const requestedLimit = parseInteger(rawLimit, PRODUCTS_CACHE_DEFAULT_LIMIT);
    const limit = clamp(requestedLimit, PRODUCTS_CACHE_MIN_LIMIT, PRODUCTS_CACHE_MAX_LIMIT);
    const requestedOffset = parseInteger(rawOffset, 0);
    const offset = Math.max(0, requestedOffset);
    const mode = decodedCursor ? 'cursor' : 'offset';
    const currentPageDepth = decodedCursor?.depth || 0;
    const shouldCacheResponse = mode === 'offset' ? offset < limit * 2 : currentPageDepth <= 1;
    const version = await getProductsCacheVersion({ category: trimmedCategory || 'all' });
    const cacheKey = [
      `products:${cacheSegment(trimmedStore)}:${cacheSegment(trimmedCategory)}:${mode}`,
      decodedCursor ? `cursor:${cacheSegment(cursor)}` : `offset:${offset}`,
      `limit:${limit}`,
      `q:${cacheSegment(trimmedQuery, 'none')}`,
      `shape:${PRODUCTS_CACHE_SHAPE_VERSION}`,
      `hybrid:${isSearchQuery ? '1' : '0'}`,
      `v:${version}`,
    ].join(':');

    if (shouldCacheResponse) {
      const cached = await getJsonCache(cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    const shouldComputeSemantic =
      isSearchQuery &&
      PRODUCT_SEARCH_SEMANTIC_ENABLED &&
      trimmedQuery.length >= PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH;
    const semanticQueryVector = shouldComputeSemantic
      ? await getProductEmbeddings().buildSearchQueryEmbeddingVectorLiteral(trimmedQuery)
      : null;
    const hasSemanticVector =
      typeof semanticQueryVector === 'string' && semanticQueryVector.length > 0;

    const params = [];
    let where = 'WHERE p.is_active = TRUE';
    let tsQueryParamIndex = null;
    let semanticVectorParamIndex = null;
    let trigramExpr = '0';

    if (trimmedStore) {
      params.push(trimmedStore);
      where += ` AND p.store_id = $${params.length}`;
    }

    if (isSearchQuery) {
      params.push(trimmedQuery);
      tsQueryParamIndex = params.length;
      trigramExpr = `GREATEST(
        similarity(LOWER(p.name), $${tsQueryParamIndex}),
        similarity(LOWER(COALESCE(p.brand, '')), $${tsQueryParamIndex}),
        similarity(LOWER(COALESCE(p.slug, '')), $${tsQueryParamIndex})
      )`;
      if (hasSemanticVector) {
        params.push(semanticQueryVector);
        semanticVectorParamIndex = params.length;
      }
    }

    if (trimmedCategory) {
      params.push(trimmedCategory);
      where += ` AND LOWER(BTRIM(COALESCE(c.name, p.category, ''))) = LOWER(BTRIM($${params.length}))`;
    }

    if (decodedCursor) {
      params.push(decodedCursor.createdAt, decodedCursor.id);
      where += ` AND (p.created_at, p.id) < ($${params.length - 1}, $${params.length})`;
    }

    params.push(limit + 1);
    const limitPlaceholder = `$${params.length}`;
    let paginationSql = '';
    if (!decodedCursor) {
      params.push(offset);
      paginationSql = `OFFSET $${params.length}`;
    }

    const tsRankExpr = tsQueryParamIndex
      ? `ts_rank_cd(p.search_vector, websearch_to_tsquery('simple', $${tsQueryParamIndex}))`
      : '0';
    const normalizedTsRankExpr = tsQueryParamIndex ? `LEAST(1, (${tsRankExpr}) * 2.0)` : '0';
    const textRankExpr = tsQueryParamIndex ? `GREATEST(${normalizedTsRankExpr}, ${trigramExpr})` : '0';
    const semanticSimilarityExpr = semanticVectorParamIndex
      ? `COALESCE(1 - (pe.embedding <=> $${semanticVectorParamIndex}::vector), 0)`
      : '0';
    const popularityExpr = `LEAST(
      1,
      LN(1 + COALESCE(pp.total_qty, 0)) / LN(1 + 100)
    )`;
    const inStockBoostExpr = `CASE WHEN p.stock_qty > 0 THEN 1 ELSE 0 END`;

    if (isSearchQuery) {
      const semanticCandidateClause = semanticVectorParamIndex
        ? ` OR ${semanticSimilarityExpr} >= ${PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY}`
        : '';
      where += ` AND (
        p.search_vector @@ websearch_to_tsquery('simple', $${tsQueryParamIndex})
        OR ${trigramExpr} >= ${PRODUCT_SEARCH_TRIGRAM_THRESHOLD}
        OR LOWER(p.name) % $${tsQueryParamIndex}
        OR LOWER(COALESCE(p.brand, '')) % $${tsQueryParamIndex}
        OR LOWER(COALESCE(p.slug, '')) % $${tsQueryParamIndex}${semanticCandidateClause}
      )`;
    }

    const combinedRankExpr = tsQueryParamIndex
      ? `((${textRankExpr}) * ${NORMALIZED_PRODUCT_SEARCH_TEXT_WEIGHT}) + ((${semanticSimilarityExpr}) * ${NORMALIZED_PRODUCT_SEARCH_VECTOR_WEIGHT}) + ((${popularityExpr}) * ${NORMALIZED_PRODUCT_SEARCH_POPULARITY_WEIGHT}) + ((${inStockBoostExpr}) * ${NORMALIZED_PRODUCT_SEARCH_STOCK_WEIGHT})`
      : '0';
    const semanticOrderClause = semanticVectorParamIndex
      ? `${semanticSimilarityExpr} DESC, `
      : '';
    const orderSql = tsQueryParamIndex
      ? `ORDER BY ${combinedRankExpr} DESC, ${textRankExpr} DESC, ${semanticOrderClause}${popularityExpr} DESC, p.created_at DESC, p.id DESC`
      : 'ORDER BY p.created_at DESC, p.id DESC';
    const semanticJoinSql = semanticVectorParamIndex
      ? 'LEFT JOIN product_embeddings pe ON pe.product_id = p.id'
      : '';

    const result = await db.query(
      `
      SELECT
        p.id,
        p.created_at,
        p.slug,
        p.name,
        p.short_description,
        p.description,
        COALESCE(c.name, p.category) AS category,
        p.brand,
        p.is_veg,
        p.price_mrp,
        p.price_sale,
        p.stock_qty,
        p.primary_image_url,
        ROUND(
          CASE WHEN p.price_mrp > 0 THEN ((p.price_mrp - p.price_sale) / p.price_mrp) * 100 ELSE 0 END,
          2
        ) AS discount_percent,
        COALESCE(
          (SELECT json_agg(json_build_object('id', pi.id, 'image_url', pi.image_url, 'sort_order', pi.sort_order)
                            ORDER BY pi.sort_order, pi.id)
            FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) AS images,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', pv.id,
            'label', pv.label,
            'grams', pv.grams,
            'size_code', pv.size_code,
            'mrp', pv.mrp,
            'sale_price', pv.sale_price,
            'stock_qty', pv.stock_qty,
            'is_default', pv.is_default
          ) ORDER BY pv.is_default DESC, pv.id)
            FROM product_variants pv WHERE pv.product_id = p.id),
          '[]'::json
        ) AS variants${
          tsQueryParamIndex
            ? `,
        ${textRankExpr} AS text_rank,
        ${tsRankExpr} AS search_rank,
        ${trigramExpr} AS trigram_rank,
        ${semanticSimilarityExpr} AS semantic_rank,
        ${popularityExpr} AS popularity_rank,
        ${inStockBoostExpr} AS in_stock_boost,
        ${combinedRankExpr} AS combined_rank`
            : ''
        }
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${semanticJoinSql}
      LEFT JOIN product_popularity pp ON pp.product_id = p.id
      ${where}
      ${orderSql}
      LIMIT ${limitPlaceholder}
      ${paginationSql}
      `,
      params,
    );

    const hasMore = result.rows.length > limit;
    const products = hasMore ? result.rows.slice(0, limit) : result.rows;
    const tail = products[products.length - 1];
    const nextCursor =
      mode === 'cursor' && hasMore && tail
        ? encodeCursor(tail.created_at, tail.id, currentPageDepth + 1)
        : null;

    const payload = {
      ok: true,
      products,
      pageInfo: {
        mode,
        limit,
        hasMore,
        nextCursor,
        offset: mode === 'offset' ? offset : null,
        nextOffset: mode === 'offset' && hasMore ? offset + limit : null,
      },
      cached: false,
    };

    if (shouldCacheResponse) {
      await setJsonCache(cacheKey, payload);
    }

    return payload;
  }

  async function getProduct(rawProductId) {
    const productId = Number(rawProductId);
    if (!Number.isFinite(productId)) {
      throw new ValidationError('Invalid product id');
    }

    const product = await getProductById(productId);
    if (!product) {
      throw new NotFoundError('Product not found');
    }

    const similar = await db.query(
      `
      SELECT p2.id, p2.name, p2.short_description, p2.primary_image_url, p2.price_mrp, p2.price_sale,
             ROUND(CASE WHEN price_mrp > 0 THEN ((price_mrp - price_sale) / price_mrp) * 100 ELSE 0 END, 2) AS discount_percent,
             p2.is_veg
      FROM products p2
      LEFT JOIN categories c2 ON c2.id = p2.category_id
      WHERE p2.id <> $1
        AND p2.is_active = TRUE
        AND (LOWER(COALESCE(c2.name, p2.category)) = LOWER($2) OR $2 IS NULL)
      ORDER BY p2.created_at DESC
      LIMIT 10
      `,
      [productId, product.category || null],
    );

    return { ok: true, product: { ...product, similar: similar.rows } };
  }

  return {
    listProducts,
    getProduct,
  };
}

module.exports = {
  createProductsService,
};
