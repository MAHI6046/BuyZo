const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} = require('../../errors');

function createUserService({
  db,
  identity,
  wallet,
  utils,
}) {
  function assertFunctionDependency(value, name) {
    if (typeof value !== 'function') {
      throw new Error(`createUserService requires function dependency: ${name}`);
    }
  }

  const {
    resolveUserRole,
    ensurePricingSchema,
    ensureUserRow,
  } = identity;
  const {
    getDeliveryCreditBalance,
    getOrderCreditBalance,
    getAvailableOrderCreditBalance,
    publishUserRealtimeWalletSnapshot,
  } = wallet;
  const {
    normalizePhoneNumber,
    normalizeReferralCode,
  } = utils;

  assertFunctionDependency(resolveUserRole, 'identity.resolveUserRole');
  assertFunctionDependency(ensurePricingSchema, 'identity.ensurePricingSchema');
  assertFunctionDependency(ensureUserRow, 'identity.ensureUserRow');
  assertFunctionDependency(getDeliveryCreditBalance, 'wallet.getDeliveryCreditBalance');
  assertFunctionDependency(getOrderCreditBalance, 'wallet.getOrderCreditBalance');
  assertFunctionDependency(
    getAvailableOrderCreditBalance,
    'wallet.getAvailableOrderCreditBalance',
  );
  assertFunctionDependency(
    publishUserRealtimeWalletSnapshot,
    'wallet.publishUserRealtimeWalletSnapshot',
  );
  assertFunctionDependency(normalizePhoneNumber, 'utils.normalizePhoneNumber');
  assertFunctionDependency(normalizeReferralCode, 'utils.normalizeReferralCode');

  let pricingSchemaReady = false;
  async function ensurePricingSchemaOnce() {
    if (pricingSchemaReady) return;
    await ensurePricingSchema();
    pricingSchemaReady = true;
  }

  function mapReferralError(error) {
    const message = String(error?.message || 'Referral claim failed');
    if (message === 'Invalid referral code') return new ValidationError(message);
    if (
      message === 'Referral code already claimed' ||
      message === 'Referral code can only be claimed before first paid order' ||
      message === 'Referral not eligible for this account'
    ) {
      return new ConflictError(message);
    }
    if (
      message === 'You cannot use your own referral code' ||
      message === 'Referral not allowed for same phone number'
    ) {
      return new ValidationError(message);
    }
    return error;
  }

  async function applyReferralCodeClaim(client, { firebaseUid, rawReferralCode }) {
    const referralCode = normalizeReferralCode(rawReferralCode);
    if (!referralCode) return null;

    const claimantUserId = await ensureUserRow(client, firebaseUid);
    const claimantRes = await client.query(
      `
      SELECT id, referral_code, referred_by, phone_number
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [claimantUserId],
    );
    if (claimantRes.rowCount === 0) {
      throw new NotFoundError('User not found');
    }
    const claimant = claimantRes.rows[0];
    if (claimant.referred_by) {
      throw new ConflictError('Referral code already claimed');
    }
    if (normalizeReferralCode(claimant.referral_code) === referralCode) {
      throw new ValidationError('You cannot use your own referral code');
    }

    const referrerRes = await client.query(
      `
      SELECT id, referral_code, phone_number
      FROM users
      WHERE LOWER(referral_code) = LOWER($1)
      LIMIT 1
      FOR UPDATE
      `,
      [referralCode],
    );
    if (referrerRes.rowCount === 0) {
      throw new ValidationError('Invalid referral code');
    }
    const referrerId = Number(referrerRes.rows[0].id);
    if (!Number.isInteger(referrerId) || referrerId <= 0) {
      throw new ValidationError('Invalid referral code');
    }
    if (referrerId === Number(claimant.id)) {
      throw new ValidationError('You cannot use your own referral code');
    }

    const claimantPhone = normalizePhoneNumber(claimant.phone_number);
    const referrerPhone = normalizePhoneNumber(referrerRes.rows[0].phone_number);
    if (claimantPhone && referrerPhone && claimantPhone === referrerPhone) {
      throw new ValidationError('Referral not allowed for same phone number');
    }

    if (claimantPhone) {
      const duplicatePhoneRes = await client.query(
        `
        SELECT COUNT(*)::int AS duplicate_count
        FROM users
        WHERE id <> $1
          AND phone_number = $2
          AND referred_by IS NOT NULL
        `,
        [claimantUserId, claimantPhone],
      );
      if (Number(duplicatePhoneRes.rows[0]?.duplicate_count || 0) > 0) {
        throw new ConflictError('Referral not eligible for this account');
      }
    }

    const paidOrdersRes = await client.query(
      `
      SELECT COUNT(*)::int AS paid_count
      FROM orders
      WHERE firebase_uid = $1
        AND payment_status = 'paid'
        AND status NOT IN ('failed', 'cancelled', 'refunded')
      `,
      [firebaseUid],
    );
    if (Number(paidOrdersRes.rows[0]?.paid_count || 0) > 0) {
      throw new ConflictError('Referral code can only be claimed before first paid order');
    }

    const claimUpdate = await client.query(
      `
      UPDATE users
      SET referred_by = $2,
          updated_at = NOW()
      WHERE id = $1
        AND referred_by IS NULL
      RETURNING id, referred_by
      `,
      [claimantUserId, referrerId],
    );
    if (claimUpdate.rowCount === 0) {
      throw new ConflictError('Referral code already claimed');
    }

    await client.query(
      `
      INSERT INTO referrals (referrer_id, referred_user_id, status, created_at)
      VALUES ($1, $2, 'pending', NOW())
      ON CONFLICT (referred_user_id) DO NOTHING
      `,
      [referrerId, claimantUserId],
    );

    return {
      referred_by: referrerId,
      claimed_code: normalizeReferralCode(referrerRes.rows[0].referral_code),
    };
  }

  async function getMe(firebaseUid) {
    const uid = String(firebaseUid || '').trim();
    if (!uid) {
      throw new UnauthorizedError('Unauthenticated request');
    }

    await ensurePricingSchemaOnce();
    await db.withClient(async (client) => {
      await ensureUserRow(client, uid);
    });

    const result = await db.query(
      `SELECT id, firebase_uid, phone_number, display_name, role, referral_code, referred_by, created_at, updated_at
       FROM users WHERE firebase_uid = $1`,
      [uid],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('User not found');
    }

    const user = result.rows[0];
    const userId = Number(user.id);
    const creditsBalance = await getDeliveryCreditBalance(db.pool, userId);
    const orderCreditsBalance = await getOrderCreditBalance(db.pool, userId);
    const availableOrderCreditsBalance = await getAvailableOrderCreditBalance(db.pool, userId);
    await publishUserRealtimeWalletSnapshot(db.pool, uid);

    return {
      ok: true,
      user: {
        ...user,
        delivery_credits_balance: creditsBalance,
        order_credits_balance: availableOrderCreditsBalance,
        order_credits_available_balance: availableOrderCreditsBalance,
        order_credits_total_balance: orderCreditsBalance,
      },
    };
  }

  async function upsertUser({ firebaseUid, token, body }) {
    const uid = String(firebaseUid || '').trim();
    if (!uid) {
      throw new UnauthorizedError('Unauthenticated request');
    }

    await ensurePricingSchemaOnce();

    const { phone_number, display_name } = body || {};
    const referralCodeInput = body?.referral_code || body?.referralCode || body?.code;
    const tokenPhone = normalizePhoneNumber(token?.phone_number);
    const requestPhone = normalizePhoneNumber(phone_number);
    const resolvedPhone = tokenPhone || requestPhone || null;
    const resolvedRole = await resolveUserRole(resolvedPhone);
    const resolvedDisplayName =
      display_name || token?.name || token?.display_name || null;

    return db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await client.query(
          `
          INSERT INTO users (firebase_uid, phone_number, display_name, role, referral_code)
          VALUES ($1, $2, $3, $4, NULL)
          ON CONFLICT (firebase_uid)
          DO UPDATE SET
            phone_number = COALESCE(EXCLUDED.phone_number, users.phone_number),
            display_name = COALESCE(EXCLUDED.display_name, users.display_name),
            role = EXCLUDED.role,
            updated_at = NOW()
          RETURNING id, firebase_uid, phone_number, display_name, role, referral_code, referred_by, created_at, updated_at
          `,
          [uid, resolvedPhone, resolvedDisplayName, resolvedRole],
        );

        const userId = Number(result.rows[0].id);
        await ensureUserRow(client, uid);
        if (referralCodeInput) {
          await applyReferralCodeClaim(client, {
            firebaseUid: uid,
            rawReferralCode: referralCodeInput,
          });
        }

        const refreshed = await client.query(
          `
          SELECT id, firebase_uid, phone_number, display_name, role, referral_code, referred_by, created_at, updated_at
          FROM users
          WHERE id = $1
          `,
          [userId],
        );

        await client.query('COMMIT');
        const creditsBalance = await getDeliveryCreditBalance(db.pool, userId);
        const orderCreditsBalance = await getOrderCreditBalance(db.pool, userId);
        const availableOrderCreditsBalance = await getAvailableOrderCreditBalance(
          db.pool,
          userId,
        );
        await publishUserRealtimeWalletSnapshot(db.pool, uid);

        return {
          ok: true,
          user: {
            ...refreshed.rows[0],
            delivery_credits_balance: creditsBalance,
            order_credits_balance: availableOrderCreditsBalance,
            order_credits_available_balance: availableOrderCreditsBalance,
            order_credits_total_balance: orderCreditsBalance,
          },
        };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw mapReferralError(error);
      }
    });
  }

  async function getReferral(firebaseUid) {
    const uid = String(firebaseUid || '').trim();
    if (!uid) {
      throw new UnauthorizedError('Unauthenticated request');
    }

    await ensurePricingSchemaOnce();

    return db.withClient(async (client) => {
      const userId = await ensureUserRow(client, uid);
      const userRes = await client.query(
        `
        SELECT id, referral_code, referred_by
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [userId],
      );
      if (userRes.rowCount === 0) {
        throw new NotFoundError('User not found');
      }

      const user = userRes.rows[0];
      const balance = await getDeliveryCreditBalance(client, userId);
      const orderCreditsBalance = await getOrderCreditBalance(client, userId);
      const availableOrderCreditsBalance = await getAvailableOrderCreditBalance(client, userId);
      await publishUserRealtimeWalletSnapshot(client, uid);

      let referredByCode = null;
      if (user.referred_by) {
        const referrerRes = await client.query(
          `
          SELECT referral_code
          FROM users
          WHERE id = $1
          LIMIT 1
          `,
          [Number(user.referred_by)],
        );
        referredByCode = normalizeReferralCode(referrerRes.rows[0]?.referral_code || '') || null;
      }

      const referralStats = await client.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count
        FROM referrals
        WHERE referrer_id = $1
        `,
        [userId],
      );

      return {
        ok: true,
        referral: {
          referral_code: normalizeReferralCode(user.referral_code),
          referred_by: user.referred_by ? Number(user.referred_by) : null,
          referred_by_code: referredByCode,
          delivery_credits_balance: balance,
          order_credits_balance: availableOrderCreditsBalance,
          order_credits_available_balance: availableOrderCreditsBalance,
          order_credits_total_balance: orderCreditsBalance,
          pending_referrals: Number(referralStats.rows[0]?.pending_count || 0),
          completed_referrals: Number(referralStats.rows[0]?.completed_count || 0),
        },
      };
    });
  }

  async function claimReferral(firebaseUid, body) {
    const uid = String(firebaseUid || '').trim();
    if (!uid) {
      throw new UnauthorizedError('Unauthenticated request');
    }

    await ensurePricingSchemaOnce();
    const referralCodeInput = body?.referral_code || body?.referralCode || body?.code;
    if (!normalizeReferralCode(referralCodeInput)) {
      throw new ValidationError('Referral code is required');
    }

    return db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await applyReferralCodeClaim(client, {
          firebaseUid: uid,
          rawReferralCode: referralCodeInput,
        });
        await client.query('COMMIT');
        await publishUserRealtimeWalletSnapshot(db.pool, uid);

        return {
          ok: true,
          referral: result,
        };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw mapReferralError(error);
      }
    });
  }

  async function deleteOwnUser({ authUid, targetFirebaseUid }) {
    const normalizedAuthUid = String(authUid || '').trim();
    const normalizedTargetUid = String(targetFirebaseUid || '').trim();
    if (!normalizedAuthUid) {
      throw new UnauthorizedError('Unauthenticated request');
    }
    if (normalizedTargetUid !== normalizedAuthUid) {
      throw new ForbiddenError('Forbidden');
    }

    const result = await db.query(
      'DELETE FROM users WHERE firebase_uid = $1 RETURNING id',
      [normalizedTargetUid],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('User not found');
    }

    return { ok: true, deleted: true };
  }

  return {
    getMe,
    upsertUser,
    getReferral,
    claimReferral,
    deleteOwnUser,
  };
}

module.exports = {
  createUserService,
};
