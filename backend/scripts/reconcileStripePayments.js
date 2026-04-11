const path = require('path');
const dotenv = require('dotenv');
const Stripe = require('stripe');
const { pool } = require('../src/db');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

const stripe = new Stripe(stripeSecretKey);

const LOOKBACK_HOURS = Math.max(1, Number(process.env.STRIPE_RECON_LOOKBACK_HOURS || 24));
const STUCK_INTENT_MINUTES = Math.max(
  5,
  Number(process.env.STRIPE_RECON_STUCK_MINUTES || 20),
);
const RESERVATION_TTL_MINUTES = Math.max(
  5,
  Number(process.env.ORDER_CREDIT_RESERVATION_TTL_MINUTES || 30),
);
const LIMIT = Math.max(20, Number(process.env.STRIPE_RECON_MAX_INTENTS || 200));

function roundCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

async function resolveUserIdFromFirebaseUid(client, firebaseUid) {
  const uid = String(firebaseUid || '').trim();
  if (!uid) return null;
  const result = await client.query(
    `
    SELECT id
    FROM users
    WHERE firebase_uid = $1
    LIMIT 1
    `,
    [uid],
  );
  if (result.rowCount === 0) return null;
  return Number(result.rows[0].id);
}

async function finalizeCreditsForOrder(client, orderRow, stripeIntentId) {
  const orderId = Number(orderRow.id);
  const firebaseUid = String(orderRow.firebase_uid || '').trim();
  const reservedRes = await client.query(
    `
    SELECT id, amount
    FROM order_credit_reservations
    WHERE order_id = $1
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
    `,
    [orderId],
  );
  let creditAmount = roundCurrency(Number(orderRow.order_credit_used_amount || 0));
  if (reservedRes.rowCount > 0) {
    creditAmount = roundCurrency(Number(reservedRes.rows[0].amount || creditAmount));
    await client.query(
      `
      UPDATE order_credit_reservations
      SET status = 'finalized',
          payment_intent_id = COALESCE(payment_intent_id, $2),
          updated_at = NOW()
      WHERE id = $1
      `,
      [reservedRes.rows[0].id, stripeIntentId],
    );
  }
  if (creditAmount <= 0) return 0;

  const userId = await resolveUserIdFromFirebaseUid(client, firebaseUid);
  if (!userId) return 0;
  await client.query(
    `
    INSERT INTO order_credit_transactions (user_id, type, amount, order_id, source, created_at)
    VALUES ($1, 'used', $2, $3, 'checkout_auto_apply', NOW())
    ON CONFLICT (order_id, source, type) DO NOTHING
    `,
    [userId, creditAmount, orderId],
  );
  return creditAmount;
}

async function markOrderPaidIfNeeded(client, intent, summary) {
  const orderIdFromMeta = Number(intent.metadata?.order_id || 0);
  const updated = await client.query(
    `
    UPDATE orders
    SET payment_status = 'paid',
        status = 'confirmed',
        payment_method = 'stripe',
        delivery_pin = COALESCE(
          NULLIF(BTRIM(delivery_pin), ''),
          LPAD((FLOOR(RANDOM() * 10000))::int::text, 4, '0')
        ),
        delivery_pin_generated_at = COALESCE(delivery_pin_generated_at, NOW()),
        updated_at = NOW()
    WHERE stripe_payment_intent_id = $1
       OR id = COALESCE($2::bigint, -1)
    RETURNING id, firebase_uid, payment_status, status, promo_id, delivery_credit_used, order_credit_used_amount
    `,
    [intent.id, orderIdFromMeta],
  );
  if (updated.rowCount === 0) {
    summary.missingOrderForIntent += 1;
    return;
  }

  for (const row of updated.rows) {
    await finalizeCreditsForOrder(client, row, intent.id);
    summary.fixedPaid += 1;
  }
}

async function releaseReservationForIntent(client, intent, summary) {
  const orderIdFromMeta = Number(intent.metadata?.order_id || 0);
  const released = await client.query(
    `
    UPDATE order_credit_reservations
    SET status = 'released',
        updated_at = NOW()
    WHERE status = 'pending'
      AND (
        payment_intent_id = $1
        OR order_id = COALESCE($2::bigint, -1)
      )
    RETURNING id
    `,
    [intent.id, orderIdFromMeta],
  );
  summary.releasedReservations += released.rowCount;
}

async function reconcile() {
  const startedAt = new Date();
  const summary = {
    scannedIntents: 0,
    fixedPaid: 0,
    releasedReservations: 0,
    releasedExpiredReservations: 0,
    missingOrderForIntent: 0,
    staleRequiresPaymentOrders: 0,
  };

  const sinceUnix = Math.floor(
    Date.now() / 1000 - LOOKBACK_HOURS * 60 * 60,
  );

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        event_id VARCHAR(128) PRIMARY KEY,
        event_type VARCHAR(80) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'processed',
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE order_credit_reservations
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes');
    `);

    await client.query('BEGIN');
    const expiredRelease = await client.query(
      `
      UPDATE order_credit_reservations
      SET status = 'released',
          updated_at = NOW()
      WHERE status = 'pending'
        AND expires_at <= NOW()
      RETURNING id
      `,
    );
    summary.releasedExpiredReservations = expiredRelease.rowCount;
    await client.query('COMMIT');

    let hasMore = true;
    let startingAfter = null;
    while (hasMore && summary.scannedIntents < LIMIT) {
      const page = await stripe.paymentIntents.list({
        limit: Math.min(100, LIMIT - summary.scannedIntents),
        created: { gte: sinceUnix },
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      if (!Array.isArray(page.data) || page.data.length === 0) break;

      for (const intent of page.data) {
        summary.scannedIntents += 1;
        const status = String(intent.status || '').trim().toLowerCase();
        const clientTx = await pool.connect();
        try {
          await clientTx.query('BEGIN');
          if (status === 'succeeded') {
            await markOrderPaidIfNeeded(clientTx, intent, summary);
          } else if (status === 'canceled') {
            await releaseReservationForIntent(clientTx, intent, summary);
          } else if (status === 'requires_payment_method') {
            const createdAt = Number(intent.created || 0) * 1000;
            const ageMinutes = createdAt
              ? (Date.now() - createdAt) / 60000
              : 0;
            if (ageMinutes >= STUCK_INTENT_MINUTES) {
              await releaseReservationForIntent(clientTx, intent, summary);
            }
          }
          await clientTx.query('COMMIT');
        } catch (error) {
          try {
            await clientTx.query('ROLLBACK');
          } catch (_rollbackError) {}
          throw error;
        } finally {
          clientTx.release();
        }
      }

      hasMore = page.has_more === true;
      startingAfter = page.data[page.data.length - 1]?.id || null;
    }

    const staleOrdersRes = await pool.query(
      `
      SELECT COUNT(*)::int AS stale_count
      FROM orders
      WHERE payment_status = 'requires_payment'
        AND stripe_payment_intent_id IS NOT NULL
        AND created_at <= NOW() - ($1::int * INTERVAL '1 minute')
      `,
      [STUCK_INTENT_MINUTES],
    );
    summary.staleRequiresPaymentOrders = Number(
      staleOrdersRes.rows[0]?.stale_count || 0,
    );

    const finishedAt = new Date();
    const output = {
      ok: true,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      lookback_hours: LOOKBACK_HOURS,
      reservation_ttl_minutes: RESERVATION_TTL_MINUTES,
      stuck_intent_minutes: STUCK_INTENT_MINUTES,
      ...summary,
    };
    console.log(JSON.stringify(output, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

reconcile().catch(async (error) => {
  console.error('Stripe reconciliation failed:', error);
  try {
    await pool.end();
  } catch (_closeError) {}
  process.exit(1);
});
