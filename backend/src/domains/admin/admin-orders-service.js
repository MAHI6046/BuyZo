const {
  ValidationError,
  ConflictError,
  NotFoundError,
} = require('../../errors');

function normalizeOptionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeOptionalTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;
  const hh = match[1];
  const mm = match[2];
  const ss = match[3] || '00';
  return `${hh}:${mm}:${ss}`;
}

function createAdminOrdersService({
  ...serviceContext
}) {
  const { db, logger } = serviceContext;
  const {
    ensurePricingSchema,
    normalizeFeeRuleRow,
    coerceFeeType,
    parseNullableNumber,
    roundCurrencyAmount,
    normalizeDeliveryFeeSlabRow,
    assertNoActiveDeliverySlabOverlap,
    normalizePromoRow,
    normalizePromoCodeForStorage,
    coercePromoDiscountType,
    parseOptionalTimestamp,
    publishUserRealtimeWalletSnapshot,
    bumpOrdersCacheVersion,
  } = serviceContext;

  const normalizeAdjustmentDirection = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'credit') return 'credit';
    if (normalized === 'debit') return 'debit';
    return null;
  };

  async function listFeeRules() {
    await ensurePricingSchema();
    const result = await db.query(
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
        is_active,
        metadata,
        created_at,
        updated_at
      FROM fee_rules
      ORDER BY updated_at DESC, id DESC
      LIMIT 100
      `,
    );

    return {
      ok: true,
      fee_rules: result.rows.map(normalizeFeeRuleRow),
      current: normalizeFeeRuleRow(result.rows.find((row) => row.is_active === true) || null),
    };
  }

  async function upsertCurrentFeeRule(body = {}) {
    await ensurePricingSchema();
    const feeType = coerceFeeType(body.platform_fee_type);
    const rawFeeValue = Number(body.platform_fee_value);
    const feeValue = Number.isFinite(rawFeeValue) ? rawFeeValue : 0;
    const minPlatformFee = Math.max(0, Number(body.min_platform_fee) || 0);
    const maxPlatformFeeCandidate = parseNullableNumber(body.max_platform_fee);
    const maxPlatformFee =
      maxPlatformFeeCandidate !== null && maxPlatformFeeCandidate >= 0
        ? maxPlatformFeeCandidate
        : null;
    const featureFlagEnabled = body.feature_flag_enabled !== false;
    const isActive = body.is_active !== false;
    const featureFlagKey =
      String(body.feature_flag_key || 'platform_fee_enabled').trim() || 'platform_fee_enabled';
    const metadata =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : {};
    const name =
      String(body.name || '').trim() ||
      (feeType === 'flat' ? 'Platform Fee (Flat)' : 'Platform Fee (Percentage)');

    if (feeType === 'percentage' && (feeValue < 0 || feeValue > 1)) {
      throw new ValidationError('platform_fee_value for percentage must be between 0 and 1');
    }
    if (feeType === 'flat' && feeValue < 0) {
      throw new ValidationError('platform_fee_value for flat fee must be >= 0');
    }
    if (maxPlatformFee !== null && maxPlatformFee < minPlatformFee) {
      throw new ValidationError('max_platform_fee must be >= min_platform_fee');
    }

    const currentResult = await db.query(
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
        is_active,
        metadata,
        created_at,
        updated_at
      FROM fee_rules
      WHERE is_active = TRUE
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      `,
    );

    let updatedRow;
    if (currentResult.rowCount === 0) {
      const inserted = await db.query(
        `
        INSERT INTO fee_rules (
          name,
          platform_fee_type,
          platform_fee_value,
          min_platform_fee,
          max_platform_fee,
          feature_flag_key,
          feature_flag_enabled,
          version,
          is_active,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9::jsonb)
        RETURNING
          id,
          name,
          platform_fee_type,
          platform_fee_value,
          min_platform_fee,
          max_platform_fee,
          feature_flag_key,
          feature_flag_enabled,
          version,
          is_active,
          metadata,
          created_at,
          updated_at
        `,
        [
          name,
          feeType,
          feeValue,
          roundCurrencyAmount(minPlatformFee),
          maxPlatformFee === null ? null : roundCurrencyAmount(maxPlatformFee),
          featureFlagKey,
          featureFlagEnabled,
          isActive,
          JSON.stringify(metadata),
        ],
      );
      updatedRow = inserted.rows[0];
    } else {
      const current = currentResult.rows[0];
      const updated = await db.query(
        `
        UPDATE fee_rules
        SET name = $2,
            platform_fee_type = $3,
            platform_fee_value = $4,
            min_platform_fee = $5,
            max_platform_fee = $6,
            feature_flag_key = $7,
            feature_flag_enabled = $8,
            is_active = $9,
            metadata = $10::jsonb,
            version = version + 1,
            updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          name,
          platform_fee_type,
          platform_fee_value,
          min_platform_fee,
          max_platform_fee,
          feature_flag_key,
          feature_flag_enabled,
          version,
          is_active,
          metadata,
          created_at,
          updated_at
        `,
        [
          Number(current.id),
          name,
          feeType,
          feeValue,
          roundCurrencyAmount(minPlatformFee),
          maxPlatformFee === null ? null : roundCurrencyAmount(maxPlatformFee),
          featureFlagKey,
          featureFlagEnabled,
          isActive,
          JSON.stringify(metadata),
        ],
      );
      updatedRow = updated.rows[0];
    }

    return {
      ok: true,
      fee_rule: normalizeFeeRuleRow(updatedRow),
    };
  }

  async function listDeliveryFeeSlabs() {
    await ensurePricingSchema();
    const result = await db.query(
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
        active,
        created_at,
        updated_at
      FROM delivery_fee_slabs
      ORDER BY min_order_amount ASC, max_order_amount ASC, id ASC
      `,
    );

    return {
      ok: true,
      slabs: result.rows.map(normalizeDeliveryFeeSlabRow),
    };
  }

  async function createDeliveryFeeSlab(body = {}) {
    await ensurePricingSchema();
    const minOrderAmount = Math.max(0, roundCurrencyAmount(Number(body.min_order_amount) || 0));
    const maxOrderAmount = Math.max(0, roundCurrencyAmount(Number(body.max_order_amount) || 0));
    const deliveryFee = Math.max(0, roundCurrencyAmount(Number(body.delivery_fee) || 0));
    const active = body.active !== false;
    const city = normalizeOptionalText(body.city);
    const userType = normalizeOptionalText(body.user_type)?.toLowerCase() || null;
    const startTime = normalizeOptionalTime(body.start_time);
    const endTime = normalizeOptionalTime(body.end_time);

    if (maxOrderAmount < minOrderAmount) {
      throw new ValidationError('max_order_amount must be >= min_order_amount');
    }
    if ((body.start_time && !startTime) || (body.end_time && !endTime)) {
      throw new ValidationError('start_time and end_time must be in HH:MM or HH:MM:SS format');
    }
    if ((startTime && !endTime) || (!startTime && endTime)) {
      throw new ValidationError('Provide both start_time and end_time, or leave both empty');
    }

    if (active) {
      try {
        await assertNoActiveDeliverySlabOverlap(db.pool, {
          city,
          userType,
          startTime,
          endTime,
          minOrderAmount,
          maxOrderAmount,
        });
      } catch (error) {
        throw new ConflictError(error.message || 'Overlapping active delivery fee slab exists');
      }
    }

    const inserted = await db.query(
      `
      INSERT INTO delivery_fee_slabs (
        city,
        start_time,
        end_time,
        user_type,
        min_order_amount,
        max_order_amount,
        delivery_fee,
        active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING
        id,
        city,
        start_time,
        end_time,
        user_type,
        min_order_amount,
        max_order_amount,
        delivery_fee,
        active,
        created_at,
        updated_at
      `,
      [city, startTime, endTime, userType, minOrderAmount, maxOrderAmount, deliveryFee, active],
    );

    return {
      ok: true,
      slab: normalizeDeliveryFeeSlabRow(inserted.rows[0]),
    };
  }

  async function updateDeliveryFeeSlab(rawSlabId, body = {}) {
    await ensurePricingSchema();
    const slabId = Number(rawSlabId);
    if (!Number.isFinite(slabId) || slabId <= 0) {
      throw new ValidationError('Invalid slab id');
    }

    const minOrderAmount = Math.max(0, roundCurrencyAmount(Number(body.min_order_amount) || 0));
    const maxOrderAmount = Math.max(0, roundCurrencyAmount(Number(body.max_order_amount) || 0));
    const deliveryFee = Math.max(0, roundCurrencyAmount(Number(body.delivery_fee) || 0));
    const active = body.active !== false;
    const city = normalizeOptionalText(body.city);
    const userType = normalizeOptionalText(body.user_type)?.toLowerCase() || null;
    const startTime = normalizeOptionalTime(body.start_time);
    const endTime = normalizeOptionalTime(body.end_time);

    if (maxOrderAmount < minOrderAmount) {
      throw new ValidationError('max_order_amount must be >= min_order_amount');
    }
    if ((body.start_time && !startTime) || (body.end_time && !endTime)) {
      throw new ValidationError('start_time and end_time must be in HH:MM or HH:MM:SS format');
    }
    if ((startTime && !endTime) || (!startTime && endTime)) {
      throw new ValidationError('Provide both start_time and end_time, or leave both empty');
    }

    if (active) {
      try {
        await assertNoActiveDeliverySlabOverlap(db.pool, {
          slabId,
          city,
          userType,
          startTime,
          endTime,
          minOrderAmount,
          maxOrderAmount,
        });
      } catch (error) {
        throw new ConflictError(error.message || 'Overlapping active delivery fee slab exists');
      }
    }

    const updated = await db.query(
      `
      UPDATE delivery_fee_slabs
      SET city = $2,
          start_time = $3,
          end_time = $4,
          user_type = $5,
          min_order_amount = $6,
          max_order_amount = $7,
          delivery_fee = $8,
          active = $9,
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        city,
        start_time,
        end_time,
        user_type,
        min_order_amount,
        max_order_amount,
        delivery_fee,
        active,
        created_at,
        updated_at
      `,
      [slabId, city, startTime, endTime, userType, minOrderAmount, maxOrderAmount, deliveryFee, active],
    );

    if (updated.rowCount === 0) {
      throw new NotFoundError('Delivery fee slab not found');
    }

    return {
      ok: true,
      slab: normalizeDeliveryFeeSlabRow(updated.rows[0]),
    };
  }

  async function listPromos() {
    await ensurePricingSchema();
    const result = await db.query(
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
        active,
        created_at,
        updated_at
      FROM promo_codes
      ORDER BY created_at DESC, id DESC
      LIMIT 500
      `,
    );

    return {
      ok: true,
      promos: result.rows.map(normalizePromoRow),
    };
  }

  async function createPromo(body = {}) {
    await ensurePricingSchema();

    const code = normalizePromoCodeForStorage(body.code);
    const discountType = coercePromoDiscountType(body.discount_type);
    const discountValue = Math.max(0, roundCurrencyAmount(Number(body.discount_value) || 0));
    const maxDiscountRaw = parseNullableNumber(body.max_discount);
    const maxDiscount =
      maxDiscountRaw !== null && maxDiscountRaw >= 0 ? roundCurrencyAmount(maxDiscountRaw) : null;
    const minOrderAmountRaw = parseNullableNumber(body.min_order_amount);
    const minOrderAmount =
      minOrderAmountRaw !== null && minOrderAmountRaw >= 0
        ? roundCurrencyAmount(minOrderAmountRaw)
        : 0;
    const usageLimitRaw = parseNullableNumber(body.usage_limit);
    const usageLimit = usageLimitRaw !== null && usageLimitRaw > 0 ? Math.trunc(usageLimitRaw) : null;
    const perUserLimit = Math.max(0, Math.trunc(Number(body.per_user_limit) || 1));
    const city = normalizeOptionalText(body.city);
    const userType = normalizeOptionalText(body.user_type)?.toLowerCase() || null;
    const startDate = parseOptionalTimestamp(body.start_date);
    const endDate = parseOptionalTimestamp(body.end_date);
    const active = body.active !== false;

    if (!code) throw new ValidationError('code is required');
    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
      throw new ValidationError('discount_value for percentage must be > 0 and <= 100');
    }
    if (discountType === 'flat' && discountValue <= 0) {
      throw new ValidationError('discount_value for flat must be > 0');
    }
    if ((body.start_date && !startDate) || (body.end_date && !endDate)) {
      throw new ValidationError('start_date and end_date must be valid datetime values');
    }
    if (startDate && endDate && new Date(endDate).getTime() <= new Date(startDate).getTime()) {
      throw new ValidationError('end_date must be after start_date');
    }

    let inserted;
    try {
      inserted = await db.query(
        `
        INSERT INTO promo_codes (
          code,
          discount_type,
          discount_value,
          max_discount,
          min_order_amount,
          usage_limit,
          per_user_limit,
          city,
          user_type,
          start_date,
          end_date,
          active
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING
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
          active,
          created_at,
          updated_at
        `,
        [
          code,
          discountType,
          discountValue,
          maxDiscount,
          minOrderAmount,
          usageLimit,
          perUserLimit,
          city,
          userType,
          startDate,
          endDate,
          active,
        ],
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw new ConflictError('Promo code already exists');
      }
      throw error;
    }

    return {
      ok: true,
      promo: normalizePromoRow(inserted.rows[0]),
    };
  }

  async function updatePromo(rawPromoId, body = {}) {
    await ensurePricingSchema();
    const promoId = String(rawPromoId || '').trim();
    if (!promoId) {
      throw new ValidationError('Invalid promo id');
    }

    const existingRes = await db.query(
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
        active,
        created_at,
        updated_at
      FROM promo_codes
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [promoId],
    );
    if (existingRes.rowCount === 0) {
      throw new NotFoundError('Promo not found');
    }
    const existing = existingRes.rows[0];

    const code =
      body.code !== undefined
        ? normalizePromoCodeForStorage(body.code)
        : normalizePromoCodeForStorage(existing.code);
    const discountType =
      body.discount_type !== undefined
        ? coercePromoDiscountType(body.discount_type)
        : coercePromoDiscountType(existing.discount_type);
    const discountValue =
      body.discount_value !== undefined
        ? Math.max(0, roundCurrencyAmount(Number(body.discount_value) || 0))
        : Math.max(0, roundCurrencyAmount(Number(existing.discount_value) || 0));

    const maxDiscount =
      body.max_discount !== undefined
        ? (() => {
            const raw = parseNullableNumber(body.max_discount);
            return raw !== null && raw >= 0 ? roundCurrencyAmount(raw) : null;
          })()
        : Number.isFinite(Number(existing.max_discount)) && Number(existing.max_discount) >= 0
          ? roundCurrencyAmount(Number(existing.max_discount))
          : null;

    const minOrderAmount =
      body.min_order_amount !== undefined
        ? (() => {
            const raw = parseNullableNumber(body.min_order_amount);
            return raw !== null && raw >= 0 ? roundCurrencyAmount(raw) : 0;
          })()
        : Math.max(0, roundCurrencyAmount(Number(existing.min_order_amount) || 0));

    const usageLimit =
      body.usage_limit !== undefined
        ? (() => {
            const raw = parseNullableNumber(body.usage_limit);
            return raw !== null && raw > 0 ? Math.trunc(raw) : null;
          })()
        : Number.isFinite(Number(existing.usage_limit)) && Number(existing.usage_limit) > 0
          ? Math.trunc(Number(existing.usage_limit))
          : null;

    const perUserLimit =
      body.per_user_limit !== undefined
        ? Math.max(0, Math.trunc(Number(body.per_user_limit) || 0))
        : Math.max(0, Math.trunc(Number(existing.per_user_limit) || 1));

    const city =
      body.city !== undefined ? normalizeOptionalText(body.city) : normalizeOptionalText(existing.city);
    const userType =
      body.user_type !== undefined
        ? normalizeOptionalText(body.user_type)?.toLowerCase() || null
        : normalizeOptionalText(existing.user_type)?.toLowerCase() || null;

    const startDate =
      body.start_date !== undefined
        ? parseOptionalTimestamp(body.start_date)
        : existing.start_date
          ? new Date(existing.start_date).toISOString()
          : null;
    const endDate =
      body.end_date !== undefined
        ? parseOptionalTimestamp(body.end_date)
        : existing.end_date
          ? new Date(existing.end_date).toISOString()
          : null;
    const active = body.active !== undefined ? body.active !== false : existing.active === true;

    if (!code) throw new ValidationError('code is required');
    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
      throw new ValidationError('discount_value for percentage must be > 0 and <= 100');
    }
    if (discountType === 'flat' && discountValue <= 0) {
      throw new ValidationError('discount_value for flat must be > 0');
    }
    if (
      (body.start_date !== undefined && body.start_date && !startDate) ||
      (body.end_date !== undefined && body.end_date && !endDate)
    ) {
      throw new ValidationError('start_date and end_date must be valid datetime values');
    }
    if (startDate && endDate && new Date(endDate).getTime() <= new Date(startDate).getTime()) {
      throw new ValidationError('end_date must be after start_date');
    }
    const usedCount = Math.max(0, Math.trunc(Number(existing.used_count) || 0));
    if (usageLimit !== null && usageLimit < usedCount) {
      throw new ValidationError('usage_limit cannot be lower than used_count');
    }

    let updated;
    try {
      updated = await db.query(
        `
        UPDATE promo_codes
        SET code = $2,
            discount_type = $3,
            discount_value = $4,
            max_discount = $5,
            min_order_amount = $6,
            usage_limit = $7,
            per_user_limit = $8,
            city = $9,
            user_type = $10,
            start_date = $11,
            end_date = $12,
            active = $13,
            updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING
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
          active,
          created_at,
          updated_at
        `,
        [
          promoId,
          code,
          discountType,
          discountValue,
          maxDiscount,
          minOrderAmount,
          usageLimit,
          perUserLimit,
          city,
          userType,
          startDate,
          endDate,
          active,
        ],
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw new ConflictError('Promo code already exists');
      }
      throw error;
    }

    return {
      ok: true,
      promo: normalizePromoRow(updated.rows[0]),
    };
  }

  async function getWalletHealth() {
    await ensurePricingSchema();
    const metricsRes = await db.query(
      `
      WITH pending_reservations AS (
        SELECT
          id,
          created_at,
          expires_at
        FROM order_credit_reservations
        WHERE status = 'pending'
      )
      SELECT
        COUNT(*) FILTER (WHERE expires_at > NOW())::int AS pending_reservations,
        COUNT(*) FILTER (WHERE expires_at <= NOW())::int AS expired_unreleased,
        COALESCE(
          ROUND(
            AVG(
              EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0
            ) FILTER (WHERE expires_at > NOW())::numeric,
            2
          ),
          0
        ) AS avg_pending_age_minutes
      FROM pending_reservations
      `,
    );

    const stuckIntentsRes = await db.query(
      `
      SELECT COUNT(*)::int AS stuck_stripe_intents_over_20m
      FROM orders
      WHERE stripe_payment_intent_id IS NOT NULL
        AND payment_status = 'requires_payment'
        AND created_at <= NOW() - INTERVAL '20 minutes'
      `,
    );

    const webhookRes = await db.query(
      `
      SELECT
        COUNT(*)::int AS webhook_events_24h,
        COUNT(*) FILTER (
          WHERE event_type = 'payment_intent.payment_failed'
        )::int AS webhook_payment_failed_24h
      FROM stripe_webhook_events
      WHERE processed_at >= NOW() - INTERVAL '24 hours'
      `,
    );
    const walletSyncRes = await db.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS wallet_sync_pending,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS wallet_sync_processing,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS wallet_sync_failed,
        COUNT(*) FILTER (
          WHERE status = 'pending'
            AND available_at <= NOW() - INTERVAL '5 minutes'
        )::int AS wallet_sync_stuck_pending_5m
      FROM wallet_sync_events
      `,
    );

    const row = metricsRes.rows[0] || {};
    const stuckRow = stuckIntentsRes.rows[0] || {};
    const webhookRow = webhookRes.rows[0] || {};
    const walletSyncRow = walletSyncRes.rows[0] || {};

    return {
      ok: true,
      pending_reservations: Number(row.pending_reservations || 0),
      expired_unreleased: Number(row.expired_unreleased || 0),
      avg_pending_age_minutes: Number(row.avg_pending_age_minutes || 0),
      stuck_stripe_intents_over_20m: Number(stuckRow.stuck_stripe_intents_over_20m || 0),
      webhook_events_24h: Number(webhookRow.webhook_events_24h || 0),
      webhook_payment_failed_24h: Number(webhookRow.webhook_payment_failed_24h || 0),
      wallet_sync_pending: Number(walletSyncRow.wallet_sync_pending || 0),
      wallet_sync_processing: Number(walletSyncRow.wallet_sync_processing || 0),
      wallet_sync_failed: Number(walletSyncRow.wallet_sync_failed || 0),
      wallet_sync_stuck_pending_5m: Number(walletSyncRow.wallet_sync_stuck_pending_5m || 0),
    };
  }

  async function adjustOrderCredits(body = {}) {
    const client = await db.connect();
    let committed = false;
    try {
      await ensurePricingSchema();
      const orderId = Number.parseInt(String(body?.order_id ?? ''), 10);
      const rawAmount = Number(body?.amount);
      const amount = roundCurrencyAmount(rawAmount);
      const direction = normalizeAdjustmentDirection(body?.direction);
      const note = normalizeOptionalText(body?.note);
      const referenceTxId = normalizeOptionalText(body?.reference_tx_id);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        throw new ValidationError('order_id must be a positive integer');
      }
      if (!direction) {
        throw new ValidationError('direction must be credit or debit');
      }
      if (!referenceTxId) {
        throw new ValidationError('reference_tx_id is required for idempotent adjustments');
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('amount must be greater than 0');
      }

      await client.query('BEGIN');
      const orderRes = await client.query(
        `
        SELECT
          o.id,
          o.firebase_uid,
          u.id AS user_id
        FROM orders o
        LEFT JOIN users u
          ON u.firebase_uid = o.firebase_uid
        WHERE o.id = $1
        FOR UPDATE OF o
        `,
        [orderId],
      );
      if (orderRes.rowCount === 0) {
        throw new NotFoundError('Order not found');
      }

      const firebaseUid = String(orderRes.rows[0].firebase_uid || '').trim();
      if (!firebaseUid) {
        throw new ConflictError('Order is not linked to a customer account');
      }
      const userId = Number(orderRes.rows[0].user_id);
      if (!Number.isInteger(userId) || userId <= 0) {
        throw new NotFoundError('Customer user not found');
      }

      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
      const entryType = direction === 'credit' ? 'earned' : 'used';
      const source = `manual_adjustment_${direction}:${referenceTxId}`;

      if (direction === 'debit') {
        const balanceRes = await client.query(
          `
          WITH reserved_balance AS (
            SELECT COALESCE(SUM(amount), 0)::numeric AS reserved
            FROM order_credit_reservations
            WHERE user_id = $1
              AND status = 'pending'
              AND expires_at > NOW()
          )
          SELECT (
            COALESCE(
              (
                SELECT order_credits_balance
                FROM user_wallet_balances
                WHERE user_id = $1
              ),
              0
            )::numeric - reserved_balance.reserved
          )::numeric AS balance
          FROM reserved_balance
          `,
          [userId],
        );
        const availableBalance = roundCurrencyAmount(Number(balanceRes.rows[0]?.balance || 0));
        if (availableBalance + 0.0001 < amount) {
          throw new ConflictError('Insufficient credit balance for debit adjustment', {
            available_balance: availableBalance,
          });
        }
      }

      const insertRes = await client.query(
        `
        INSERT INTO order_credit_transactions (
          user_id,
          type,
          amount,
          order_id,
          reference_tx_id,
          source,
          note,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT DO NOTHING
        RETURNING id, user_id, type, amount, order_id, reference_tx_id, source, note, created_at
        `,
        [userId, entryType, amount, orderId, referenceTxId, source, note],
      );

      if (insertRes.rowCount === 0) {
        const existingRes = await client.query(
          `
          SELECT id, user_id, type, amount, order_id, reference_tx_id, source, note, created_at
          FROM order_credit_transactions
          WHERE order_id = $1
            AND reference_tx_id = $2
            AND source LIKE 'manual_adjustment_%'
          LIMIT 1
          `,
          [orderId, referenceTxId],
        );
        if (existingRes.rowCount === 0) {
          throw new ConflictError('Idempotency conflict for this adjustment');
        }
        const existingTx = existingRes.rows[0];
        const existingAmount = roundCurrencyAmount(Number(existingTx?.amount || 0));
        const existingType = String(existingTx?.type || '').trim().toLowerCase();
        if (existingType !== entryType || existingAmount !== amount) {
          throw new ConflictError(
            'Idempotency reference already exists with different direction or amount',
            { existing_transaction: existingTx },
          );
        }

        await client.query('COMMIT');
        committed = true;
        return {
          ok: true,
          idempotent: true,
          transaction: existingTx || null,
        };
      }

      await client.query('COMMIT');
      committed = true;

      if (typeof publishUserRealtimeWalletSnapshot === 'function') {
        try {
          await publishUserRealtimeWalletSnapshot(db.pool, firebaseUid);
        } catch (walletError) {
          logger?.warn?.(`Wallet realtime publish failed for ${firebaseUid}: ${walletError.message}`);
        }
      }
      if (typeof bumpOrdersCacheVersion === 'function') {
        try {
          await bumpOrdersCacheVersion(firebaseUid);
        } catch (cacheError) {
          logger?.warn?.(`Orders cache bump failed for ${firebaseUid}: ${cacheError.message}`);
        }
      }

      return {
        ok: true,
        transaction: insertRes.rows[0],
      };
    } catch (error) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    listFeeRules,
    upsertCurrentFeeRule,
    listDeliveryFeeSlabs,
    createDeliveryFeeSlab,
    updateDeliveryFeeSlab,
    listPromos,
    createPromo,
    updatePromo,
    getWalletHealth,
    adjustOrderCredits,
  };
}

module.exports = {
  createAdminOrdersService,
};
