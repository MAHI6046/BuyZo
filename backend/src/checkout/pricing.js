function createPricingUtils({
  resolveUserIdFromIdentity,
  normalizePromoCode,
  normalizeDeliveryFeeSlabRow,
  coerceFeeType,
  roundCurrencyAmount,
  parseSqlTimeOrNull,
  timeInWindow,
  toTimeSegments,
  segmentsOverlap,
  amountRangesOverlap,
  optionalDimensionOverlaps,
}) {
  async function getActivePlatformFeeRule(client) {
    const result = await client.query(
      `
      SELECT
        id,
        name,
        platform_fee_type,
        platform_fee_value,
        min_platform_fee,
        max_platform_fee,
        feature_flag_key,
        feature_flag_enabled,
        version,
        is_active
      FROM fee_rules
      WHERE is_active = TRUE
        AND feature_flag_enabled = TRUE
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      `,
    );
    if (result.rowCount === 0) return null;
    return result.rows[0];
  }

  function calculatePlatformFee(subtotal, rule) {
    const safeSubtotal = roundCurrencyAmount(subtotal);
    if (!rule) {
      return {
        platformFee: 0,
        feeRuleId: null,
        feeRuleVersion: null,
      };
    }

    const feeType = coerceFeeType(rule.platform_fee_type);
    const rawValue = Number(rule.platform_fee_value);
    const feeValue = Number.isFinite(rawValue) ? rawValue : 0;
    const minFee = Math.max(0, Number(rule.min_platform_fee) || 0);
    const maxFeeRaw = Number(rule.max_platform_fee);
    const maxFee = Number.isFinite(maxFeeRaw) && maxFeeRaw >= 0 ? maxFeeRaw : null;

    let computed = feeType === 'flat' ? feeValue : safeSubtotal * feeValue;
    computed = Math.max(minFee, computed);
    if (maxFee !== null) computed = Math.min(maxFee, computed);

    return {
      platformFee: roundCurrencyAmount(Math.max(0, computed)),
      feeRuleId: Number(rule.id) || null,
      feeRuleVersion: Number(rule.version) || null,
    };
  }

  async function getDeliveryCreditBalance(client, userId) {
    const parsed = Number(userId);
    if (!Number.isInteger(parsed) || parsed <= 0) return 0;
    const cachedBalanceRes = await client.query(
      `
      SELECT delivery_credits_balance
      FROM user_wallet_balances
      WHERE user_id = $1
      LIMIT 1
      `,
      [parsed],
    );
    if (cachedBalanceRes.rowCount > 0) {
      return Math.max(0, Number(cachedBalanceRes.rows[0]?.delivery_credits_balance || 0));
    }
    const result = await client.query(
      `
      SELECT COALESCE(SUM(credits), 0)::int AS balance
      FROM delivery_credit_transactions
      WHERE user_id = $1
      `,
      [parsed],
    );
    return Math.max(0, Number(result.rows[0]?.balance || 0));
  }

  async function getOrderCreditBalance(client, userId) {
    const parsed = Number(userId);
    if (!Number.isInteger(parsed) || parsed <= 0) return 0;
    const cachedBalanceRes = await client.query(
      `
      SELECT order_credits_balance
      FROM user_wallet_balances
      WHERE user_id = $1
      LIMIT 1
      `,
      [parsed],
    );
    if (cachedBalanceRes.rowCount > 0) {
      return Math.max(0, roundCurrencyAmount(Number(cachedBalanceRes.rows[0]?.order_credits_balance || 0)));
    }
    const result = await client.query(
      `
      SELECT COALESCE(SUM(
        CASE
          WHEN type = 'earned' THEN amount
          WHEN type = 'used' THEN -amount
          ELSE 0
        END
      ), 0)::numeric AS balance
      FROM order_credit_transactions
      WHERE user_id = $1
      `,
      [parsed],
    );
    return Math.max(0, roundCurrencyAmount(Number(result.rows[0]?.balance || 0)));
  }

  async function getPendingOrderCreditReservationAmount(
    client,
    userId,
    { excludeOrderId = null } = {},
  ) {
    const parsedUserId = Number(userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) return 0;
    const parsedExcludeOrderId = Number(excludeOrderId);
    const result = await client.query(
      `
      SELECT COALESCE(SUM(amount), 0)::numeric AS reserved_amount
      FROM order_credit_reservations
      WHERE user_id = $1
        AND status = 'pending'
        AND expires_at > NOW()
        AND ($2::bigint IS NULL OR order_id <> $2::bigint)
      `,
      [
        parsedUserId,
        Number.isInteger(parsedExcludeOrderId) && parsedExcludeOrderId > 0
          ? parsedExcludeOrderId
          : null,
      ],
    );
    return Math.max(0, roundCurrencyAmount(Number(result.rows[0]?.reserved_amount || 0)));
  }

  async function getAvailableOrderCreditBalance(client, userId, { excludeOrderId = null } = {}) {
    const totalBalance = await getOrderCreditBalance(client, userId);
    if (totalBalance <= 0) return 0;
    const reservedAmount = await getPendingOrderCreditReservationAmount(client, userId, {
      excludeOrderId,
    });
    return Math.max(0, roundCurrencyAmount(totalBalance - reservedAmount));
  }

  function isPromoWithinDateWindow(promo, now = new Date()) {
    const startDate = promo.start_date ? new Date(promo.start_date) : null;
    const endDate = promo.end_date ? new Date(promo.end_date) : null;
    if (startDate && now < startDate) return false;
    if (endDate && now > endDate) return false;
    return true;
  }

  async function findPromoByCode(client, code) {
    const normalizedCode = normalizePromoCode(code);
    if (!normalizedCode) return null;
    const result = await client.query(
      `
      SELECT
        id,
        code,
        discount_type,
        discount_value,
        max_discount,
        min_order_amount,
        usage_limit,
        used_count,
        per_user_limit,
        city,
        user_type,
        start_date,
        end_date,
        active
      FROM promo_codes
      WHERE UPPER(code) = $1
      LIMIT 1
      `,
      [normalizedCode],
    );
    return result.rows[0] || null;
  }

  async function computePromoDiscount({
    client,
    code,
    userId,
    orderAmount,
    city = null,
    userType = null,
  }) {
    const normalizedCode = normalizePromoCode(code);
    if (!normalizedCode) {
      return {
        promo: null,
        promoCode: null,
        discountAmount: 0,
      };
    }

    const promo = await findPromoByCode(client, normalizedCode);
    if (!promo || promo.active !== true) {
      throw new Error('Invalid promo');
    }
    if (!isPromoWithinDateWindow(promo)) {
      throw new Error('Expired promo');
    }

    const normalizedPromoCity = promo.city ? String(promo.city).trim().toLowerCase() : null;
    const normalizedCity = city ? String(city).trim().toLowerCase() : null;
    if (normalizedPromoCity && normalizedPromoCity !== normalizedCity) {
      throw new Error('Promo not valid for this city');
    }

    const normalizedPromoUserType = promo.user_type
      ? String(promo.user_type).trim().toLowerCase()
      : null;
    const normalizedUserType = userType ? String(userType).trim().toLowerCase() : null;
    if (normalizedPromoUserType && normalizedPromoUserType !== normalizedUserType) {
      throw new Error('Promo not valid for this user');
    }

    const safeOrderAmount = Math.max(0, roundCurrencyAmount(orderAmount));
    const minOrderAmount = Math.max(0, Number(promo.min_order_amount) || 0);
    if (safeOrderAmount < minOrderAmount) {
      throw new Error('Minimum order not met');
    }

    const usageLimit = Number(promo.usage_limit);
    const usedCount = Number(promo.used_count || 0);
    if (Number.isFinite(usageLimit) && usageLimit > 0 && usedCount >= usageLimit) {
      throw new Error('Promo limit reached');
    }

    const perUserLimit = Math.max(0, Number(promo.per_user_limit || 1));
    if (perUserLimit > 0 && userId) {
      const usageRes = await client.query(
        `
        SELECT COUNT(*)::int AS used_count
        FROM promo_usages
        WHERE promo_id = $1
          AND user_id = $2
        `,
        [promo.id, userId],
      );
      const userUsedCount = Number(usageRes.rows[0]?.used_count || 0);
      if (userUsedCount >= perUserLimit) {
        throw new Error('Already used');
      }
    }

    let discount = 0;
    const discountValue = Math.max(0, Number(promo.discount_value) || 0);
    const discountType = String(promo.discount_type || '').trim().toLowerCase();
    if (discountType === 'percentage') {
      discount = safeOrderAmount * (discountValue / 100);
      const maxDiscount = Number(promo.max_discount);
      if (Number.isFinite(maxDiscount) && maxDiscount >= 0) {
        discount = Math.min(discount, maxDiscount);
      }
    } else if (discountType === 'flat') {
      discount = discountValue;
    }

    discount = Math.min(safeOrderAmount, Math.max(0, roundCurrencyAmount(discount)));

    return {
      promo,
      promoCode: normalizedCode,
      discountAmount: discount,
    };
  }

  async function calculateDeliveryFee(client, { orderAmount, city = null, userType = null }) {
    const safeOrderAmount = Math.max(0, roundCurrencyAmount(orderAmount));
    const normalizedCity = city ? String(city).trim().toLowerCase() : null;
    const normalizedUserType = userType ? String(userType).trim().toLowerCase() : null;

    const slabsRes = await client.query(
      `
      SELECT
        id,
        city,
        start_time,
        end_time,
        user_type,
        min_order_amount,
        max_order_amount,
        delivery_fee,
        active
      FROM delivery_fee_slabs
      WHERE active = TRUE
        AND $1::numeric BETWEEN min_order_amount AND max_order_amount
      ORDER BY min_order_amount DESC, updated_at DESC, id DESC
      `,
      [safeOrderAmount],
    );

    const now = new Date();
    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    let selected = null;
    for (const row of slabsRes.rows) {
      const slab = normalizeDeliveryFeeSlabRow(row);
      if (!slab) continue;

      if (slab.city && normalizedCity && slab.city.toLowerCase() !== normalizedCity) {
        continue;
      }
      if (slab.city && !normalizedCity) continue;

      if (slab.user_type && normalizedUserType && slab.user_type !== normalizedUserType) {
        continue;
      }
      if (slab.user_type && !normalizedUserType) continue;

      const start = parseSqlTimeOrNull(slab.start_time);
      const end = parseSqlTimeOrNull(slab.end_time);
      const startSeconds = start ? start.hh * 3600 + start.mm * 60 + start.ss : null;
      const endSeconds = end ? end.hh * 3600 + end.mm * 60 + end.ss : null;
      if (!timeInWindow({ nowSeconds, startSeconds, endSeconds })) {
        continue;
      }

      selected = slab;
      break;
    }

    if (!selected) {
      const fallback = await client.query(
        `
        SELECT
          id,
          city,
          start_time,
          end_time,
          user_type,
          min_order_amount,
          max_order_amount,
          delivery_fee,
          active
        FROM delivery_fee_slabs
        WHERE active = TRUE
        ORDER BY min_order_amount ASC, updated_at DESC, id DESC
        LIMIT 1
        `,
      );
      selected = normalizeDeliveryFeeSlabRow(fallback.rows[0] || null);
    }

    return {
      deliveryFee: selected ? selected.delivery_fee : 0,
      deliveryFeeSlabId: selected ? selected.id : null,
    };
  }

  async function calculatePricingBreakdown({
    client,
    userId,
    orderId = null,
    itemTotal,
    city = null,
    userType = null,
    promoCode = null,
  }) {
    const safeItemTotal = Math.max(0, roundCurrencyAmount(itemTotal));
    const deliveryFeeCalculation = await calculateDeliveryFee(client, {
      orderAmount: safeItemTotal,
      city,
      userType,
    });
    const baseDeliveryFee = deliveryFeeCalculation.deliveryFee;
    let deliveryFee = baseDeliveryFee;
    let deliveryFeeWaived = false;
    let deliveryCreditUsed = false;

    const resolvedUserId = await resolveUserIdFromIdentity(client, userId);
    if (resolvedUserId && baseDeliveryFee > 0) {
      const creditBalance = await getDeliveryCreditBalance(client, resolvedUserId);
      if (creditBalance > 0) {
        deliveryFee = 0;
        deliveryFeeWaived = true;
        deliveryCreditUsed = true;
      }
    }

    const activeFeeRule = await getActivePlatformFeeRule(client);
    const feeCalculation = calculatePlatformFee(safeItemTotal, activeFeeRule);
    const platformFee = feeCalculation.platformFee;
    const grossTotal = roundCurrencyAmount(safeItemTotal + deliveryFee + platformFee);

    const promoCalculation = await computePromoDiscount({
      client,
      code: promoCode,
      userId,
      orderAmount: safeItemTotal,
      city,
      userType,
    });

    const discountAmount = promoCalculation.discountAmount;
    const totalBeforeCredits = roundCurrencyAmount(Math.max(0, grossTotal - discountAmount));
    let orderCreditUsedAmount = 0;
    if (resolvedUserId && totalBeforeCredits > 0) {
      const orderCreditBalance = await getAvailableOrderCreditBalance(client, resolvedUserId, {
        excludeOrderId: orderId,
      });
      if (orderCreditBalance > 0) {
        orderCreditUsedAmount = roundCurrencyAmount(
          Math.min(orderCreditBalance, totalBeforeCredits),
        );
      }
    }
    const totalAmount = roundCurrencyAmount(
      Math.max(0, totalBeforeCredits - orderCreditUsedAmount),
    );

    return {
      itemTotal: safeItemTotal,
      subtotal: safeItemTotal,
      deliveryFee,
      platformFee,
      discountAmount,
      orderCreditUsedAmount,
      totalAmount,
      deliveryFeeSlabId: deliveryFeeCalculation.deliveryFeeSlabId,
      deliveryFeeWaived,
      deliveryCreditUsed,
      feeRuleId: feeCalculation.feeRuleId,
      feeRuleVersion: feeCalculation.feeRuleVersion,
      promoId: promoCalculation.promo ? promoCalculation.promo.id : null,
      promoCode: promoCalculation.promoCode,
    };
  }

  async function assertNoActiveDeliverySlabOverlap(
    client,
    {
      slabId = null,
      city = null,
      userType = null,
      startTime = null,
      endTime = null,
      minOrderAmount,
      maxOrderAmount,
    },
  ) {
    const rows = await client.query(
      `
      SELECT
        id,
        city,
        start_time,
        end_time,
        user_type,
        min_order_amount,
        max_order_amount
      FROM delivery_fee_slabs
      WHERE active = TRUE
        AND ($1::bigint IS NULL OR id <> $1::bigint)
        AND max_order_amount >= $2
        AND min_order_amount <= $3
        AND (city IS NULL OR $4::text IS NULL OR LOWER(city) = LOWER($4::text))
        AND (user_type IS NULL OR $5::text IS NULL OR LOWER(user_type) = LOWER($5::text))
      `,
      [slabId, minOrderAmount, maxOrderAmount, city, userType],
    );

    const incomingSegments = toTimeSegments(startTime, endTime);
    for (const row of rows.rows) {
      const existing = normalizeDeliveryFeeSlabRow(row);
      if (!existing) continue;

      if (
        !optionalDimensionOverlaps(existing.city, city) ||
        !optionalDimensionOverlaps(existing.user_type, userType)
      ) {
        continue;
      }
      if (
        !amountRangesOverlap(
          Number(existing.min_order_amount),
          Number(existing.max_order_amount),
          minOrderAmount,
          maxOrderAmount,
        )
      ) {
        continue;
      }

      const existingSegments = toTimeSegments(existing.start_time, existing.end_time);
      if (!segmentsOverlap(existingSegments, incomingSegments)) {
        continue;
      }

      throw new Error(
        `Overlapping active slab exists (id=${existing.id}) for the same city/user_type/time window and order amount range`,
      );
    }
  }

  return {
    getActivePlatformFeeRule,
    calculatePlatformFee,
    getDeliveryCreditBalance,
    getOrderCreditBalance,
    getPendingOrderCreditReservationAmount,
    getAvailableOrderCreditBalance,
    isPromoWithinDateWindow,
    findPromoByCode,
    computePromoDiscount,
    calculateDeliveryFee,
    calculatePricingBreakdown,
    assertNoActiveDeliverySlabOverlap,
  };
}

module.exports = { createPricingUtils };
