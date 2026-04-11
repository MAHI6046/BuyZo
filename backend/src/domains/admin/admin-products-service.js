const { ValidationError, NotFoundError, AppError } = require('../../errors');

function createAdminProductsService({
  ...serviceContext
}) {
  const { db, logger } = serviceContext;
  const {
    ensurePricingSchema,
    getProductById,
    toSlug,
    bumpProductsCacheVersion,
    resolveCategory,
    safeNum,
    getProductEmbeddings,
    getProductsCacheVersion,
    cacheSegment,
    getJsonCache,
    setJsonCache,
    CATEGORIES_CACHE_TTL_SECONDS,
    randomUUID,
    parseInteger,
    clamp,
    encodeCursor,
    decodeCursor,
  } = serviceContext;

  const ANALYTICS_CACHE_TTL_SECONDS = 60;

  function parseDateOrNull(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  function parseBooleanQuery(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return null;
  }

  async function listProducts(query = {}) {
    const limit = clamp(parseInteger(query?.limit, 30), 1, 100);
    const cursor = String(query?.cursor || '').trim();
    const decodedCursor = decodeCursor(cursor);
    const search = String(query?.search || '').trim();
    const categoryIdRaw = Number.parseInt(String(query?.category_id || ''), 10);
    const categoryId = Number.isFinite(categoryIdRaw) ? categoryIdRaw : null;
    const isActive = parseBooleanQuery(query?.is_active);

    const params = [];
    const whereClauses = [];
    if (search) {
      params.push(`%${search}%`);
      const searchParam = `$${params.length}`;
      whereClauses.push(
        `(p.name ILIKE ${searchParam} OR p.brand ILIKE ${searchParam} OR COALESCE(c.name, p.category, '') ILIKE ${searchParam})`,
      );
    }
    if (Number.isInteger(categoryId) && categoryId > 0) {
      params.push(categoryId);
      whereClauses.push(`p.category_id = $${params.length}`);
    }
    if (isActive === true || isActive === false) {
      params.push(isActive);
      whereClauses.push(`p.is_active = $${params.length}`);
    }
    if (decodedCursor) {
      params.push(decodedCursor.createdAt);
      const createdAtParam = `$${params.length}`;
      params.push(decodedCursor.id);
      const idParam = `$${params.length}`;
      whereClauses.push(
        `(p.created_at < ${createdAtParam}::timestamptz OR (p.created_at = ${createdAtParam}::timestamptz AND p.id < ${idParam}::bigint))`,
      );
    }
    params.push(limit + 1);
    const limitParam = `$${params.length}`;
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT p.id, p.name, p.slug, p.category_id, COALESCE(c.name, p.category) AS category, p.brand, p.price_mrp, p.price_sale, p.stock_qty, p.is_active, p.primary_image_url, p.created_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${whereSql}
       ORDER BY p.created_at DESC
       LIMIT ${limitParam}`,
      params,
    );
    const hasMore = result.rows.length > limit;
    const products = hasMore ? result.rows.slice(0, limit) : result.rows;
    const tail = products[products.length - 1];
    const nextCursor = hasMore && tail ? encodeCursor(tail.created_at, tail.id) : null;

    return {
      ok: true,
      products,
      page_info: {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
        total_returned: products.length,
      },
    };
  }

  async function listOrders(query = {}) {
    const limit = clamp(parseInteger(query?.limit, 30), 1, 100);
    const cursor = String(query?.cursor || '').trim();
    const decodedCursor = decodeCursor(cursor);
    const status = String(query?.status || '').trim().toLowerCase();
    const paymentStatus = String(query?.payment_status || '').trim().toLowerCase();

    const params = [];
    const whereClauses = [];
    if (status) {
      params.push(status);
      whereClauses.push(`LOWER(o.status) = $${params.length}`);
    }
    if (paymentStatus) {
      params.push(paymentStatus);
      whereClauses.push(`LOWER(o.payment_status) = $${params.length}`);
    }
    if (decodedCursor) {
      params.push(decodedCursor.createdAt);
      const createdAtParam = `$${params.length}`;
      params.push(decodedCursor.id);
      const idParam = `$${params.length}`;
      whereClauses.push(
        `(o.created_at < ${createdAtParam}::timestamptz OR (o.created_at = ${createdAtParam}::timestamptz AND o.id < ${idParam}::bigint))`,
      );
    }
    params.push(limit + 1);
    const limitParam = `$${params.length}`;
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const result = await db.query(
      `
      SELECT
        o.id,
        o.firebase_uid,
        o.status,
        o.payment_status,
        o.payment_method,
        o.currency,
        o.item_total,
        o.subtotal,
        o.delivery_fee,
        o.platform_fee,
        o.discount_amount,
        o.order_credit_used_amount,
        o.total_amount,
        o.created_at
      FROM orders o
      ${whereSql}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${limitParam}
      `,
      params,
    );

    const hasMore = result.rows.length > limit;
    const orders = hasMore ? result.rows.slice(0, limit) : result.rows;
    const tail = orders[orders.length - 1];
    const nextCursor = hasMore && tail ? encodeCursor(tail.created_at, tail.id) : null;

    return {
      ok: true,
      orders,
      page_info: {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
        total_returned: orders.length,
      },
    };
  }

  async function getDashboardStats() {
    const result = await db.query(
      `SELECT
         COUNT(*)::int AS total_products,
         COUNT(*) FILTER (WHERE p.is_active = TRUE)::int AS active_products,
         COUNT(*) FILTER (WHERE COALESCE(p.stock_qty, 0) < 10)::int AS low_stock,
         COUNT(DISTINCT NULLIF(LOWER(TRIM(COALESCE(c.name, p.category, ''))), ''))::int AS total_categories
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id`,
    );

    const row = result.rows[0] || {};
    return {
      ok: true,
      stats: {
        totalProducts: Number(row.total_products || 0),
        activeProducts: Number(row.active_products || 0),
        totalCategories: Number(row.total_categories || 0),
        lowStock: Number(row.low_stock || 0),
      },
    };
  }

  async function getAnalyticsMetrics(query = {}) {
    await ensurePricingSchema();
    const now = new Date();
    const endDate = parseDateOrNull(query?.end_date) || now;
    const startDate =
      parseDateOrNull(query?.start_date) ||
      new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (startDate >= endDate) {
      throw new ValidationError('start_date must be earlier than end_date');
    }

    const metricsCacheKey = [
      'admin',
      'analytics',
      'metrics',
      `start:${cacheSegment(startDate.toISOString())}`,
      `end:${cacheSegment(endDate.toISOString())}`,
    ].join(':');
    const cachedMetrics = await getJsonCache(metricsCacheKey);
    if (cachedMetrics && cachedMetrics.ok === true) {
      return cachedMetrics;
    }

    let row = {};
    let partial = false;
    try {
      const metricsRes = await db.query(
        `
      WITH filtered_orders AS (
        SELECT
          id,
          firebase_uid,
          created_at,
          payment_status,
          payment_method,
          total_amount,
          order_credit_used_amount
        FROM orders
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
      ),
      payment_summary AS (
        SELECT
          COUNT(*)::int AS total_orders,
          COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS successful_payments,
          COUNT(*) FILTER (WHERE payment_status = 'failed')::int AS failed_payments,
          COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0)::numeric AS total_sales
        FROM filtered_orders
      ),
      payment_methods AS (
        SELECT
          COALESCE(payment_method, 'unknown') AS payment_method,
          COUNT(*)::int AS order_count,
          COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0)::numeric AS paid_amount
        FROM filtered_orders
        GROUP BY COALESCE(payment_method, 'unknown')
      ),
      credit_summary AS (
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'earned'), 0)::numeric AS credits_added,
          COALESCE(SUM(amount) FILTER (WHERE type = 'used'), 0)::numeric AS credits_used
        FROM order_credit_transactions
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
      )
      SELECT
        ps.total_orders,
        ps.successful_payments,
        ps.failed_payments,
        ps.total_sales,
        cs.credits_added,
        cs.credits_used,
        (
          SELECT COALESCE(SUM(
            CASE
              WHEN type = 'earned' THEN amount
              WHEN type = 'used' THEN -amount
              ELSE 0
            END
          ), 0)::numeric
          FROM order_credit_transactions
        ) AS credits_balance_all_time,
        (
          SELECT COALESCE(JSON_AGG(
            JSON_BUILD_OBJECT(
              'order_id', fo.id,
              'firebase_uid', fo.firebase_uid,
              'amount', fo.total_amount,
              'payment_method', COALESCE(fo.payment_method, 'unknown'),
              'created_at', fo.created_at
            )
            ORDER BY fo.total_amount DESC, fo.created_at DESC
          ), '[]'::json)
          FROM (
            SELECT id, firebase_uid, total_amount, payment_method, created_at
            FROM filtered_orders
            WHERE payment_status = 'paid'
            ORDER BY total_amount DESC, created_at DESC
            LIMIT 10
          ) fo
        ) AS top_payments,
        (
          SELECT COALESCE(JSON_AGG(
            JSON_BUILD_OBJECT(
              'payment_method', pm.payment_method,
              'order_count', pm.order_count,
              'paid_amount', pm.paid_amount
            )
            ORDER BY pm.paid_amount DESC
          ), '[]'::json)
          FROM payment_methods pm
        ) AS payment_method_breakdown
      FROM payment_summary ps
      CROSS JOIN credit_summary cs
      `,
        [startDate.toISOString(), endDate.toISOString()],
      );
      row = metricsRes.rows[0] || {};
    } catch (analyticsError) {
      partial = true;
      logger?.warn?.(`Admin analytics metrics fallback: ${analyticsError?.message || analyticsError}`);
      const fallbackRes = await db.query(
        `
        WITH filtered_orders AS (
          SELECT
            id,
            firebase_uid,
            created_at,
            payment_status,
            payment_method,
            total_amount
          FROM orders
          WHERE created_at >= $1::timestamptz
            AND created_at <= $2::timestamptz
        ),
        payment_summary AS (
          SELECT
            COUNT(*)::int AS total_orders,
            COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS successful_payments,
            COUNT(*) FILTER (WHERE payment_status = 'failed')::int AS failed_payments,
            COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0)::numeric AS total_sales
          FROM filtered_orders
        ),
        payment_methods AS (
          SELECT
            COALESCE(payment_method, 'unknown') AS payment_method,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0)::numeric AS paid_amount
          FROM filtered_orders
          GROUP BY COALESCE(payment_method, 'unknown')
        )
        SELECT
          ps.total_orders,
          ps.successful_payments,
          ps.failed_payments,
          ps.total_sales,
          0::numeric AS credits_added,
          0::numeric AS credits_used,
          0::numeric AS credits_balance_all_time,
          (
            SELECT COALESCE(JSON_AGG(
              JSON_BUILD_OBJECT(
                'order_id', fo.id,
                'firebase_uid', fo.firebase_uid,
                'amount', fo.total_amount,
                'payment_method', COALESCE(fo.payment_method, 'unknown'),
                'created_at', fo.created_at
              )
              ORDER BY fo.total_amount DESC, fo.created_at DESC
            ), '[]'::json)
            FROM (
              SELECT id, firebase_uid, total_amount, payment_method, created_at
              FROM filtered_orders
              WHERE payment_status = 'paid'
              ORDER BY total_amount DESC, created_at DESC
              LIMIT 10
            ) fo
          ) AS top_payments,
          (
            SELECT COALESCE(JSON_AGG(
              JSON_BUILD_OBJECT(
                'payment_method', pm.payment_method,
                'order_count', pm.order_count,
                'paid_amount', pm.paid_amount
              )
              ORDER BY pm.paid_amount DESC
            ), '[]'::json)
            FROM payment_methods pm
          ) AS payment_method_breakdown
        FROM payment_summary ps
        `,
        [startDate.toISOString(), endDate.toISOString()],
      );
      row = fallbackRes.rows[0] || {};
    }

    const successfulPayments = Number(row.successful_payments || 0);
    const failedPayments = Number(row.failed_payments || 0);
    const settledPayments = successfulPayments + failedPayments;
    const successRate =
      settledPayments > 0 ? Math.round((successfulPayments / settledPayments) * 10000) / 100 : 0;

    const payload = {
      ok: true,
      partial,
      filters: {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      },
      metrics: {
        total_orders: Number(row.total_orders || 0),
        total_sales: Number(row.total_sales || 0),
        successful_payments: successfulPayments,
        failed_payments: failedPayments,
        payment_success_rate: successRate,
        total_credits_added: Number(row.credits_added || 0),
        total_credits_earned: Number(row.credits_added || 0),
        total_credits_used: Number(row.credits_used || 0),
        total_credits_balance: Number(row.credits_balance_all_time || 0),
        payment_method_breakdown: Array.isArray(row.payment_method_breakdown)
          ? row.payment_method_breakdown
          : [],
        top_payments: Array.isArray(row.top_payments) ? row.top_payments : [],
      },
    };

    await setJsonCache(metricsCacheKey, payload, ANALYTICS_CACHE_TTL_SECONDS);
    return payload;
  }

  async function getAnalyticsTopItems(query = {}) {
    await ensurePricingSchema();
    const now = new Date();
    const endDate = parseDateOrNull(query?.end_date) || now;
    const startDate =
      parseDateOrNull(query?.start_date) ||
      new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const limit = Math.min(50, Math.max(1, Number(query?.limit || 20)));
    const page = Math.max(1, Number(query?.page || 1));
    const offset = (page - 1) * limit;
    if (startDate >= endDate) {
      throw new ValidationError('start_date must be earlier than end_date');
    }

    const topItemsCacheKey = [
      'admin',
      'analytics',
      'top-items',
      `start:${cacheSegment(startDate.toISOString())}`,
      `end:${cacheSegment(endDate.toISOString())}`,
      `limit:${limit}`,
      `page:${page}`,
    ].join(':');
    const cachedTopItems = await getJsonCache(topItemsCacheKey);
    if (cachedTopItems && cachedTopItems.ok === true) {
      return cachedTopItems;
    }

    let row = {};
    let partial = false;
    try {
      const result = await db.query(
        `
      WITH paid_item_stats AS (
        SELECT
          oi.product_id,
          MIN(oi.product_name) AS product_name,
          COUNT(DISTINCT oi.order_id)::int AS orders_count,
          COALESCE(SUM(oi.quantity), 0)::int AS total_quantity,
          COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric AS total_value
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.payment_status = 'paid'
          AND o.created_at >= $1::timestamptz
          AND o.created_at <= $2::timestamptz
        GROUP BY oi.product_id
      ),
      total AS (
        SELECT COUNT(*)::int AS total_items
        FROM paid_item_stats
      )
      SELECT
        (SELECT total_items FROM total) AS total_items,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'product_id', t.product_id,
                'product_name', t.product_name,
                'orders_count', t.orders_count,
                'total_quantity', t.total_quantity,
                'total_value', t.total_value
              )
              ORDER BY t.orders_count DESC, t.total_quantity DESC, t.product_id ASC
            )
            FROM (
              SELECT *
              FROM paid_item_stats
              ORDER BY orders_count DESC, total_quantity DESC, product_id ASC
              LIMIT $3::int
              OFFSET $4::int
            ) t
          ),
          '[]'::json
        ) AS top_by_order_count,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'product_id', t.product_id,
                'product_name', t.product_name,
                'orders_count', t.orders_count,
                'total_quantity', t.total_quantity,
                'total_value', t.total_value
              )
              ORDER BY t.total_quantity DESC, t.orders_count DESC, t.product_id ASC
            )
            FROM (
              SELECT *
              FROM paid_item_stats
              ORDER BY total_quantity DESC, orders_count DESC, product_id ASC
              LIMIT $3::int
              OFFSET $4::int
            ) t
          ),
          '[]'::json
        ) AS most_repeated_items,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'product_id', t.product_id,
                'product_name', t.product_name,
                'orders_count', t.orders_count,
                'total_quantity', t.total_quantity,
                'total_value', t.total_value
              )
              ORDER BY t.total_value DESC, t.orders_count DESC, t.product_id ASC
            )
            FROM (
              SELECT *
              FROM paid_item_stats
              ORDER BY total_value DESC, orders_count DESC, product_id ASC
              LIMIT $3::int
              OFFSET $4::int
            ) t
          ),
          '[]'::json
        ) AS most_valued_items
      `,
        [startDate.toISOString(), endDate.toISOString(), limit, offset],
      );
      row = result.rows[0] || {};
    } catch (analyticsError) {
      partial = true;
      logger?.warn?.(`Admin analytics top-items fallback: ${analyticsError?.message || analyticsError}`);
      row = {
        total_items: 0,
        top_by_order_count: [],
        most_repeated_items: [],
        most_valued_items: [],
      };
    }

    const totalItems = Number(row.total_items || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const payload = {
      ok: true,
      partial,
      filters: {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        limit,
        page,
        total_items: totalItems,
        total_pages: totalPages,
      },
      top_by_order_count: Array.isArray(row.top_by_order_count) ? row.top_by_order_count : [],
      most_repeated_items: Array.isArray(row.most_repeated_items) ? row.most_repeated_items : [],
      most_valued_items: Array.isArray(row.most_valued_items) ? row.most_valued_items : [],
    };

    await setJsonCache(topItemsCacheKey, payload, ANALYTICS_CACHE_TTL_SECONDS);
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

    return { ok: true, product };
  }

  async function listAdminCategories() {
    const result = await db.query(
      `SELECT id, name, slug, image_url, is_active
       FROM categories
       ORDER BY name ASC`,
    );
    return { ok: true, categories: result.rows };
  }

  async function listPublicCategories(query = {}) {
    const storeId = String(query?.store_id || '').trim();
    const categoriesVersion =
      typeof getProductsCacheVersion === 'function'
        ? await getProductsCacheVersion({ category: 'all' })
        : 'v0';
    const cacheKey = `categories:${categoriesVersion}:${cacheSegment(storeId, 'all')}`;
    const cached = await getJsonCache(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const params = [];
    let storeScopedFilter = '';
    if (storeId) {
      params.push(storeId);
      storeScopedFilter = `
        AND EXISTS (
          SELECT 1
          FROM products p
          WHERE p.category_id = c.id
            AND p.is_active = TRUE
            AND p.store_id = $1
        )
      `;
    }

    const result = await db.query(
      `
      SELECT c.id, c.name, c.slug, c.image_url, c.parent_id, c.sort_order
      FROM categories c
      WHERE c.is_active = TRUE
      ${storeScopedFilter}
      ORDER BY c.sort_order ASC, c.name ASC
      `,
      params,
    );

    const payload = { ok: true, categories: result.rows };
    await setJsonCache(cacheKey, payload, CATEGORIES_CACHE_TTL_SECONDS);
    return { ...payload, cached: false };
  }

  async function createCategory(body = {}) {
    const name = String(body?.name || '').trim();
    const imageUrlRaw = String(body?.image_url || '').trim();
    const imageUrl = imageUrlRaw || null;
    if (!name) {
      throw new ValidationError('Category name is required');
    }

    const slug = toSlug(name);
    if (!slug) {
      throw new ValidationError('Invalid category name');
    }

    const result = await db.query(
      `
      INSERT INTO categories (name, slug, image_url)
      VALUES ($1, $2, $3)
      ON CONFLICT (name)
      DO UPDATE SET
        is_active = TRUE,
        image_url = COALESCE(EXCLUDED.image_url, categories.image_url)
      RETURNING id, name, slug, image_url, is_active
      `,
      [name, slug, imageUrl],
    );

    await bumpProductsCacheVersion({ category: name });
    return { ok: true, category: result.rows[0] };
  }

  async function updateCategory(rawCategoryId, body = {}) {
    const categoryId = Number(rawCategoryId);
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      throw new ValidationError('Invalid category id');
    }

    const nameRaw = body?.name;
    const imageUrlRaw = body?.image_url;
    const isActiveRaw = body?.is_active;

    const hasName = typeof nameRaw !== 'undefined';
    const hasImageUrl = typeof imageUrlRaw !== 'undefined';
    const hasIsActive = typeof isActiveRaw !== 'undefined';
    if (!hasName && !hasImageUrl && !hasIsActive) {
      throw new ValidationError('No category fields provided for update');
    }

    const sets = [];
    const values = [categoryId];
    let nextIndex = 2;

    if (hasName) {
      const name = String(nameRaw || '').trim();
      if (!name) {
        throw new ValidationError('Category name is required');
      }
      const slug = toSlug(name);
      if (!slug) {
        throw new ValidationError('Invalid category name');
      }
      sets.push(`name = $${nextIndex++}`);
      values.push(name);
      sets.push(`slug = $${nextIndex++}`);
      values.push(slug);
    }

    if (hasImageUrl) {
      const imageUrl = String(imageUrlRaw || '').trim() || null;
      sets.push(`image_url = $${nextIndex++}`);
      values.push(imageUrl);
    }

    if (hasIsActive) {
      if (typeof isActiveRaw !== 'boolean') {
        throw new ValidationError('is_active must be a boolean');
      }
      sets.push(`is_active = $${nextIndex++}`);
      values.push(isActiveRaw);
    }

    sets.push('updated_at = NOW()');
    const query = `
      UPDATE categories
      SET ${sets.join(', ')}
      WHERE id = $1
      RETURNING id, name, slug, image_url, is_active
    `;

    try {
      const result = await db.query(query, values);
      if (result.rowCount === 0) {
        throw new NotFoundError('Category not found');
      }
      await bumpProductsCacheVersion({ category: result.rows[0].name });
      return { ok: true, category: result.rows[0] };
    } catch (error) {
      if (error?.code === '23505') {
        throw new ValidationError('Category name already exists');
      }
      throw error;
    }
  }

  async function createProduct(body = {}) {
    const client = await db.connect();
    let productId = null;
    let embeddingSynced = false;
    try {
      const {
        name,
        slug,
        short_description,
        description,
        category_id,
        category,
        brand,
        is_veg,
        is_active,
        price_mrp,
        price_sale,
        stock_qty,
        primary_image_url,
        images = [],
        variants = [],
        highlights = [],
        nutrition = [],
      } = body;

      if (!name) {
        throw new ValidationError('name is required');
      }

      let resolvedCategory = null;
      try {
        resolvedCategory = await resolveCategory(client, {
          categoryId: category_id,
          categoryName: category,
        });
      } catch (error) {
        throw new ValidationError(error.message);
      }
      if (!resolvedCategory) {
        throw new ValidationError('category is required');
      }

      await client.query('BEGIN');

      const productRes = await client.query(
        `
        INSERT INTO products (
          name, slug, short_description, description, category, category_id, brand,
          is_veg, is_active, price_mrp, price_sale, stock_qty, primary_image_url
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id
        `,
        [
          name,
          slug || toSlug(name),
          short_description || null,
          description || null,
          resolvedCategory?.name || null,
          resolvedCategory?.id || null,
          brand || null,
          typeof is_veg === 'boolean' ? is_veg : null,
          typeof is_active === 'boolean' ? is_active : true,
          safeNum(price_mrp),
          safeNum(price_sale),
          Number.isFinite(Number(stock_qty)) ? Number(stock_qty) : 0,
          primary_image_url || null,
        ],
      );

      productId = productRes.rows[0].id;

      for (let i = 0; i < images.length; i += 1) {
        const url = String(images[i] || '').trim();
        if (!url) continue;
        await client.query(
          `INSERT INTO product_images (product_id, image_url, sort_order) VALUES ($1,$2,$3)`,
          [productId, url, i],
        );
      }

      for (const variant of variants) {
        if (!variant || !variant.label) continue;
        await client.query(
          `
          INSERT INTO product_variants (product_id, label, grams, size_code, mrp, sale_price, stock_qty, is_default)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `,
          [
            productId,
            String(variant.label),
            Number.isFinite(Number(variant.grams)) ? Number(variant.grams) : null,
            variant.size_code || null,
            safeNum(variant.mrp, safeNum(price_mrp)),
            safeNum(variant.sale_price, safeNum(price_sale)),
            Number.isFinite(Number(variant.stock_qty)) ? Number(variant.stock_qty) : 0,
            !!variant.is_default,
          ],
        );
      }

      for (let i = 0; i < highlights.length; i += 1) {
        const text = String(highlights[i] || '').trim();
        if (!text) continue;
        await client.query(
          `INSERT INTO product_highlights (product_id, highlight, sort_order) VALUES ($1,$2,$3)`,
          [productId, text, i],
        );
      }

      for (let i = 0; i < nutrition.length; i += 1) {
        const row = nutrition[i];
        if (!row || !row.nutrient || !row.value) continue;
        await client.query(
          `INSERT INTO product_nutrition (product_id, nutrient, value, sort_order) VALUES ($1,$2,$3,$4)`,
          [productId, String(row.nutrient), String(row.value), i],
        );
      }

      await getProductEmbeddings().upsertProductEmbedding(
        {
          id: productId,
          name,
          slug: slug || toSlug(name),
          short_description: short_description || null,
          description: description || null,
          category: resolvedCategory?.name || null,
          brand: brand || null,
          is_active: typeof is_active === 'boolean' ? is_active : true,
          price_sale: safeNum(price_sale),
          stock_qty: Number.isFinite(Number(stock_qty)) ? Number(stock_qty) : 0,
          highlights,
          nutrition,
          variants,
        },
        client,
      );
      embeddingSynced = true;

      await client.query('COMMIT');
      await bumpProductsCacheVersion({ category: resolvedCategory?.name });

      const product = await getProductById(productId);
      return { ok: true, product };
    } catch (error) {
      await client.query('ROLLBACK');
      if (embeddingSynced && productId) {
        try {
          await getProductEmbeddings().deleteProductEmbedding(productId);
        } catch (cleanupError) {
          logger?.error?.('Failed to rollback product embedding after DB failure', {
            productId,
            message: cleanupError?.message || String(cleanupError),
          });
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateProduct(rawProductId, body = {}) {
    const client = await db.connect();
    try {
      const productId = Number(rawProductId);
      if (!Number.isFinite(productId)) {
        throw new ValidationError('Invalid product id');
      }

      const {
        name,
        slug,
        short_description,
        description,
        category_id,
        category,
        brand,
        is_veg,
        is_active,
        price_mrp,
        price_sale,
        stock_qty,
        primary_image_url,
        images = [],
        variants = [],
        highlights = [],
        nutrition = [],
      } = body;

      let resolvedCategory = null;
      try {
        resolvedCategory = await resolveCategory(client, {
          categoryId: category_id,
          categoryName: category,
        });
      } catch (error) {
        throw new ValidationError(error.message);
      }
      if (!resolvedCategory) {
        throw new ValidationError('category is required');
      }

      const existingCategoryRes = await client.query(
        `
        SELECT COALESCE(c.name, p.category) AS category_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = $1
        `,
        [productId],
      );
      const previousCategory = existingCategoryRes.rows[0]?.category_name || null;

      await client.query('BEGIN');

      await client.query(
        `
        UPDATE products SET
          name = $2,
          slug = $3,
          short_description = $4,
          description = $5,
          category = $6,
          category_id = $7,
          brand = $8,
          is_veg = $9,
          is_active = $10,
          price_mrp = $11,
          price_sale = $12,
          stock_qty = $13,
          primary_image_url = $14
        WHERE id = $1
        `,
        [
          productId,
          name,
          slug || toSlug(name),
          short_description || null,
          description || null,
          resolvedCategory?.name || null,
          resolvedCategory?.id || null,
          brand || null,
          typeof is_veg === 'boolean' ? is_veg : null,
          typeof is_active === 'boolean' ? is_active : true,
          safeNum(price_mrp),
          safeNum(price_sale),
          Number.isFinite(Number(stock_qty)) ? Number(stock_qty) : 0,
          primary_image_url || null,
        ],
      );

      await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
      await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
      await client.query('DELETE FROM product_highlights WHERE product_id = $1', [productId]);
      await client.query('DELETE FROM product_nutrition WHERE product_id = $1', [productId]);

      for (let i = 0; i < images.length; i += 1) {
        const url = String(images[i] || '').trim();
        if (!url) continue;
        await client.query(
          `INSERT INTO product_images (product_id, image_url, sort_order) VALUES ($1,$2,$3)`,
          [productId, url, i],
        );
      }

      for (const variant of variants) {
        if (!variant || !variant.label) continue;
        await client.query(
          `INSERT INTO product_variants (product_id, label, grams, size_code, mrp, sale_price, stock_qty, is_default)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            productId,
            String(variant.label),
            Number.isFinite(Number(variant.grams)) ? Number(variant.grams) : null,
            variant.size_code || null,
            safeNum(variant.mrp, safeNum(price_mrp)),
            safeNum(variant.sale_price, safeNum(price_sale)),
            Number.isFinite(Number(variant.stock_qty)) ? Number(variant.stock_qty) : 0,
            !!variant.is_default,
          ],
        );
      }

      for (let i = 0; i < highlights.length; i += 1) {
        const text = String(highlights[i] || '').trim();
        if (!text) continue;
        await client.query(
          `INSERT INTO product_highlights (product_id, highlight, sort_order) VALUES ($1,$2,$3)`,
          [productId, text, i],
        );
      }

      for (let i = 0; i < nutrition.length; i += 1) {
        const row = nutrition[i];
        if (!row || !row.nutrient || !row.value) continue;
        await client.query(
          `INSERT INTO product_nutrition (product_id, nutrient, value, sort_order) VALUES ($1,$2,$3,$4)`,
          [productId, String(row.nutrient), String(row.value), i],
        );
      }

      await client.query('COMMIT');
      await bumpProductsCacheVersion({ category: previousCategory });
      await bumpProductsCacheVersion({ category: resolvedCategory?.name });

      const product = await getProductById(productId);
      try {
        await getProductEmbeddings().upsertProductEmbedding(product);
      } catch (embeddingError) {
        logger?.error?.('Failed to refresh product embedding after update', {
          productId,
          message: embeddingError?.message || String(embeddingError),
        });
      }
      return { ok: true, product };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function deleteProduct(rawProductId) {
    const productId = Number(rawProductId);
    if (!Number.isFinite(productId)) {
      throw new ValidationError('Invalid product id');
    }

    const categoryRes = await db.query(
      `
      SELECT COALESCE(c.name, p.category) AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1
      `,
      [productId],
    );
    if (categoryRes.rowCount === 0) {
      throw new NotFoundError('Product not found');
    }

    await db.query('DELETE FROM products WHERE id = $1', [productId]);
    try {
      await getProductEmbeddings().deleteProductEmbedding(productId);
    } catch (embeddingError) {
      logger?.error?.('Failed to delete product embedding', {
        productId,
        message: embeddingError?.message || String(embeddingError),
      });
    }
    await bumpProductsCacheVersion({ category: categoryRes.rows[0].category_name });
    return { ok: true, deleted: true, productId };
  }

  async function deleteCategory(rawCategoryId) {
    const client = await db.connect();
    try {
      const categoryId = Number(rawCategoryId);
      if (!Number.isFinite(categoryId)) {
        throw new ValidationError('Invalid category id');
      }

      await client.query('BEGIN');

      const categoryRes = await client.query('SELECT id, name FROM categories WHERE id = $1', [
        categoryId,
      ]);
      if (categoryRes.rowCount === 0) {
        throw new NotFoundError('Category not found');
      }

      await client.query('UPDATE products SET category_id = NULL, category = NULL WHERE category_id = $1', [
        categoryId,
      ]);
      await client.query('DELETE FROM categories WHERE id = $1', [categoryId]);

      await client.query('COMMIT');
      await bumpProductsCacheVersion({ category: categoryRes.rows[0].name });
      return { ok: true, deleted: true, categoryId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function createUploadUrl(body = {}) {
    const {
      fileName = `upload-${Date.now()}.jpg`,
      contentType = 'image/jpeg',
      folder = 'products',
    } = body || {};

    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint =
      process.env.R2_S3_ENDPOINT ||
      'https://9e681b73702dcc41c994e52d5b5f8216.r2.cloudflarestorage.com';
    const bucket = process.env.R2_BUCKET || 'logos';
    const publicBaseUrl =
      process.env.R2_PUBLIC_BASE_URL ||
      'https://pub-866258f4c59749ae92a01d084069b3ce.r2.dev';

    if (!accessKeyId || !secretAccessKey) {
      throw new AppError(
        'R2 credentials missing. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.',
        { status: 500, code: 'CONFIG_ERROR' },
      );
    }

    const key = `${folder}/${Date.now()}-${randomUUID()}-${String(fileName)
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(0, 120)}`;

    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 60 * 10 });
    const publicUrl = `${publicBaseUrl.replace(/\/$/, '')}/${key}`;

    return { ok: true, key, uploadUrl, publicUrl };
  }

  return {
    listProducts,
    listOrders,
    getDashboardStats,
    getAnalyticsMetrics,
    getAnalyticsTopItems,
    getProduct,
    listAdminCategories,
    listPublicCategories,
    createCategory,
    updateCategory,
    createProduct,
    updateProduct,
    deleteProduct,
    deleteCategory,
    createUploadUrl,
  };
}

module.exports = {
  createAdminProductsService,
};
