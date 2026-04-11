function createReferralRewardUtils() {
  async function maybeCompleteReferralRewardForFirstPaidOrder(client, { firebaseUid, orderId }) {
    const normalizedUid = String(firebaseUid || '').trim();
    const parsedOrderId = Number(orderId);
    if (!normalizedUid || !Number.isInteger(parsedOrderId) || parsedOrderId <= 0) return;
    await client.query(
      `
      WITH candidate_user AS (
        SELECT id AS referred_user_id, referred_by AS referrer_id
        FROM users
        WHERE firebase_uid = $1
        FOR UPDATE
      ),
      pending_referral AS (
        SELECT r.id AS referral_id, r.referrer_id, r.referred_user_id
        FROM referrals r
        JOIN candidate_user cu
          ON cu.referred_user_id = r.referred_user_id
         AND cu.referrer_id = r.referrer_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at ASC
        LIMIT 1
        FOR UPDATE
      ),
      paid_order_count AS (
        SELECT COUNT(*)::int AS paid_count
        FROM orders
        WHERE firebase_uid = $1
          AND payment_status = 'paid'
          AND status NOT IN ('failed', 'cancelled', 'refunded')
      ),
      referred_credit AS (
        INSERT INTO delivery_credit_transactions (
          user_id, type, credits, order_id, source, referral_id, created_at
        )
        SELECT
          pr.referred_user_id,
          'earned',
          2,
          $2,
          'referral_referred',
          pr.referral_id,
          NOW()
        FROM pending_referral pr
        CROSS JOIN paid_order_count poc
        WHERE poc.paid_count = 1
        ON CONFLICT (order_id, user_id, type) DO NOTHING
      ),
      referrer_credit AS (
        INSERT INTO delivery_credit_transactions (
          user_id, type, credits, order_id, source, referral_id, created_at
        )
        SELECT
          pr.referrer_id,
          'earned',
          3,
          $2,
          'referral_referrer',
          pr.referral_id,
          NOW()
        FROM pending_referral pr
        CROSS JOIN paid_order_count poc
        WHERE poc.paid_count = 1
        ON CONFLICT (order_id, user_id, type) DO NOTHING
      )
      UPDATE referrals r
      SET status = 'completed',
          completed_at = NOW()
      FROM pending_referral pr
      CROSS JOIN paid_order_count poc
      WHERE r.id = pr.referral_id
        AND poc.paid_count = 1
        AND r.status = 'pending'
      `,
      [normalizedUid, parsedOrderId],
    );
  }

  return { maybeCompleteReferralRewardForFirstPaidOrder };
}

module.exports = { createReferralRewardUtils };
