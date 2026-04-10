const firebaseAdmin = require('firebase-admin');
const { buildWalletSnapshotRow } = require('../../domains/wallet');

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function createRealtimeServices({
  db = null,
  logger = console,
  getFirebaseAdminFirestore,
  parseInteger,
  normalizeReferralCode,
  roundCurrencyAmount,
  platformCurrency,
}) {
  if (typeof getFirebaseAdminFirestore !== 'function') {
    throw new Error('createRealtimeServices requires getFirebaseAdminFirestore()');
  }
  if (typeof parseInteger !== 'function') {
    throw new Error('createRealtimeServices requires parseInteger()');
  }
  if (typeof normalizeReferralCode !== 'function') {
    throw new Error('createRealtimeServices requires normalizeReferralCode()');
  }
  if (typeof roundCurrencyAmount !== 'function') {
    throw new Error('createRealtimeServices requires roundCurrencyAmount()');
  }

  const WALLET_SYNC_EVENT_TYPE = 'wallet_snapshot';
  const MAX_WALLET_SYNC_ATTEMPTS = 20;
  const WALLET_SYNC_MAX_BATCH = 25;
  const WALLET_SYNC_BACKOFF_MAX_MS = 10 * 60 * 1000;
  let walletSyncSchemaReady = false;
  let walletSyncSchemaPromise = null;
  let lastWalletSyncDrainAt = 0;

  async function ensureWalletSyncSchema(client) {
    if (walletSyncSchemaReady) return;
    if (!walletSyncSchemaPromise) {
      walletSyncSchemaPromise = client
        .query(
          `
          CREATE TABLE IF NOT EXISTS wallet_sync_events (
            firebase_uid TEXT NOT NULL,
            event_type TEXT NOT NULL DEFAULT 'wallet_snapshot',
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'processing', 'done', 'failed')),
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
            last_error TEXT,
            available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            processed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (firebase_uid, event_type)
          );

          CREATE INDEX IF NOT EXISTS idx_wallet_sync_events_status_available
            ON wallet_sync_events(status, available_at, updated_at);
          `,
        )
        .then(() => {
          walletSyncSchemaReady = true;
        })
        .catch((error) => {
          walletSyncSchemaPromise = null;
          throw error;
        });
    }
    await walletSyncSchemaPromise;
  }

  function truncateErrorMessage(error) {
    return String(error?.message || error || 'unknown_error').slice(0, 1000);
  }

  async function enqueueWalletRealtimeSync(client, firebaseUid, reason = null) {
    const normalizedUid = String(firebaseUid || '').trim();
    if (!normalizedUid) return false;
    await ensureWalletSyncSchema(client);
    await client.query(
      `
      INSERT INTO wallet_sync_events (
        firebase_uid,
        event_type,
        status,
        attempt_count,
        last_error,
        available_at,
        processed_at,
        updated_at
      )
      VALUES ($1, $2, 'pending', 0, NULL, NOW(), NULL, NOW())
      ON CONFLICT (firebase_uid, event_type)
      DO UPDATE SET
        status = 'pending',
        attempt_count = 0,
        last_error = CASE
          WHEN $3::text IS NULL OR BTRIM($3::text) = '' THEN NULL
          ELSE $3::text
        END,
        available_at = NOW(),
        processed_at = NULL,
        updated_at = NOW()
      `,
      [normalizedUid, WALLET_SYNC_EVENT_TYPE, reason],
    );
    return true;
  }

  async function publishWalletSnapshotUnsafe(client, firebaseUid) {
    const snapshot = await getUserReferralWalletSnapshot(client, firebaseUid);
    if (!snapshot) return false;
    const firestore = getFirebaseAdminFirestore();
    await firestore.collection('users').doc(snapshot.firebaseUid).set(
      {
        referral_code: snapshot.referralCode,
        referred_by_code: snapshot.referredByCode,
        delivery_credits_balance: snapshot.deliveryCreditsBalance,
        order_credits_balance: snapshot.orderCreditsBalance,
        order_credits_available_balance: snapshot.orderCreditsAvailableBalance,
        order_credits_total_balance: snapshot.orderCreditsTotalBalance,
        wallet_updated_at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  }

  function computeRetryDelayMs(attemptCount) {
    const safeAttempt = Math.max(1, Number(attemptCount) || 1);
    const delay = Math.min(
      WALLET_SYNC_BACKOFF_MAX_MS,
      Math.pow(2, Math.min(safeAttempt, 10)) * 1000,
    );
    return delay;
  }

  async function processPendingWalletRealtimeSync({
    client = null,
    limit = WALLET_SYNC_MAX_BATCH,
  } = {}) {
    const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || WALLET_SYNC_MAX_BATCH));
    if (!db?.withClient && !client) return { processed: 0, succeeded: 0, failed: 0 };

    const runner = async (activeClient) => {
      await ensureWalletSyncSchema(activeClient);
      const claimedRes = await activeClient.query(
        `
        WITH claimed AS (
          SELECT firebase_uid, event_type
          FROM wallet_sync_events
          WHERE event_type = $1
            AND status = 'pending'
            AND available_at <= NOW()
          ORDER BY available_at ASC, updated_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE wallet_sync_events e
        SET status = 'processing',
            updated_at = NOW()
        FROM claimed
        WHERE e.firebase_uid = claimed.firebase_uid
          AND e.event_type = claimed.event_type
        RETURNING e.firebase_uid, e.event_type, e.attempt_count
        `,
        [WALLET_SYNC_EVENT_TYPE, normalizedLimit],
      );

      let succeeded = 0;
      let failed = 0;
      for (const row of claimedRes.rows) {
        const firebaseUid = String(row.firebase_uid || '').trim();
        const currentAttempt = Math.max(0, Number(row.attempt_count) || 0);
        try {
          await publishWalletSnapshotUnsafe(activeClient, firebaseUid);
          await activeClient.query(
            `
            UPDATE wallet_sync_events
            SET status = 'done',
                processed_at = NOW(),
                last_error = NULL,
                updated_at = NOW()
            WHERE firebase_uid = $1
              AND event_type = $2
            `,
            [firebaseUid, WALLET_SYNC_EVENT_TYPE],
          );
          succeeded += 1;
        } catch (error) {
          const nextAttempt = currentAttempt + 1;
          const retryDelayMs = computeRetryDelayMs(nextAttempt);
          const availableAt = new Date(Date.now() + retryDelayMs);
          const nextStatus =
            nextAttempt >= MAX_WALLET_SYNC_ATTEMPTS ? 'failed' : 'pending';
          await activeClient.query(
            `
            UPDATE wallet_sync_events
            SET status = $3,
                attempt_count = $4,
                last_error = $5,
                available_at = $6,
                updated_at = NOW()
            WHERE firebase_uid = $1
              AND event_type = $2
            `,
            [
              firebaseUid,
              WALLET_SYNC_EVENT_TYPE,
              nextStatus,
              nextAttempt,
              truncateErrorMessage(error),
              availableAt.toISOString(),
            ],
          );
          failed += 1;
        }
      }

      return {
        processed: claimedRes.rowCount,
        succeeded,
        failed,
      };
    };

    if (client) {
      return runner(client);
    }
    return db.withClient(runner);
  }

  async function maybeDrainWalletSyncOutbox() {
    if (!db?.withClient) return;
    const now = Date.now();
    if (now - lastWalletSyncDrainAt < 30_000) return;
    lastWalletSyncDrainAt = now;
    try {
      await processPendingWalletRealtimeSync({ limit: 10 });
    } catch (error) {
      logger.warn?.(`Wallet outbox drain failed: ${error.message}`);
    }
  }

  async function publishOrderRealtimeUpdate({
    firebaseUid,
    orderId,
    status,
    paymentStatus,
    assignedDriverUid,
    assignedDriverPhone,
    assignedAt,
    deliveredAt,
    createdAt,
    itemTotal,
    subtotal,
    deliveryFee,
    discountAmount,
    orderCreditUsedAmount,
    platformFee,
    totalAmount,
    missingItemsCreditEarned,
    deliveryFeeCreditEarned,
    totalCompensationCreditEarned,
    currency,
    deliveryPin,
    deliveryPinGeneratedAt,
    deliveryPinVerifiedAt,
  }) {
    const normalizedUid = String(firebaseUid || '').trim();
    const normalizedOrderId = parseInteger(orderId, 0);
    if (!normalizedUid || normalizedOrderId <= 0) return;

    try {
      const firestore = getFirebaseAdminFirestore();
      const payload = {
        order_id: normalizedOrderId,
        status: String(status || 'pending').trim().toLowerCase() || 'pending',
        payment_status:
          String(paymentStatus || 'pending').trim().toLowerCase() || 'pending',
        updated_at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      };

      if (typeof assignedDriverUid !== 'undefined') {
        payload.assigned_driver_uid = assignedDriverUid
          ? String(assignedDriverUid).trim()
          : null;
      }
      if (typeof assignedDriverPhone !== 'undefined') {
        payload.assigned_driver_phone = assignedDriverPhone
          ? String(assignedDriverPhone).trim()
          : null;
      }
      const assignedAtDate = toDateOrNull(assignedAt);
      if (assignedAtDate) payload.assigned_at = assignedAtDate;
      const deliveredAtDate = toDateOrNull(deliveredAt);
      if (deliveredAtDate) payload.delivered_at = deliveredAtDate;
      const createdAtDate = toDateOrNull(createdAt);
      if (createdAtDate) payload.created_at = createdAtDate;
      if (typeof itemTotal === 'number' && Number.isFinite(itemTotal)) {
        payload.item_total = itemTotal;
      }
      if (typeof subtotal === 'number' && Number.isFinite(subtotal)) {
        payload.subtotal = subtotal;
      }
      if (typeof deliveryFee === 'number' && Number.isFinite(deliveryFee)) {
        payload.delivery_fee = deliveryFee;
      }
      if (typeof discountAmount === 'number' && Number.isFinite(discountAmount)) {
        payload.discount_amount = discountAmount;
      }
      if (
        typeof orderCreditUsedAmount === 'number' &&
        Number.isFinite(orderCreditUsedAmount)
      ) {
        payload.order_credit_used_amount = orderCreditUsedAmount;
      }
      if (typeof platformFee === 'number' && Number.isFinite(platformFee)) {
        payload.platform_fee = platformFee;
      }
      if (typeof totalAmount === 'number' && Number.isFinite(totalAmount)) {
        payload.total_amount = totalAmount;
      }
      if (
        typeof missingItemsCreditEarned === 'number' &&
        Number.isFinite(missingItemsCreditEarned)
      ) {
        payload.missing_items_credit_earned = missingItemsCreditEarned;
      }
      if (
        typeof deliveryFeeCreditEarned === 'number' &&
        Number.isFinite(deliveryFeeCreditEarned)
      ) {
        payload.delivery_fee_credit_earned = deliveryFeeCreditEarned;
      }
      if (
        typeof totalCompensationCreditEarned === 'number' &&
        Number.isFinite(totalCompensationCreditEarned)
      ) {
        payload.total_compensation_credit_earned = totalCompensationCreditEarned;
      }
      payload.currency = platformCurrency;
      if (typeof deliveryPin !== 'undefined') {
        payload.delivery_pin = deliveryPin ? String(deliveryPin).trim() : null;
      }
      const deliveryPinGeneratedAtDate = toDateOrNull(deliveryPinGeneratedAt);
      if (deliveryPinGeneratedAtDate) {
        payload.delivery_pin_generated_at = deliveryPinGeneratedAtDate;
      }
      const deliveryPinVerifiedAtDate = toDateOrNull(deliveryPinVerifiedAt);
      if (deliveryPinVerifiedAtDate) {
        payload.delivery_pin_verified_at = deliveryPinVerifiedAtDate;
      }

      await firestore
        .collection('users')
        .doc(normalizedUid)
        .collection('orders')
        .doc(String(normalizedOrderId))
        .set(payload, { merge: true });
    } catch (error) {
      console.warn(
        `Realtime order sync skipped for order ${normalizedOrderId}: ${error.message}`,
      );
    }
  }

  async function publishOrderRealtimeUpdateFromRow(row) {
    if (!row) return;
    await publishOrderRealtimeUpdate({
      firebaseUid: row.firebase_uid,
      orderId: row.id,
      status: row.status,
      paymentStatus: row.payment_status,
      assignedDriverUid: row.assigned_driver_uid,
      assignedDriverPhone: row.assigned_driver_phone,
      assignedAt: row.assigned_at,
      deliveredAt: row.delivered_at,
      createdAt: row.created_at,
      itemTotal: typeof row.item_total === 'number' ? row.item_total : Number(row.item_total),
      subtotal: typeof row.subtotal === 'number' ? row.subtotal : Number(row.subtotal),
      deliveryFee:
        typeof row.delivery_fee === 'number' ? row.delivery_fee : Number(row.delivery_fee),
      discountAmount:
        typeof row.discount_amount === 'number' ? row.discount_amount : Number(row.discount_amount),
      orderCreditUsedAmount:
        typeof row.order_credit_used_amount === 'number'
          ? row.order_credit_used_amount
          : Number(row.order_credit_used_amount),
      platformFee:
        typeof row.platform_fee === 'number' ? row.platform_fee : Number(row.platform_fee),
      totalAmount:
        typeof row.total_amount === 'number' ? row.total_amount : Number(row.total_amount),
      missingItemsCreditEarned:
        typeof row.missing_items_credit_earned === 'number'
          ? row.missing_items_credit_earned
          : Number(row.missing_items_credit_earned),
      deliveryFeeCreditEarned:
        typeof row.delivery_fee_credit_earned === 'number'
          ? row.delivery_fee_credit_earned
          : Number(row.delivery_fee_credit_earned),
      totalCompensationCreditEarned:
        typeof row.total_compensation_credit_earned === 'number'
          ? row.total_compensation_credit_earned
          : Number(row.total_compensation_credit_earned),
      currency: platformCurrency,
      deliveryPin: row.delivery_pin,
      deliveryPinGeneratedAt: row.delivery_pin_generated_at,
      deliveryPinVerifiedAt: row.delivery_pin_verified_at,
    });
  }

  async function getUserReferralWalletSnapshot(client, firebaseUid) {
    const normalizedUid = String(firebaseUid || '').trim();
    if (!normalizedUid) return null;
    const userRes = await client.query(
      `
      SELECT
        u.firebase_uid,
        u.referral_code,
        ref.referral_code AS referred_by_code,
        COALESCE(w.delivery_credits_balance, 0)::int AS delivery_credits_balance,
        COALESCE(w.order_credits_balance, 0)::numeric AS order_credits_total_balance,
        GREATEST(
          0::numeric,
          COALESCE(w.order_credits_balance, 0)::numeric
          - COALESCE(reserved.pending_reserved_amount, 0)::numeric
        ) AS order_credits_available_balance
      FROM users u
      LEFT JOIN users ref ON ref.id = u.referred_by
      LEFT JOIN user_wallet_balances w ON w.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(r.amount), 0)::numeric AS pending_reserved_amount
        FROM order_credit_reservations r
        WHERE r.user_id = u.id
          AND r.status = 'pending'
          AND r.expires_at > NOW()
      ) reserved ON TRUE
      WHERE u.firebase_uid = $1
      LIMIT 1
      `,
      [normalizedUid],
    );
    if (userRes.rowCount === 0) return null;
    return buildWalletSnapshotRow(userRes.rows[0], {
      normalizeReferralCode,
      roundCurrencyAmount,
    });
  }

  async function publishUserRealtimeWalletSnapshot(client, firebaseUid) {
    const normalizedUid = String(firebaseUid || '').trim();
    if (!normalizedUid) return;
    await maybeDrainWalletSyncOutbox();
    try {
      await publishWalletSnapshotUnsafe(client, normalizedUid);
    } catch (error) {
      logger.warn?.(`Realtime wallet sync failed for ${normalizedUid}: ${error.message}`);
      if (db?.withClient) {
        try {
          await db.withClient(async (queueClient) => {
            await enqueueWalletRealtimeSync(
              queueClient,
              normalizedUid,
              truncateErrorMessage(error),
            );
          });
        } catch (queueError) {
          logger.warn?.(
            `Wallet realtime enqueue failed for ${normalizedUid}: ${queueError.message}`,
          );
        }
      }
    }
  }

  return {
    publishOrderRealtimeUpdate,
    publishOrderRealtimeUpdateFromRow,
    getUserReferralWalletSnapshot,
    enqueueWalletRealtimeSync,
    processPendingWalletRealtimeSync,
    publishUserRealtimeWalletSnapshot,
  };
}

module.exports = {
  createRealtimeServices,
};
