const {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
} = require('../../errors');

function createFavoritesService({ db, parseInteger, normalizeFavoriteBookLabel }) {
  function requireUid(firebaseUid) {
    const normalized = String(firebaseUid || '').trim();
    if (!normalized) throw new UnauthorizedError('Unauthenticated request');
    return normalized;
  }

  async function listBooks(firebaseUid) {
    const uid = requireUid(firebaseUid);
    const result = await db.query(
      `
      SELECT
        fb.id,
        fb.label,
        fb.sort_order,
        fb.created_at,
        fb.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'favorite_id', pf.id,
              'created_at', pf.created_at,
              'product', json_build_object(
                'id', p.id,
                'name', p.name,
                'short_description', p.short_description,
                'description', p.description,
                'category', COALESCE(c.name, p.category),
                'brand', p.brand,
                'is_veg', p.is_veg,
                'price_mrp', p.price_mrp,
                'price_sale', p.price_sale,
                'stock_qty', p.stock_qty,
                'primary_image_url', p.primary_image_url,
                'discount_percent', ROUND(
                  CASE
                    WHEN p.price_mrp > 0 THEN ((p.price_mrp - p.price_sale) / p.price_mrp) * 100
                    ELSE 0
                  END,
                  2
                ),
                'images', COALESCE(
                  (
                    SELECT json_agg(
                      json_build_object(
                        'id', pi.id,
                        'image_url', pi.image_url,
                        'sort_order', pi.sort_order
                      )
                      ORDER BY pi.sort_order, pi.id
                    )
                    FROM product_images pi
                    WHERE pi.product_id = p.id
                  ),
                  '[]'::json
                ),
                'variants', COALESCE(
                  (
                    SELECT json_agg(
                      json_build_object(
                        'id', pv.id,
                        'label', pv.label,
                        'grams', pv.grams,
                        'size_code', pv.size_code,
                        'mrp', pv.mrp,
                        'sale_price', pv.sale_price,
                        'stock_qty', pv.stock_qty,
                        'is_default', pv.is_default
                      )
                      ORDER BY pv.is_default DESC, pv.id
                    )
                    FROM product_variants pv
                    WHERE pv.product_id = p.id
                  ),
                  '[]'::json
                )
              )
            )
            ORDER BY pf.created_at DESC, pf.id DESC
          ) FILTER (WHERE pf.id IS NOT NULL AND p.id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM favorite_books fb
      LEFT JOIN product_favorites pf ON pf.book_id = fb.id
      LEFT JOIN products p ON p.id = pf.product_id AND p.is_active = TRUE
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE fb.user_firebase_uid = $1
      GROUP BY fb.id
      ORDER BY fb.sort_order ASC, fb.created_at ASC, fb.id ASC
      `,
      [uid],
    );

    const favoriteProductIds = new Set();
    for (const row of result.rows) {
      const items = Array.isArray(row.items) ? row.items : [];
      for (const item of items) {
        const productId = Number(item?.product?.id || 0);
        if (Number.isInteger(productId) && productId > 0) {
          favoriteProductIds.add(productId);
        }
      }
    }

    return {
      ok: true,
      books: result.rows,
      favorite_product_ids: [...favoriteProductIds],
    };
  }

  async function addBook(firebaseUid, rawLabel) {
    const uid = requireUid(firebaseUid);
    const label = normalizeFavoriteBookLabel(rawLabel);
    if (!label) {
      throw new ValidationError('Label is required');
    }

    const created = await db.query(
      `
      INSERT INTO favorite_books (user_firebase_uid, label, sort_order, created_at, updated_at)
      VALUES (
        $1::text,
        $2::text,
        COALESCE((SELECT MAX(sort_order) + 1 FROM favorite_books WHERE user_firebase_uid = $1::text), 0),
        NOW(),
        NOW()
      )
      ON CONFLICT (user_firebase_uid, label)
      DO NOTHING
      RETURNING id, label, sort_order, created_at, updated_at
      `,
      [uid, label],
    );

    if (created.rowCount === 0) {
      throw new ConflictError('A favorites book with this label already exists');
    }

    return { ok: true, book: { ...created.rows[0], items: [] } };
  }

  async function deleteBook(firebaseUid, rawBookId) {
    const uid = requireUid(firebaseUid);
    const bookId = parseInteger(rawBookId, 0);
    if (bookId <= 0) {
      throw new ValidationError('Invalid book id');
    }

    const deleted = await db.query(
      `
      DELETE FROM favorite_books
      WHERE id = $1
        AND user_firebase_uid = $2
      RETURNING id
      `,
      [bookId, uid],
    );
    if (deleted.rowCount === 0) {
      throw new NotFoundError('Favorites book not found');
    }
    return { ok: true, deleted: true };
  }

  async function addItem(firebaseUid, rawBookId, rawProductId) {
    const uid = requireUid(firebaseUid);
    const productId = parseInteger(rawProductId, 0);
    const bookId = parseInteger(rawBookId, 0);
    if (productId <= 0 || bookId <= 0) {
      throw new ValidationError('book_id and product_id are required');
    }

    const [bookRes, productRes] = await Promise.all([
      db.query(
        `
        SELECT id, label
        FROM favorite_books
        WHERE id = $1
          AND user_firebase_uid = $2
        LIMIT 1
        `,
        [bookId, uid],
      ),
      db.query(
        `
        SELECT id
        FROM products
        WHERE id = $1
          AND is_active = TRUE
        LIMIT 1
        `,
        [productId],
      ),
    ]);

    if (bookRes.rowCount === 0) {
      throw new NotFoundError('Favorites book not found');
    }
    if (productRes.rowCount === 0) {
      throw new NotFoundError('Product not found');
    }

    const existing = await db.query(
      `
      SELECT id, user_firebase_uid, book_id, product_id, created_at
      FROM product_favorites
      WHERE book_id = $1
        AND product_id = $2
      LIMIT 1
      `,
      [bookId, productId],
    );

    if (existing.rowCount > 0) {
      return {
        ok: true,
        added: false,
        favorite: existing.rows[0],
      };
    }

    const inserted = await db.query(
      `
      INSERT INTO product_favorites (user_firebase_uid, book_id, product_id, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id, user_firebase_uid, book_id, product_id, created_at
      `,
      [uid, bookId, productId],
    );

    return {
      ok: true,
      added: inserted.rowCount > 0,
      favorite: inserted.rows[0] || null,
    };
  }

  async function removeByProduct(firebaseUid, rawProductId) {
    const uid = requireUid(firebaseUid);
    const productId = parseInteger(rawProductId, 0);
    if (productId <= 0) {
      throw new ValidationError('Invalid product id');
    }

    const deleted = await db.query(
      `
      DELETE FROM product_favorites
      WHERE user_firebase_uid = $1
        AND product_id = $2
      RETURNING id
      `,
      [uid, productId],
    );

    return {
      ok: true,
      removed_count: deleted.rowCount,
      removed: deleted.rowCount > 0,
    };
  }

  async function removeItem(firebaseUid, rawFavoriteId) {
    const uid = requireUid(firebaseUid);
    const favoriteId = parseInteger(rawFavoriteId, 0);
    if (favoriteId <= 0) {
      throw new ValidationError('Invalid favorite id');
    }

    const deleted = await db.query(
      `
      DELETE FROM product_favorites
      WHERE id = $1
        AND user_firebase_uid = $2
      RETURNING id
      `,
      [favoriteId, uid],
    );

    if (deleted.rowCount === 0) {
      throw new NotFoundError('Favorite item not found');
    }
    return { ok: true, deleted: true };
  }

  return {
    listBooks,
    addBook,
    deleteBook,
    addItem,
    removeByProduct,
    removeItem,
  };
}

module.exports = {
  createFavoritesService,
};
