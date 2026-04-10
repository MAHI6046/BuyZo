function createUserIdentityUtils({
  normalizeReferralCode,
  randomUUID,
  parseNullableNumber,
  haversineDistanceKm,
  asCheckoutError,
}) {
  function buildReferralCodeCandidate(seed) {
    const prefix = normalizeReferralCode(seed).replace(/[^A-Z]/g, '').slice(0, 4) || 'DOT';
    const suffix = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
    return `${prefix}${suffix}`;
  }

  async function ensureUserReferralCode(client, { userId, firebaseUid = null, displayName = null }) {
    const existing = await client.query(
      `
      SELECT referral_code
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId],
    );
    const currentCode = normalizeReferralCode(existing.rows[0]?.referral_code || '');
    if (currentCode) return currentCode;

    const seed = String(displayName || firebaseUid || `USER${userId}`).trim();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = buildReferralCodeCandidate(seed);
      try {
        const updated = await client.query(
          `
          UPDATE users
          SET referral_code = $2,
              updated_at = NOW()
          WHERE id = $1
            AND referral_code IS NULL
          RETURNING referral_code
          `,
          [userId, candidate],
        );
        if (updated.rowCount > 0) {
          return normalizeReferralCode(updated.rows[0].referral_code);
        }
        const recheck = await client.query(
          `
          SELECT referral_code
          FROM users
          WHERE id = $1
          LIMIT 1
          `,
          [userId],
        );
        const resolved = normalizeReferralCode(recheck.rows[0]?.referral_code || '');
        if (resolved) return resolved;
      } catch (error) {
        if (error?.code === '23505') continue;
        throw error;
      }
    }
    throw new Error('Unable to generate unique referral code');
  }

  async function resolveUserIdFromIdentity(client, identity) {
    const parsedId = Number(identity);
    if (Number.isInteger(parsedId) && parsedId > 0) {
      return parsedId;
    }
    const firebaseUid = String(identity || '').trim();
    if (!firebaseUid) return null;
    const userRes = await client.query(
      `
      SELECT id
      FROM users
      WHERE firebase_uid = $1
      LIMIT 1
      `,
      [firebaseUid],
    );
    if (userRes.rowCount === 0) return null;
    return Number(userRes.rows[0].id);
  }

  function isAddressServiceable(address) {
    const centerLat = parseNullableNumber(process.env.DELIVERY_CENTER_LAT);
    const centerLng = parseNullableNumber(process.env.DELIVERY_CENTER_LNG);
    const radiusKm = parseNullableNumber(process.env.DELIVERY_RADIUS_KM);
    if (centerLat === null || centerLng === null || radiusKm === null) {
      return true;
    }
    if (address.lat === null || address.lng === null) {
      return false;
    }
    return (
      haversineDistanceKm(centerLat, centerLng, Number(address.lat), Number(address.lng)) <= radiusKm
    );
  }

  async function ensureUserRow(client, firebaseUid) {
    const inserted = await client.query(
      `
      INSERT INTO users (firebase_uid, referral_code)
      VALUES ($1, NULL)
      ON CONFLICT (firebase_uid)
      DO NOTHING
      RETURNING id, firebase_uid, display_name, referral_code
      `,
      [firebaseUid],
    );
    let row = inserted.rows[0] || null;
    if (!row) {
      const existing = await client.query(
        `
        SELECT id, firebase_uid, display_name, referral_code
        FROM users
        WHERE firebase_uid = $1
        LIMIT 1
        `,
        [firebaseUid],
      );
      row = existing.rows[0] || null;
    }
    if (!row) {
      throw new Error('Unable to resolve user record');
    }
    const userId = Number(row.id);
    if (!normalizeReferralCode(row.referral_code)) {
      await ensureUserReferralCode(client, {
        userId,
        firebaseUid: row.firebase_uid || firebaseUid,
        displayName: row.display_name || null,
      });
    }
    return userId;
  }

  async function resolveCheckoutAddress(client, { firebaseUid, requestedAddressId }) {
    if (!firebaseUid) {
      throw asCheckoutError(400, 'Authenticated user is required');
    }
    const userId = await ensureUserRow(client, firebaseUid);
    let addressRes;
    if (requestedAddressId) {
      addressRes = await client.query(
        `
        SELECT id, user_id, label, lat, lng, full_address, is_default
        FROM user_addresses
        WHERE id = $1 AND user_id = $2
        `,
        [requestedAddressId, userId],
      );
    } else {
      addressRes = await client.query(
        `
        SELECT id, user_id, label, lat, lng, full_address, is_default
        FROM user_addresses
        WHERE user_id = $1
        ORDER BY is_default DESC, updated_at DESC, id DESC
        LIMIT 1
        `,
        [userId],
      );
    }
    if (addressRes.rowCount === 0) {
      throw asCheckoutError(400, 'Delivery address required before checkout');
    }

    const address = addressRes.rows[0];
    if (!isAddressServiceable(address)) {
      throw asCheckoutError(400, 'Selected address is outside delivery area');
    }
    return { userId, address };
  }

  return {
    buildReferralCodeCandidate,
    ensureUserReferralCode,
    resolveUserIdFromIdentity,
    isAddressServiceable,
    ensureUserRow,
    resolveCheckoutAddress,
  };
}

module.exports = { createUserIdentityUtils };
