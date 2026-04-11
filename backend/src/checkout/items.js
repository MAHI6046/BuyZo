function createCheckoutItemUtils({ asCheckoutError, roundCurrencyAmount }) {
  function normalizeCheckoutItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw asCheckoutError(400, 'items are required');
    }
    const forbiddenItemPricingFields = [
      'price',
      'price_sale',
      'price_mrp',
      'unit_price',
      'line_total',
      'subtotal',
      'total',
      'total_amount',
      'discount',
      'discount_amount',
      'delivery_fee',
      'tax',
      'tax_amount',
    ];
    const byProduct = new Map();
    for (const item of rawItems) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw asCheckoutError(400, 'Invalid item payload');
      }
      for (const field of forbiddenItemPricingFields) {
        if (Object.prototype.hasOwnProperty.call(item, field)) {
          throw asCheckoutError(400, `Client pricing field "${field}" is not allowed in items`);
        }
      }
      const productId = Number(item?.product_id);
      const quantity = Number(item?.quantity);
      if (!Number.isInteger(productId) || productId <= 0) {
        throw asCheckoutError(400, 'Invalid product_id in items');
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw asCheckoutError(400, 'Invalid quantity in items');
      }
      byProduct.set(productId, (byProduct.get(productId) || 0) + quantity);
    }
    return byProduct;
  }

  async function calculateItemTotalFromItems(client, rawItems) {
    const byProduct = normalizeCheckoutItems(rawItems);
    const productIds = [...byProduct.keys()];
    const productsRes = await client.query(
      `
      SELECT id, name, is_active, price_sale
      FROM products
      WHERE id = ANY($1::bigint[])
      `,
      [productIds],
    );
    const productsById = new Map();
    for (const row of productsRes.rows) {
      productsById.set(Number(row.id), row);
    }

    let itemTotal = 0;
    for (const [productId, quantity] of byProduct.entries()) {
      const product = productsById.get(productId);
      if (!product) {
        throw asCheckoutError(404, `Product ${productId} not found`);
      }
      if (!product.is_active) {
        throw asCheckoutError(409, `${product.name} is currently unavailable`, { productId });
      }
      itemTotal += Number(product.price_sale) * quantity;
    }

    return {
      itemTotal: roundCurrencyAmount(itemTotal),
      byProduct,
    };
  }

  return {
    normalizeCheckoutItems,
    calculateItemTotalFromItems,
  };
}

module.exports = { createCheckoutItemUtils };
