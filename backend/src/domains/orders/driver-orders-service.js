const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} = require('../../errors');

function createDriverOrdersService({
  db,
  logger,
  ensurePricingSchema,
  ensureDriverOrderColumns,
  PREVIOUS_ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  clamp,
  parseInteger,
  getOrdersCacheVersion,
  ORDERS_CACHE_SHAPE_VERSION,
  cacheSegment,
  getJsonCache,
  setJsonCache,
  ORDERS_CACHE_TTL_SECONDS,
  decodeCursor,
  DRIVER_EXECUTED_VISIBLE_LIMIT,
  hydrateDriverOrderCustomerNames,
  encodeCursor,
  bumpOrdersCacheVersion,
  publishOrderRealtimeUpdateFromRow,
  publishUserRealtimeWalletSnapshot,
  DRIVER_UPDATABLE_STATUSES,
  archiveDeliveredOrdersForDriver,
  resolveUserIdFromIdentity,
}) {
  const toCents = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.round((numeric + Number.EPSILON) * 100));
  };
  const centsToAmount = (cents) => Math.max(0, Number(cents || 0)) / 100;

  let pricingSchemaReady = false;
  let driverColumnsReady = false;
  const ensureDriverSchemaOnce = async () => {
    if (!pricingSchemaReady) {
      await ensurePricingSchema();
      pricingSchemaReady = true;
    }
    if (!driverColumnsReady) {
      await ensureDriverOrderColumns();
      driverColumnsReady = true;
    }
  };

  async function listCustomerOrders({ firebaseUid, type = 'active', limit = 20 }) {
    await ensureDriverSchemaOnce();

    const resolvedType = String(type || 'active').trim().toLowerCase();
    const statuses =
      resolvedType === 'previous' ? PREVIOUS_ORDER_STATUSES : ACTIVE_ORDER_STATUSES;
    const resolvedLimit = clamp(parseInteger(limit, 20), 1, 50);
    const version = await getOrdersCacheVersion(firebaseUid);
    const cacheKey = [
      'orders',
      `shape:${ORDERS_CACHE_SHAPE_VERSION}`,
      `user:${cacheSegment(firebaseUid, 'anonymous')}`,
      `type:${cacheSegment(resolvedType, 'active')}`,
      `limit:${resolvedLimit}`,
      `version:${cacheSegment(version, '0')}`,
    ].join(':');
    const cached = await getJsonCache(cacheKey);
    if (cached && cached.ok === true && Array.isArray(cached.orders)) {
      return cached;
    }

    const result = await db.query(
      `
      WITH page_orders AS (
        SELECT
          o.id,
          o.status,
          o.payment_status,
          o.currency,
          o.item_total,
          o.subtotal,
          o.delivery_fee,
          o.discount_amount,
          o.order_credit_used_amount,
          o.missing_items_credit_earned,
          o.delivery_fee_credit_earned,
          o.total_compensation_credit_earned,
          o.platform_fee,
          o.total_amount,
          o.promo_id,
          o.promo_code,
          o.fee_rule_id,
          o.fee_rule_version,
          o.delivery_pin,
          o.delivery_pin_generated_at,
          o.delivery_pin_verified_at,
          o.delivery_address_text,
          o.delivery_address_label,
          o.created_at
        FROM orders o
        WHERE o.firebase_uid = $1
          AND o.status = ANY($2::text[])
        ORDER BY o.created_at DESC
        LIMIT $3
      )
      SELECT
        p.*,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', oi.id,
                'product_id', oi.product_id,
                'product_name', oi.product_name,
                'unit_price', oi.unit_price,
                'quantity', oi.quantity,
                'line_total', oi.line_total,
                'picked_by_driver', oi.picked_by_driver
              )
              ORDER BY oi.id
            )
            FROM order_items oi
            WHERE oi.order_id = p.id
          ),
          '[]'::json
        ) AS items
      FROM page_orders p
      ORDER BY p.created_at DESC
      `,
      [firebaseUid, statuses, resolvedLimit],
    );

    const payload = { ok: true, orders: result.rows };
    await setJsonCache(cacheKey, payload, ORDERS_CACHE_TTL_SECONDS);
    return payload;
  }

  async function generateDeliveryPin({ orderId, firebaseUid }) {
    const resolvedOrderId = parseInteger(orderId, 0);
    if (resolvedOrderId <= 0) {
      throw new ValidationError('Invalid order id');
    }
    const normalizedUid = String(firebaseUid || '').trim();
    if (!normalizedUid) {
      throw new UnauthorizedError('Unauthorized');
    }

    const client = await db.connect();
    try {
      await ensureDriverSchemaOnce();
      await client.query('BEGIN');

      const orderRes = await client.query(
        `
        SELECT id, firebase_uid, status, payment_status, delivery_pin,
               assigned_driver_uid, assigned_driver_phone, assigned_at,
               delivered_at, currency, item_total, subtotal, delivery_fee,
               discount_amount, order_credit_used_amount, platform_fee,
               total_amount, missing_items_credit_earned, delivery_fee_credit_earned,
               total_compensation_credit_earned,
               delivery_pin_generated_at, delivery_pin_verified_at, created_at
        FROM orders
        WHERE id = $1
        FOR UPDATE
        `,
        [resolvedOrderId],
      );

      if (orderRes.rowCount === 0) {
        throw new NotFoundError('Order not found');
      }

      const order = orderRes.rows[0];
      if (String(order.firebase_uid || '').trim() !== normalizedUid) {
        throw new ForbiddenError('Forbidden');
      }

      const status = String(order.status || '').trim().toLowerCase();
      const paymentStatus = String(order.payment_status || '').trim().toLowerCase();
      if (paymentStatus !== 'paid') {
        throw new ConflictError('PIN can be generated only after payment is completed');
      }
      if (['delivered', 'cancelled', 'failed'].includes(status)) {
        throw new ConflictError('PIN generation is not available for this order status');
      }

      let deliveryPin = String(order.delivery_pin || '').trim();
      if (!deliveryPin) {
        const pinUpdate = await client.query(
          `
          UPDATE orders
          SET delivery_pin = LPAD((FLOOR(RANDOM() * 10000))::int::text, 4, '0'),
              delivery_pin_generated_at = COALESCE(delivery_pin_generated_at, NOW()),
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, firebase_uid, status, payment_status, assigned_driver_uid, assigned_driver_phone, assigned_at, delivered_at, currency, item_total, subtotal, delivery_fee, discount_amount, order_credit_used_amount, platform_fee, total_amount, missing_items_credit_earned, delivery_fee_credit_earned, total_compensation_credit_earned, delivery_pin, delivery_pin_generated_at, delivery_pin_verified_at, created_at, updated_at
          `,
          [resolvedOrderId],
        );
        if (pinUpdate.rowCount > 0) {
          deliveryPin = String(pinUpdate.rows[0].delivery_pin || '').trim();
          Object.assign(order, pinUpdate.rows[0]);
        }
      }

      await client.query('COMMIT');
      await bumpOrdersCacheVersion(normalizedUid);
      await publishOrderRealtimeUpdateFromRow(order);

      return {
        ok: true,
        order_id: resolvedOrderId,
        delivery_pin: deliveryPin,
        generated: deliveryPin.length > 0,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function listDriverOrders({ firebaseUid, type = 'available', cursor, limit = 20 }) {
    await ensureDriverSchemaOnce();
    const normalizedUid = String(firebaseUid || '').trim();
    const resolvedType = String(type || 'available').trim().toLowerCase();
    const cursorRaw = String(cursor || '').trim();
    const decodedCursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !decodedCursor) {
      throw new ValidationError('Invalid cursor');
    }

    const requestedLimit = clamp(parseInteger(limit, 20), 1, 100);
    let effectiveLimit = requestedLimit;
    let sortExpression = 'COALESCE(o.created_at, o.updated_at)';

    const whereParts = [];
    const params = [];
    const pushParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (resolvedType === 'assigned') {
      sortExpression = 'COALESCE(o.assigned_at, o.updated_at, o.created_at)';
      whereParts.push(`o.payment_status = 'paid'`);
      whereParts.push(`o.assigned_driver_uid = ${pushParam(normalizedUid)}`);
      whereParts.push(
        `o.status = ANY(${pushParam([
          'assigned',
          'confirmed',
          'picked',
          'packed',
          'out_for_delivery',
        ])}::text[])`,
      );
    } else if (resolvedType === 'executed') {
      sortExpression = 'COALESCE(o.delivered_at, o.updated_at, o.created_at)';
      effectiveLimit = Math.min(requestedLimit, DRIVER_EXECUTED_VISIBLE_LIMIT);
      whereParts.push(`o.assigned_driver_uid = ${pushParam(normalizedUid)}`);
      whereParts.push(`o.status = 'delivered'`);
      whereParts.push(`o.driver_executed_archived_at IS NULL`);
    } else {
      sortExpression = 'COALESCE(o.created_at, o.updated_at)';
      whereParts.push(`o.payment_status = 'paid'`);
      whereParts.push(`o.status = 'confirmed'`);
      whereParts.push(`o.assigned_driver_uid IS NULL`);
    }

    if (decodedCursor) {
      const cursorTimestampParam = pushParam(decodedCursor.createdAt);
      const cursorIdParam = pushParam(decodedCursor.id);
      whereParts.push(
        `(
          ${sortExpression} < ${cursorTimestampParam}::timestamptz
          OR (
            ${sortExpression} = ${cursorTimestampParam}::timestamptz
            AND o.id < ${cursorIdParam}::bigint
          )
        )`,
      );
    }

    const pageLimitParam = pushParam(effectiveLimit + 1);
    const result = await db.query(
      `
      WITH page_orders AS (
        SELECT
          o.id,
          o.firebase_uid,
          o.status,
          o.payment_status,
          o.currency,
          o.item_total,
          o.subtotal,
          o.delivery_fee,
          o.discount_amount,
          o.order_credit_used_amount,
          o.missing_items_credit_earned,
          o.delivery_fee_credit_earned,
          o.total_compensation_credit_earned,
          o.platform_fee,
          o.total_amount,
          o.promo_id,
          o.promo_code,
          o.fee_rule_id,
          o.fee_rule_version,
          o.delivery_address_id,
          o.delivery_address_text,
          o.delivery_address_label,
          o.delivery_lat,
          o.delivery_lng,
          o.assigned_driver_uid,
          o.assigned_driver_phone,
          o.assigned_at,
          o.delivered_at,
          o.created_at,
          ${sortExpression} AS sort_ts
        FROM orders o
        WHERE ${whereParts.join('\n          AND ')}
        ORDER BY sort_ts DESC, o.id DESC
        LIMIT ${pageLimitParam}
      )
      SELECT
        p.id,
        p.firebase_uid AS customer_firebase_uid,
        p.status,
        p.payment_status,
        p.currency,
        p.item_total,
        p.subtotal,
        p.delivery_fee,
        p.discount_amount,
        p.order_credit_used_amount,
        p.missing_items_credit_earned,
        p.delivery_fee_credit_earned,
        p.total_compensation_credit_earned,
        p.platform_fee,
        p.total_amount,
        p.promo_id,
        p.promo_code,
        p.fee_rule_id,
        p.fee_rule_version,
        NULLIF(BTRIM(u.display_name), '') AS customer_name,
        p.delivery_address_text,
        p.delivery_address_label,
        COALESCE(p.delivery_lat, ua.lat) AS delivery_lat,
        COALESCE(p.delivery_lng, ua.lng) AS delivery_lng,
        p.assigned_driver_uid,
        p.assigned_driver_phone,
        p.assigned_at,
        p.delivered_at,
        p.created_at,
        p.sort_ts,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', oi.id,
                'product_id', oi.product_id,
                'product_name', oi.product_name,
                'unit_price', oi.unit_price,
                'quantity', oi.quantity,
                'line_total', oi.line_total,
                'picked_by_driver', oi.picked_by_driver
              )
              ORDER BY oi.id
            )
            FROM order_items oi
            WHERE oi.order_id = p.id
          ),
          '[]'::json
        ) AS items
      FROM page_orders p
      LEFT JOIN user_addresses ua ON ua.id = p.delivery_address_id
      LEFT JOIN users u ON u.firebase_uid = p.firebase_uid
      ORDER BY p.sort_ts DESC, p.id DESC
      `,
      params,
    );

    const hasMore = result.rows.length > effectiveLimit;
    const visibleRows = hasMore ? result.rows.slice(0, effectiveLimit) : result.rows;
    await hydrateDriverOrderCustomerNames(visibleRows);
    const tail = visibleRows.length > 0 ? visibleRows[visibleRows.length - 1] : null;
    const nextCursor = hasMore && tail ? encodeCursor(tail.sort_ts, tail.id) : null;
    const orders = visibleRows.map((row) => {
      const { sort_ts: _sortTs, customer_firebase_uid: _customerFirebaseUid, ...rest } = row;
      return rest;
    });

    return {
      ok: true,
      orders,
      page_info: {
        limit: effectiveLimit,
        has_more: hasMore,
        next_cursor: nextCursor,
      },
    };
  }

  async function assignOrder({ orderId, firebaseUid, driverPhone }) {
    await ensureDriverSchemaOnce();
    const resolvedOrderId = parseInteger(orderId, 0);
    if (resolvedOrderId <= 0) {
      throw new ValidationError('Invalid order id');
    }

    const updated = await db.query(
      `
      UPDATE orders
      SET assigned_driver_uid = $2,
          assigned_driver_phone = $3,
          assigned_at = NOW(),
          status = 'assigned',
          updated_at = NOW()
      WHERE id = $1
        AND payment_status = 'paid'
        AND status = 'confirmed'
        AND assigned_driver_uid IS NULL
      RETURNING id, status, payment_status, assigned_driver_uid, assigned_driver_phone, assigned_at, firebase_uid
      `,
      [resolvedOrderId, firebaseUid, driverPhone || null],
    );

    if (updated.rowCount === 0) {
      throw new ConflictError('Order cannot be assigned. It may already be assigned or not ready.');
    }

    const { firebase_uid: orderFirebaseUid, ...orderPayload } = updated.rows[0];
    await bumpOrdersCacheVersion(orderFirebaseUid);
    await publishOrderRealtimeUpdateFromRow(updated.rows[0]);
    return { ok: true, order: orderPayload };
  }

  async function unassignOrder({ orderId, firebaseUid }) {
    const client = await db.connect();
    try {
      await ensureDriverSchemaOnce();
      const resolvedOrderId = parseInteger(orderId, 0);
      if (resolvedOrderId <= 0) {
        throw new ValidationError('Invalid order id');
      }

      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      const existing = await client.query(
        `
        SELECT id, status, payment_status, assigned_driver_uid, firebase_uid, delivery_pin
        FROM orders
        WHERE id = $1
        FOR UPDATE
        `,
        [resolvedOrderId],
      );

      if (existing.rowCount === 0) {
        throw new NotFoundError('Order not found');
      }

      const current = existing.rows[0];
      const currentStatus = String(current.status || '').trim().toLowerCase();
      const paymentStatus = String(current.payment_status || '').trim().toLowerCase();
      const assignedDriverUid = String(current.assigned_driver_uid || '').trim();

      if (paymentStatus !== 'paid') {
        throw new ConflictError('Order is not paid yet');
      }
      if (!assignedDriverUid) {
        throw new ConflictError('Order is not assigned');
      }
      if (assignedDriverUid !== firebaseUid) {
        throw new ForbiddenError('This order is assigned to another driver');
      }
      if (!['assigned', 'confirmed', 'packed'].includes(currentStatus)) {
        throw new ConflictError('Order cannot be unassigned after pickup has started');
      }

      const updated = await client.query(
        `
        UPDATE orders
        SET assigned_driver_uid = NULL,
            assigned_driver_phone = NULL,
            assigned_at = NULL,
            status = 'confirmed',
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, status, payment_status, assigned_driver_uid, assigned_driver_phone, assigned_at, updated_at
        `,
        [resolvedOrderId],
      );

      await client.query('COMMIT');
      await bumpOrdersCacheVersion(current.firebase_uid);
      await publishOrderRealtimeUpdateFromRow({
        ...updated.rows[0],
        firebase_uid: current.firebase_uid,
      });
      return { ok: true, order: updated.rows[0] };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {}
      if (error?.code === '55P03') {
        throw new ConflictError('Order is being updated right now. Please retry in a moment.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateOrderStatus({ orderId, nextStatus, firebaseUid, body }) {
    const client = await db.connect();
    try {
      await ensureDriverSchemaOnce();
      const resolvedOrderId = parseInteger(orderId, 0);
      if (resolvedOrderId <= 0) {
        throw new ValidationError('Invalid order id');
      }

      const resolvedNextStatus = String(nextStatus || '').trim().toLowerCase();
      if (!DRIVER_UPDATABLE_STATUSES.has(resolvedNextStatus)) {
        throw new ValidationError(
          'Invalid status. Use picked, out_for_delivery, delivered, or cancelled',
        );
      }

      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      const existing = await client.query(
        `
        SELECT
          id,
          status,
          payment_status,
          assigned_driver_uid,
          firebase_uid,
          delivery_pin,
          delivery_fee,
          total_amount,
          order_credit_used_amount
        FROM orders
        WHERE id = $1
        FOR UPDATE
        `,
        [resolvedOrderId],
      );

      if (existing.rowCount === 0) {
        throw new NotFoundError('Order not found');
      }

      const current = existing.rows[0];
      const currentStatus = String(current.status || '').trim().toLowerCase();
      const paymentStatus = String(current.payment_status || '').trim().toLowerCase();
      const assignedDriverUid = String(current.assigned_driver_uid || '').trim();
      let effectiveDeliveryPin = String(current.delivery_pin || '').trim();

      if (paymentStatus !== 'paid') {
        throw new ConflictError('Order is not paid yet');
      }
      if (!assignedDriverUid) {
        throw new ConflictError('Assign this order first');
      }
      if (assignedDriverUid !== firebaseUid) {
        throw new ForbiddenError('This order is assigned to another driver');
      }

      let validTransition = false;
      if (resolvedNextStatus === 'picked') {
        validTransition = ['assigned', 'confirmed', 'picked', 'packed'].includes(currentStatus);
      } else if (resolvedNextStatus === 'out_for_delivery') {
        validTransition = ['picked', 'out_for_delivery'].includes(currentStatus);
      } else if (resolvedNextStatus === 'delivered') {
        validTransition = ['out_for_delivery', 'delivered'].includes(currentStatus);
      } else if (resolvedNextStatus === 'cancelled') {
        validTransition = ['assigned', 'confirmed', 'packed', 'picked', 'cancelled'].includes(
          currentStatus,
        );
      }

      if (!validTransition) {
        throw new ConflictError(
          `Invalid status transition from ${currentStatus} to ${resolvedNextStatus}`,
        );
      }

      if (resolvedNextStatus !== 'cancelled' && !effectiveDeliveryPin) {
        const pinUpsert = await client.query(
          `
          UPDATE orders
          SET delivery_pin = LPAD((FLOOR(RANDOM() * 10000))::int::text, 4, '0'),
              delivery_pin_generated_at = COALESCE(delivery_pin_generated_at, NOW()),
              updated_at = NOW()
          WHERE id = $1
            AND (delivery_pin IS NULL OR BTRIM(delivery_pin) = '')
          RETURNING delivery_pin
          `,
          [resolvedOrderId],
        );
        if (pinUpsert.rowCount > 0) {
          effectiveDeliveryPin = String(pinUpsert.rows[0].delivery_pin || '').trim();
        }
      }

      if (resolvedNextStatus === 'picked' || resolvedNextStatus === 'out_for_delivery') {
        const rawPickedItemIds = body?.picked_item_ids;
        const hasExplicitPickedSelection = Array.isArray(rawPickedItemIds);
        if (resolvedNextStatus === 'picked' && !hasExplicitPickedSelection) {
          throw new ValidationError('Provide picked_item_ids as an array before marking picked');
        }
        if (typeof rawPickedItemIds !== 'undefined' && !hasExplicitPickedSelection) {
          throw new ValidationError('picked_item_ids must be an array');
        }

        const pickedItemIds = hasExplicitPickedSelection
          ? [
              ...new Set(
                rawPickedItemIds
                  .map((value) => parseInteger(value, 0))
                  .filter((value) => value > 0),
              ),
            ]
          : [];

        const orderItemsRes = await client.query(
          `
          SELECT id, line_total
          FROM order_items
          WHERE order_id = $1
          FOR UPDATE
          `,
          [resolvedOrderId],
        );
        if (orderItemsRes.rowCount === 0) {
          throw new ConflictError('No order items found');
        }

        const validIds = new Set(orderItemsRes.rows.map((row) => Number(row.id)));
        const invalidPickedId = pickedItemIds.find((id) => !validIds.has(id));
        if (invalidPickedId) {
          throw new ValidationError('Invalid picked item selection');
        }
        if (resolvedNextStatus === 'picked' && pickedItemIds.length === 0) {
          throw new ValidationError('Select at least one picked item before updating status');
        }

        if (hasExplicitPickedSelection) {
          await client.query(
            `
            UPDATE order_items
            SET picked_by_driver = CASE
                  WHEN id = ANY($2::bigint[]) THEN TRUE
                  ELSE FALSE
                END,
                picked_marked_at = NOW()
            WHERE order_id = $1
            `,
            [resolvedOrderId, pickedItemIds],
          );
        } else if (resolvedNextStatus === 'out_for_delivery') {
          await client.query(
            `
            UPDATE order_items
            SET picked_by_driver = COALESCE(picked_by_driver, FALSE),
                picked_marked_at = COALESCE(picked_marked_at, NOW())
            WHERE order_id = $1
            `,
            [resolvedOrderId],
          );
        }
      }

      let walletSnapshotNeeded = false;

      if (resolvedNextStatus === 'cancelled' && currentStatus !== 'cancelled') {
        const orderItemsRes = await client.query(
          `
          SELECT id, line_total, picked_by_driver
          FROM order_items
          WHERE order_id = $1
          FOR UPDATE
          `,
          [resolvedOrderId],
        );
        if (orderItemsRes.rowCount === 0) {
          throw new ConflictError('No order items found');
        }
        const anyPickedItems = orderItemsRes.rows.some(
          (row) => row.picked_by_driver === true,
        );
        if (anyPickedItems) {
          throw new ConflictError(
            'Some items are already marked as picked. Use normal delivery flow.',
          );
        }

        await client.query(
          `
          UPDATE order_items
          SET picked_by_driver = FALSE,
              picked_marked_at = NOW()
          WHERE order_id = $1
          `,
          [resolvedOrderId],
        );

        const missingItemsCents = orderItemsRes.rows.reduce((sum, row) => {
          return sum + toCents(row.line_total);
        }, 0);
        const deliveryFeeCents = toCents(current.delivery_fee);
        const maxRefundableCents =
          toCents(current.total_amount) + toCents(current.order_credit_used_amount);
        const candidateCompensationCents = missingItemsCents + deliveryFeeCents;
        const compensationCents = Math.min(candidateCompensationCents, maxRefundableCents);
        const itemCompensationCents = Math.min(missingItemsCents, compensationCents);
        const deliveryFeeCompensationCents = Math.max(
          0,
          Math.min(deliveryFeeCents, compensationCents - itemCompensationCents),
        );
        const compensationAmount = centsToAmount(compensationCents);
        const itemCompensationAmount = centsToAmount(itemCompensationCents);
        const deliveryFeeCompensationAmount = centsToAmount(deliveryFeeCompensationCents);

        if (compensationAmount > 0) {
          const resolvedUserId = await resolveUserIdFromIdentity(
            client,
            String(current.firebase_uid || '').trim(),
          );
          if (!resolvedUserId) {
            throw new ConflictError('Unable to credit customer wallet for this order');
          }
          const creditInsert = await client.query(
            `
            INSERT INTO order_credit_transactions (user_id, type, amount, order_id, source, created_at)
            VALUES ($1, 'earned', $2, $3, 'out_of_stock_cancelled', NOW())
            ON CONFLICT (order_id, source, type) DO NOTHING
            `,
            [resolvedUserId, compensationAmount, resolvedOrderId],
          );
          if (creditInsert.rowCount > 0) {
            walletSnapshotNeeded = true;
          }
        }

        await client.query(
          `
          UPDATE orders
          SET missing_items_credit_earned = $2::numeric,
              delivery_fee_credit_earned = $3::numeric,
              total_compensation_credit_earned = $4::numeric,
              updated_at = NOW()
          WHERE id = $1
          `,
          [
            resolvedOrderId,
            itemCompensationAmount,
            deliveryFeeCompensationAmount,
            compensationAmount,
          ],
        );
      }

      let sanitizedDeliveryPin = '';
      if (resolvedNextStatus === 'delivered' && currentStatus !== 'delivered') {
        const providedDeliveryPin = String(body?.delivery_pin || '')
          .trim()
          .replace(/\s+/g, '');
        if (!/^\d{4}$/.test(providedDeliveryPin)) {
          throw new ValidationError('Enter a valid 4-digit delivery PIN');
        }
        const expectedDeliveryPin = effectiveDeliveryPin;
        if (!expectedDeliveryPin) {
          throw new ConflictError(
            'Delivery PIN unavailable. Move to Out for Delivery once to generate it, then retry.',
          );
        }
        if (providedDeliveryPin !== expectedDeliveryPin) {
          throw new ConflictError('Incorrect delivery PIN');
        }
        sanitizedDeliveryPin = providedDeliveryPin;
      }

      if (resolvedNextStatus === 'delivered' && currentStatus !== 'delivered') {
        const orderItemsRes = await client.query(
          `
          SELECT id, line_total, picked_by_driver
          FROM order_items
          WHERE order_id = $1
          FOR UPDATE
          `,
          [resolvedOrderId],
        );
        const pickedItemsCount = orderItemsRes.rows.reduce((count, row) => {
          return row.picked_by_driver === true ? count + 1 : count;
        }, 0);
        if (pickedItemsCount === 0) {
          throw new ConflictError(
            'No items were marked picked. Cancel this order as unavailable instead of delivering.',
          );
        }
        const missingItemsCents = orderItemsRes.rows.reduce((sum, row) => {
          if (row.picked_by_driver === true) return sum;
          return sum + toCents(row.line_total);
        }, 0);
        const deliveryFeeCents = 0;
        const maxRefundableCents =
          toCents(current.total_amount) + toCents(current.order_credit_used_amount);
        const candidateCompensationCents = missingItemsCents + deliveryFeeCents;
        const compensationCents = Math.min(candidateCompensationCents, maxRefundableCents);
        const itemCompensationCents = Math.min(missingItemsCents, compensationCents);
        const deliveryFeeCompensationCents = Math.max(
          0,
          Math.min(deliveryFeeCents, compensationCents - itemCompensationCents),
        );
        const compensationAmount = centsToAmount(compensationCents);
        const itemCompensationAmount = centsToAmount(itemCompensationCents);
        const deliveryFeeCompensationAmount = centsToAmount(deliveryFeeCompensationCents);

        if (compensationAmount > 0) {
          const resolvedUserId = await resolveUserIdFromIdentity(
            client,
            String(current.firebase_uid || '').trim(),
          );
          if (!resolvedUserId) {
            throw new ConflictError('Unable to credit customer wallet for this order');
          }
          const creditInsert = await client.query(
            `
            INSERT INTO order_credit_transactions (user_id, type, amount, order_id, source, created_at)
            VALUES ($1, 'earned', $2, $3, 'missing_items_compensation', NOW())
            ON CONFLICT (order_id, source, type) DO NOTHING
            `,
            [resolvedUserId, compensationAmount, resolvedOrderId],
          );
          if (creditInsert.rowCount > 0) {
            walletSnapshotNeeded = true;
          }
        }
        await client.query(
          `
          UPDATE orders
          SET missing_items_credit_earned = $2::numeric,
              delivery_fee_credit_earned = $3::numeric,
              total_compensation_credit_earned = $4::numeric,
              updated_at = NOW()
          WHERE id = $1
          `,
          [
            resolvedOrderId,
            itemCompensationAmount,
            deliveryFeeCompensationAmount,
            compensationAmount,
          ],
        );
      }

      const updated = await client.query(
        `
        UPDATE orders
        SET status = $2::text,
            cancellation_reason = CASE
              WHEN $2::text = 'cancelled' AND $4::boolean = TRUE THEN 'unavailable_by_driver'
              ELSE cancellation_reason
            END,
            delivered_at = CASE WHEN $2::text = 'delivered' THEN NOW() ELSE delivered_at END,
            delivery_pin_verified_at = CASE
              WHEN $2::text = 'delivered' AND $3::text <> '' THEN NOW()
              ELSE delivery_pin_verified_at
            END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, status, payment_status, assigned_driver_uid, assigned_at, delivered_at, missing_items_credit_earned, delivery_fee_credit_earned, total_compensation_credit_earned, delivery_pin, delivery_pin_generated_at, delivery_pin_verified_at, updated_at
        `,
        [
          resolvedOrderId,
          resolvedNextStatus,
          sanitizedDeliveryPin,
          resolvedNextStatus === 'cancelled',
        ],
      );

      await client.query('COMMIT');
      try {
        await bumpOrdersCacheVersion(current.firebase_uid);
      } catch (cacheError) {
        logger.warn?.(
          `Orders cache bump failed for ${current.firebase_uid}: ${cacheError.message}`,
        );
      }
      try {
        await publishOrderRealtimeUpdateFromRow({
          ...updated.rows[0],
          firebase_uid: current.firebase_uid,
        });
      } catch (realtimeError) {
        logger.warn?.(
          `Order realtime publish failed for ${current.firebase_uid}: ${realtimeError.message}`,
        );
      }
      if (walletSnapshotNeeded && typeof publishUserRealtimeWalletSnapshot === 'function') {
        try {
          await publishUserRealtimeWalletSnapshot(db.pool, current.firebase_uid);
        } catch (walletError) {
          logger.warn?.(
            `Wallet realtime publish failed for ${current.firebase_uid}: ${walletError.message}`,
          );
        }
      }
      if (resolvedNextStatus === 'delivered') {
        try {
          await archiveDeliveredOrdersForDriver(firebaseUid, DRIVER_EXECUTED_VISIBLE_LIMIT);
        } catch (archiveError) {
          logger.warn?.(
            `Driver executed flag sync failed for ${firebaseUid}: ${archiveError.message}`,
          );
        }
      }
      return { ok: true, order: updated.rows[0] };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {}
      if (error?.code === '55P03') {
        throw new ConflictError('Order is being updated right now. Please retry in a moment.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    listCustomerOrders,
    generateDeliveryPin,
    listDriverOrders,
    assignOrder,
    unassignOrder,
    updateOrderStatus,
  };
}

module.exports = {
  createDriverOrdersService,
};
