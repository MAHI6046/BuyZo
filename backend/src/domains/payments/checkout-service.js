const { ValidationError, UnauthorizedError, ConflictError, NotFoundError } = require('../../errors');

function createCheckoutPaymentService({
  db,
  clock,
  logger,
  parseInteger,
  normalizePromoCode,
  createPendingOrderWithStockLock,
  bumpProductsCacheVersion,
  bumpOrdersCacheVersion,
  publishOrderRealtimeUpdate,
  ensurePricingSchema,
  calculateItemTotalFromItems,
  calculatePricingBreakdown,
  roundCurrencyAmount,
  stripeClient,
  recalculatePendingOrderPricing,
  publishOrderRealtimeUpdateFromRow,
  publishUserRealtimeWalletSnapshot,
  stripePublishableKey,
  resolveUserIdFromIdentity,
  maybeCompleteReferralRewardForFirstPaidOrder,
  platformCurrency,
}) {
  const forbiddenTopLevelPricingFields = new Set([
    'price',
    'total',
    'total_price',
    'subtotal',
    'total_amount',
    'discount',
    'discount_amount',
    'delivery_fee',
    'tax',
    'tax_amount',
    'platform_fee',
    'item_total',
    'order_credit_used_amount',
  ]);

  const findForbiddenPricingField = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    for (const key of Object.keys(body)) {
      if (forbiddenTopLevelPricingFields.has(String(key || '').trim().toLowerCase())) {
        return key;
      }
    }
    return null;
  };

  let pricingSchemaReady = false;
  const ensurePricingSchemaOnce = async () => {
    if (pricingSchemaReady) return;
    await ensurePricingSchema();
    pricingSchemaReady = true;
  };

  function assertNoClientPricing(body) {
    const forbiddenField = findForbiddenPricingField(body);
    if (forbiddenField) {
      throw new ValidationError(`Client pricing field "${forbiddenField}" is not allowed`);
    }
  }

  async function checkout({ firebaseUid, body }) {
    assertNoClientPricing(body);
    return db.withClient(async (client) => {
      const addressId = parseInteger(body?.address_id, 0) || null;
      const promoCode = normalizePromoCode(body?.promo_code);

      await client.query('BEGIN');
      try {
        const {
          orderId,
          itemTotal,
          subtotal,
          deliveryFee,
          discountAmount,
          orderCreditUsedAmount,
          platformFee,
          totalAmount,
          deliveryFeeSlabId,
          deliveryFeeWaived,
          deliveryCreditUsed,
          promoId,
          promoCode: appliedPromoCode,
          feeRuleId,
          feeRuleVersion,
          order,
          checkoutItems,
        } = await createPendingOrderWithStockLock(client, {
          firebaseUid,
          rawItems: body?.items,
          addressId,
          promoCode,
        });

        await client.query('COMMIT');

        await bumpProductsCacheVersion();
        await bumpOrdersCacheVersion(firebaseUid);
        await publishOrderRealtimeUpdate({
          firebaseUid,
          orderId,
          status: order.status,
          paymentStatus: order.payment_status,
          createdAt: order.created_at,
          itemTotal,
          subtotal,
          deliveryFee,
          discountAmount,
          platformFee,
          totalAmount,
          currency: platformCurrency,
        });

        return {
          ok: true,
          checkout: {
            order_id: orderId,
            order_number: `DOT-${orderId}`,
            status: order.status,
            payment_status: order.payment_status,
            currency: platformCurrency,
            checked_out_at: order.created_at,
            item_total: itemTotal,
            subtotal,
            delivery_fee: deliveryFee,
            discount_amount: discountAmount,
            order_credit_used_amount: orderCreditUsedAmount,
            platform_fee: platformFee,
            total_amount: totalAmount,
            delivery_fee_slab_id: deliveryFeeSlabId,
            promo_id: promoId,
            promo_code: appliedPromoCode,
            fee_rule_id: feeRuleId,
            fee_rule_version: feeRuleVersion,
            delivery_fee_waived: deliveryFeeWaived === true,
            delivery_credit_used: deliveryCreditUsed === true,
            items: checkoutItems,
          },
        };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw error;
      }
    });
  }

  async function applyPromo({ firebaseUid, body }) {
    assertNoClientPricing(body);
    if (!firebaseUid) {
      throw new UnauthorizedError('Unauthenticated request');
    }

    await ensurePricingSchemaOnce();

    const promoCode = normalizePromoCode(body?.code || body?.promo_code);
    if (!promoCode) {
      throw new ValidationError('Promo code is required');
    }

    return db.withClient(async (client) => {
      const { itemTotal } = await calculateItemTotalFromItems(client, body?.items);
      let pricing;
      try {
        pricing = await calculatePricingBreakdown({
          client,
          userId: firebaseUid,
          itemTotal,
          promoCode,
        });
      } catch (error) {
        throw new ValidationError(error?.message || 'Invalid promo');
      }

      return {
        ok: true,
        promo: {
          code: pricing.promoCode,
          discount_amount: pricing.discountAmount,
        },
        breakdown: {
          item_total: pricing.itemTotal,
          subtotal: pricing.subtotal,
          delivery_fee: pricing.deliveryFee,
          platform_fee: pricing.platformFee,
          discount_amount: pricing.discountAmount,
          order_credit_used_amount: pricing.orderCreditUsedAmount,
          total_amount: pricing.totalAmount,
        },
      };
    });
  }

  async function previewPricing({ firebaseUid, body }) {
    assertNoClientPricing(body);
    if (!firebaseUid) {
      throw new UnauthorizedError('Unauthenticated request');
    }

    await ensurePricingSchemaOnce();

    return db.withClient(async (client) => {
      const promoCode = normalizePromoCode(body?.promo_code || body?.code);
      const { itemTotal } = await calculateItemTotalFromItems(client, body?.items);
      let pricing;
      try {
        pricing = await calculatePricingBreakdown({
          client,
          userId: firebaseUid,
          itemTotal,
          promoCode: promoCode || null,
        });
      } catch (error) {
        throw new ValidationError(error?.message || 'Unable to preview pricing');
      }

      return {
        ok: true,
        breakdown: {
          item_total: pricing.itemTotal,
          subtotal: pricing.subtotal,
          delivery_fee: pricing.deliveryFee,
          platform_fee: pricing.platformFee,
          discount_amount: pricing.discountAmount,
          order_credit_used_amount: pricing.orderCreditUsedAmount,
          total_amount: pricing.totalAmount,
        },
        promo: pricing.promoCode
          ? {
              code: pricing.promoCode,
              discount_amount: pricing.discountAmount,
            }
          : null,
      };
    });
  }

  async function createPaymentIntent({ firebaseUid, body }) {
    assertNoClientPricing(body);
    await ensurePricingSchemaOnce();
    if (!stripeClient) {
      throw new ValidationError('STRIPE_SECRET_KEY is not configured');
    }

    return db.withClient(async (client) => {
      const addressId = parseInteger(body?.address_id, 0) || null;
      const promoCode = normalizePromoCode(body?.promo_code);
      const currency = platformCurrency;
      let orderId = Number(body?.order_id);
      let pricing = null;
      let transactionOpen = false;
      let createdOrderInThisRequest = false;
      let reservationPendingForOrder = false;
      let stripeIntentCreated = false;
      const normalizedFirebaseUid = String(firebaseUid || '').trim();
      let resolvedUserIdForRequest = null;
      const getResolvedUserId = async () => {
        if (resolvedUserIdForRequest) {
          return resolvedUserIdForRequest;
        }
        const resolved = await resolveUserIdFromIdentity(client, normalizedFirebaseUid);
        if (!resolved) return null;
        resolvedUserIdForRequest = resolved;
        return resolvedUserIdForRequest;
      };

      try {
        if (Number.isInteger(orderId) && orderId > 0) {
          await client.query('BEGIN');
          transactionOpen = true;
          pricing = await recalculatePendingOrderPricing(client, {
            orderId,
            firebaseUid,
            promoCode: promoCode || null,
          });
          await client.query('COMMIT');
          transactionOpen = false;
        } else {
          await client.query('BEGIN');
          transactionOpen = true;
          createdOrderInThisRequest = true;
          const created = await createPendingOrderWithStockLock(client, {
            firebaseUid,
            rawItems: body?.items,
            addressId,
            promoCode: promoCode || null,
          });
          orderId = created.orderId;
          pricing = {
            itemTotal: created.itemTotal,
            subtotal: created.subtotal,
            deliveryFee: created.deliveryFee,
            discountAmount: created.discountAmount,
            orderCreditUsedAmount: created.orderCreditUsedAmount,
            platformFee: created.platformFee,
            totalAmount: created.totalAmount,
            deliveryFeeWaived: created.deliveryFeeWaived,
            deliveryCreditUsed: created.deliveryCreditUsed,
            promoCode: created.promoCode,
            promoId: created.promoId,
          };
        }

        const itemTotal = roundCurrencyAmount(Number(pricing?.itemTotal || 0));
        const subtotal = roundCurrencyAmount(Number(pricing?.subtotal || itemTotal));
        const deliveryFee = roundCurrencyAmount(Number(pricing?.deliveryFee || 0));
        const discountAmount = roundCurrencyAmount(Number(pricing?.discountAmount || 0));
        const orderCreditUsedAmount = roundCurrencyAmount(
          Number(pricing?.orderCreditUsedAmount || 0),
        );
        const platformFee = roundCurrencyAmount(Number(pricing?.platformFee || 0));
        const totalAmount = roundCurrencyAmount(Number(pricing?.totalAmount || 0));
        const amountInCents = Math.max(0, Math.round(totalAmount * 100));
        if (!Number.isInteger(amountInCents) || amountInCents < 0) {
          throw new ValidationError('Invalid computed amount for order');
        }

        if (amountInCents === 0) {
          if (!transactionOpen) {
            await client.query('BEGIN');
            transactionOpen = true;
          }

          const requestedOrderCredits = roundCurrencyAmount(
            Number(pricing?.orderCreditUsedAmount || 0),
          );
          if (requestedOrderCredits > 0) {
            const resolvedUserId = await getResolvedUserId();
            if (!resolvedUserId) {
              throw new ConflictError('Credits balance changed. Please refresh and retry.');
            }
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [resolvedUserId]);
            const balanceRes = await client.query(
              `
              SELECT COALESCE(order_credits_balance, 0)::numeric AS balance
              FROM user_wallet_balances
              WHERE user_id = $1
              `,
              [resolvedUserId],
            );
            const currentBalance = roundCurrencyAmount(
              Number(balanceRes.rows[0]?.balance || 0),
            );
            if (currentBalance + 0.0001 < requestedOrderCredits) {
              throw new ConflictError('Credits balance changed. Please refresh and retry.');
            }
          }

          const orderUpdate = await client.query(
            `
            UPDATE orders
            SET payment_status = 'paid',
                status = 'confirmed',
                payment_method = 'credits',
                stripe_payment_intent_id = NULL,
                delivery_pin = COALESCE(
                  NULLIF(BTRIM(delivery_pin), ''),
                  LPAD((FLOOR(RANDOM() * 10000))::int::text, 4, '0')
                ),
                delivery_pin_generated_at = COALESCE(delivery_pin_generated_at, NOW()),
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, firebase_uid, promo_id, delivery_credit_used, delivery_fee_waived, order_credit_used_amount, status, payment_status, currency, item_total, subtotal, delivery_fee, discount_amount, platform_fee, total_amount, delivery_pin, delivery_pin_generated_at, delivery_pin_verified_at, created_at, updated_at
            `,
            [orderId],
          );
          if (orderUpdate.rowCount === 0) {
            throw new NotFoundError('Order not found');
          }
          const orderRow = orderUpdate.rows[0];
          await client.query(
            `
            UPDATE order_credit_reservations
            SET status = 'released',
                updated_at = NOW()
            WHERE order_id = $1
              AND status = 'pending'
            `,
            [Number(orderRow.id)],
          );

          if (orderRow.promo_id) {
            const usageInsert = await client.query(
              `
              INSERT INTO promo_usages (promo_id, user_id, order_id, used_at)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (order_id, promo_id) DO NOTHING
              RETURNING id
              `,
              [orderRow.promo_id, String(orderRow.firebase_uid || '').trim(), Number(orderRow.id)],
            );
            if (usageInsert.rowCount > 0) {
              await client.query(
                `
                UPDATE promo_codes
                SET used_count = used_count + 1,
                    updated_at = NOW()
                WHERE id = $1
                `,
                [orderRow.promo_id],
              );
            }
          }

          if (orderRow.delivery_credit_used === true) {
            const resolvedUserId = await getResolvedUserId();
            if (resolvedUserId) {
              await client.query(
                `
                INSERT INTO delivery_credit_transactions (user_id, type, credits, order_id, source, created_at)
                VALUES ($1, 'used', -1, $2, 'order_delivery_fee_waiver', NOW())
                ON CONFLICT (order_id, user_id, type) DO NOTHING
                `,
                [resolvedUserId, Number(orderRow.id)],
              );
            }
          }

          const paidOrderCreditUsedAmount = roundCurrencyAmount(
            Number(orderRow.order_credit_used_amount || 0),
          );
          if (paidOrderCreditUsedAmount > 0) {
            const resolvedUserId = await getResolvedUserId();
            if (resolvedUserId) {
              await client.query(
                `
                INSERT INTO order_credit_transactions (user_id, type, amount, order_id, source, created_at)
                VALUES ($1, 'used', $2, $3, 'checkout_auto_apply', NOW())
                ON CONFLICT (order_id, source, type) DO NOTHING
                `,
                [resolvedUserId, paidOrderCreditUsedAmount, Number(orderRow.id)],
              );
            }
          }

          await maybeCompleteReferralRewardForFirstPaidOrder(client, {
            firebaseUid: String(orderRow.firebase_uid || '').trim(),
            orderId: Number(orderRow.id),
          });

          await client.query('COMMIT');
          transactionOpen = false;
          if (createdOrderInThisRequest) {
            await bumpProductsCacheVersion();
          }
          await bumpOrdersCacheVersion(firebaseUid);
          await publishOrderRealtimeUpdateFromRow(orderRow);
          if (typeof publishUserRealtimeWalletSnapshot === 'function' && normalizedFirebaseUid) {
            try {
              await publishUserRealtimeWalletSnapshot(db.pool, normalizedFirebaseUid);
            } catch (realtimeError) {
              logger.warn?.(
                `Wallet realtime publish failed for ${normalizedFirebaseUid}: ${
                  realtimeError?.message || realtimeError
                }`,
              );
            }
          }

          return {
            ok: true,
            order_id: orderId,
            amount: 0,
            currency,
            item_total: itemTotal,
            subtotal,
            delivery_fee: deliveryFee,
            discount_amount: discountAmount,
            order_credit_used_amount: orderCreditUsedAmount,
            platform_fee: platformFee,
            total_amount: totalAmount,
            delivery_fee_waived: pricing?.deliveryFeeWaived === true,
            delivery_credit_used: pricing?.deliveryCreditUsed === true,
            promo_code: pricing?.promoCode || null,
            payment_required: false,
            payment_status: 'paid',
            status: 'confirmed',
          };
        }

        if (orderCreditUsedAmount > 0) {
          const resolvedUserId = await getResolvedUserId();
          if (!resolvedUserId) {
            throw new ConflictError('Credits balance changed. Please refresh and retry.');
          }
          await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [resolvedUserId]);
          const availableRes = await client.query(
            `
            WITH reserved_balance AS (
              SELECT COALESCE(SUM(amount), 0)::numeric AS reserved
              FROM order_credit_reservations
              WHERE user_id = $1
                AND status = 'pending'
                AND expires_at > NOW()
                AND order_id <> $2
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
            )::numeric AS available
            FROM reserved_balance
            `,
            [resolvedUserId, orderId],
          );
          const availableBalance = roundCurrencyAmount(
            Number(availableRes.rows[0]?.available || 0),
          );
          if (availableBalance + 0.0001 < orderCreditUsedAmount) {
            throw new ConflictError('Credits balance changed. Please refresh and retry.');
          }
          await client.query(
            `
            INSERT INTO order_credit_reservations (
              user_id,
              order_id,
              amount,
              status,
              payment_intent_id,
              expires_at,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, 'pending', NULL, NOW() + INTERVAL '30 minutes', NOW(), NOW())
            ON CONFLICT (order_id)
            DO UPDATE SET
              user_id = EXCLUDED.user_id,
              amount = EXCLUDED.amount,
              status = 'pending',
              payment_intent_id = NULL,
              expires_at = EXCLUDED.expires_at,
              updated_at = NOW()
            `,
            [resolvedUserId, orderId, orderCreditUsedAmount],
          );
          reservationPendingForOrder = true;
        } else {
          await client.query(
            `
            UPDATE order_credit_reservations
            SET status = 'released',
                updated_at = NOW()
            WHERE order_id = $1
              AND status = 'pending'
            `,
            [orderId],
          );
        }

        if (transactionOpen) {
          await client.query('COMMIT');
          transactionOpen = false;
          if (createdOrderInThisRequest) {
            await bumpProductsCacheVersion();
          }
        }

        logger.info?.('Creating Stripe PaymentIntent', {
          orderId,
          amountInCents,
          currency: platformCurrency,
        });

        const paymentIntent = await stripeClient.paymentIntents.create({
          amount: amountInCents,
          currency: platformCurrency,
          automatic_payment_methods: {
            enabled: true,
          },
          metadata: {
            order_id: String(orderId),
            firebase_uid: firebaseUid || '',
          },
        });
        stripeIntentCreated = true;

        const orderUpdate = await client.query(
          `
          UPDATE orders
          SET stripe_payment_intent_id = $2,
              payment_method = 'stripe',
              payment_status = 'requires_payment',
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, firebase_uid, status, payment_status, currency, item_total, subtotal, delivery_fee, discount_amount, order_credit_used_amount, platform_fee, total_amount, created_at, updated_at
          `,
          [orderId, paymentIntent.id],
        );
        if (reservationPendingForOrder) {
          await client.query(
            `
            UPDATE order_credit_reservations
            SET payment_intent_id = $2,
                updated_at = NOW()
            WHERE order_id = $1
              AND status = 'pending'
            `,
            [orderId, paymentIntent.id],
          );
        }
        await bumpOrdersCacheVersion(firebaseUid);
        if (orderUpdate.rowCount > 0) {
          await publishOrderRealtimeUpdateFromRow(orderUpdate.rows[0]);
        }
        if (typeof publishUserRealtimeWalletSnapshot === 'function' && normalizedFirebaseUid) {
          try {
            await publishUserRealtimeWalletSnapshot(db.pool, normalizedFirebaseUid);
          } catch (realtimeError) {
            logger.warn?.(
              `Wallet realtime publish failed for ${normalizedFirebaseUid}: ${
                realtimeError?.message || realtimeError
              }`,
            );
          }
        }

        return {
          ok: true,
          order_id: orderId,
          amount: amountInCents,
          currency,
          item_total: itemTotal,
          subtotal,
          delivery_fee: deliveryFee,
          discount_amount: discountAmount,
          order_credit_used_amount: orderCreditUsedAmount,
          platform_fee: platformFee,
          total_amount: totalAmount,
          delivery_fee_waived: pricing?.deliveryFeeWaived === true,
          delivery_credit_used: pricing?.deliveryCreditUsed === true,
          promo_code: pricing?.promoCode || null,
          payment_intent_id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          publishable_key: stripePublishableKey,
        };
      } catch (error) {
        if (
          reservationPendingForOrder &&
          !stripeIntentCreated &&
          Number.isInteger(orderId) &&
          orderId > 0
        ) {
          try {
            await client.query(
              `
              UPDATE order_credit_reservations
              SET status = 'released',
                  updated_at = NOW()
              WHERE order_id = $1
                AND status = 'pending'
              `,
              [orderId],
            );
          } catch (_releaseError) {}
        }
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw error;
      }
    });
  }

  return {
    checkout,
    applyPromo,
    previewPricing,
    createPaymentIntent,
  };
}

module.exports = {
  createCheckoutPaymentService,
};
