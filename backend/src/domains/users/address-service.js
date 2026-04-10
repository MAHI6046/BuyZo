const {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  AppError,
} = require('../../errors');

function createAddressService({
  db,
  ensureUserRow,
  parseNullableNumber,
  ACTIVE_ORDER_STATUSES,
  mapsApiKey,
  fetchImpl,
}) {
  function requireUid(firebaseUid) {
    const normalized = String(firebaseUid || '').trim();
    if (!normalized) throw new UnauthorizedError('Unauthenticated request');
    return normalized;
  }

  function requireMapsApiKey() {
    if (!mapsApiKey) {
      throw new AppError('GOOGLE_MAPS_API_KEY is not configured on server', {
        status: 500,
        code: 'CONFIG_ERROR',
      });
    }
  }

  async function autocomplete({ input, sessionToken }) {
    requireMapsApiKey();
    if (!input || typeof input !== 'string') {
      throw new ValidationError('input is required');
    }

    const response = await fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsApiKey,
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({
        input,
        languageCode: 'en',
        sessionToken: sessionToken || `session-${Date.now()}`,
      }),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  }

  async function placeDetails({ placeId }) {
    requireMapsApiKey();
    if (!placeId || typeof placeId !== 'string') {
      throw new ValidationError('placeId is required');
    }

    const response = await fetchImpl(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': mapsApiKey,
          'X-Goog-FieldMask': 'formattedAddress,location',
        },
      },
    );

    return {
      status: response.status,
      body: await response.json(),
    };
  }

  async function reverseGeocode({ lat, lng }) {
    requireMapsApiKey();
    if (!lat || !lng) {
      throw new ValidationError('lat and lng are required');
    }

    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: mapsApiKey,
    });

    const response = await fetchImpl(
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
    );

    return {
      status: response.status,
      body: await response.json(),
    };
  }

  async function listAddresses(firebaseUid) {
    const uid = requireUid(firebaseUid);
    return db.withClient(async (client) => {
      const userId = await ensureUserRow(client, uid);
      const result = await client.query(
        `
        SELECT id, user_id, label, lat, lng, full_address, is_default, created_at, updated_at
        FROM user_addresses
        WHERE user_id = $1
        ORDER BY is_default DESC, updated_at DESC, id DESC
        `,
        [userId],
      );
      return { ok: true, addresses: result.rows };
    });
  }

  async function getDefaultAddress(firebaseUid) {
    const uid = requireUid(firebaseUid);
    return db.withClient(async (client) => {
      const userId = await ensureUserRow(client, uid);
      const result = await client.query(
        `
        SELECT id, user_id, label, lat, lng, full_address, is_default, created_at, updated_at
        FROM user_addresses
        WHERE user_id = $1
        ORDER BY is_default DESC, updated_at DESC, id DESC
        LIMIT 1
        `,
        [userId],
      );
      if (result.rowCount === 0) {
        throw new NotFoundError('No saved address');
      }
      return { ok: true, address: result.rows[0] };
    });
  }

  async function createAddress(firebaseUid, body) {
    const uid = requireUid(firebaseUid);
    return db.withClient(async (client) => {
      const userId = await ensureUserRow(client, uid);
      const fullAddress = String(body?.full_address || '').trim();
      const label = String(body?.label || 'Home').trim().slice(0, 30) || 'Home';
      const lat = parseNullableNumber(body?.lat);
      const lng = parseNullableNumber(body?.lng);
      const setDefault = body?.is_default !== false;

      if (!fullAddress) {
        throw new ValidationError('full_address is required');
      }

      await client.query('BEGIN');
      try {
        if (setDefault) {
          await client.query(
            `UPDATE user_addresses SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1`,
            [userId],
          );
        }
        const inserted = await client.query(
          `
          INSERT INTO user_addresses (user_id, label, lat, lng, full_address, is_default)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, user_id, label, lat, lng, full_address, is_default, created_at, updated_at
          `,
          [userId, label, lat, lng, fullAddress, setDefault],
        );
        await client.query('COMMIT');
        return { ok: true, address: inserted.rows[0] };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw error;
      }
    });
  }

  async function setDefaultAddress(firebaseUid, rawAddressId) {
    const uid = requireUid(firebaseUid);
    return db.withClient(async (client) => {
      const addressId = Number(rawAddressId);
      if (!Number.isInteger(addressId) || addressId <= 0) {
        throw new ValidationError('Invalid address id');
      }

      const userId = await ensureUserRow(client, uid);

      await client.query('BEGIN');
      try {
        const target = await client.query(
          `
          SELECT id
          FROM user_addresses
          WHERE id = $1 AND user_id = $2
          `,
          [addressId, userId],
        );
        if (target.rowCount === 0) {
          throw new NotFoundError('Address not found');
        }

        await client.query(
          `UPDATE user_addresses SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1`,
          [userId],
        );
        const updated = await client.query(
          `
          UPDATE user_addresses
          SET is_default = TRUE, updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id, user_id, label, lat, lng, full_address, is_default, created_at, updated_at
          `,
          [addressId, userId],
        );
        await client.query('COMMIT');
        return { ok: true, address: updated.rows[0] };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw error;
      }
    });
  }

  async function updateAddress(firebaseUid, rawAddressId, body) {
    const uid = requireUid(firebaseUid);
    return db.withClient(async (client) => {
      const addressId = Number(rawAddressId);
      if (!Number.isInteger(addressId) || addressId <= 0) {
        throw new ValidationError('Invalid address id');
      }

      const userId = await ensureUserRow(client, uid);

      const hasFullAddress = Object.prototype.hasOwnProperty.call(body || {}, 'full_address');
      const hasLabel = Object.prototype.hasOwnProperty.call(body || {}, 'label');
      const hasLat = Object.prototype.hasOwnProperty.call(body || {}, 'lat');
      const hasLng = Object.prototype.hasOwnProperty.call(body || {}, 'lng');
      const hasIsDefault = Object.prototype.hasOwnProperty.call(body || {}, 'is_default');

      const updates = [];

      if (hasFullAddress) {
        const fullAddress = String(body.full_address || '').trim();
        if (!fullAddress) {
          throw new ValidationError('full_address cannot be empty');
        }
        updates.push(fullAddress);
      }

      if (hasLabel) {
        const label = String(body.label || '').trim().slice(0, 30) || 'Home';
        updates.push(label);
      }

      if (hasLat) {
        updates.push(parseNullableNumber(body.lat));
      }

      if (hasLng) {
        updates.push(parseNullableNumber(body.lng));
      }

      if (!hasFullAddress && !hasLabel && !hasLat && !hasLng && !hasIsDefault) {
        throw new ValidationError('No fields to update');
      }

      await client.query('BEGIN');
      try {
        const exists = await client.query(
          `
          SELECT id
          FROM user_addresses
          WHERE id = $1 AND user_id = $2
          `,
          [addressId, userId],
        );
        if (exists.rowCount === 0) {
          throw new NotFoundError('Address not found');
        }

        if (hasIsDefault && body.is_default === true) {
          await client.query(
            `UPDATE user_addresses SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1`,
            [userId],
          );
        }

        const setClauses = [];
        const queryParams = [addressId, userId];
        let idx = 3;
        let updateIndex = 0;
        if (hasFullAddress) {
          setClauses.push(`full_address = $${idx++}`);
          queryParams.push(updates[updateIndex++]);
        }
        if (hasLabel) {
          setClauses.push(`label = $${idx++}`);
          queryParams.push(updates[updateIndex++]);
        }
        if (hasLat) {
          setClauses.push(`lat = $${idx++}`);
          queryParams.push(updates[updateIndex++]);
        }
        if (hasLng) {
          setClauses.push(`lng = $${idx++}`);
          queryParams.push(updates[updateIndex++]);
        }
        if (hasIsDefault) {
          setClauses.push(`is_default = $${idx++}`);
          queryParams.push(body.is_default === true);
        }
        setClauses.push('updated_at = NOW()');

        const updated = await client.query(
          `
          UPDATE user_addresses
          SET ${setClauses.join(', ')}
          WHERE id = $1 AND user_id = $2
          RETURNING id, user_id, label, lat, lng, full_address, is_default, created_at, updated_at
          `,
          queryParams,
        );

        await client.query('COMMIT');
        return { ok: true, address: updated.rows[0] };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw error;
      }
    });
  }

  async function deleteAddress(firebaseUid, rawAddressId) {
    const uid = requireUid(firebaseUid);
    return db.withClient(async (client) => {
      const addressId = Number(rawAddressId);
      if (!Number.isInteger(addressId) || addressId <= 0) {
        throw new ValidationError('Invalid address id');
      }

      const userId = await ensureUserRow(client, uid);

      await client.query('BEGIN');
      try {
        const target = await client.query(
          `
          SELECT id, is_default
          FROM user_addresses
          WHERE id = $1 AND user_id = $2
          `,
          [addressId, userId],
        );
        if (target.rowCount === 0) {
          throw new NotFoundError('Address not found');
        }

        const countRes = await client.query(
          `SELECT COUNT(*)::int AS total FROM user_addresses WHERE user_id = $1`,
          [userId],
        );
        const totalAddresses = Number(countRes.rows[0]?.total || 0);

        if (totalAddresses <= 1) {
          const activeOrdersRes = await client.query(
            `
            SELECT COUNT(*)::int AS active_count
            FROM orders
            WHERE firebase_uid = $1
              AND status = ANY($2::text[])
            `,
            [uid, ACTIVE_ORDER_STATUSES],
          );
          const activeCount = Number(activeOrdersRes.rows[0]?.active_count || 0);
          if (activeCount > 0) {
            throw new ConflictError('Cannot delete the last address while you have active orders');
          }
        }

        const linkedActiveOrdersRes = await client.query(
          `
          SELECT COUNT(*)::int AS active_count
          FROM orders
          WHERE firebase_uid = $1
            AND delivery_address_id = $2
            AND status = ANY($3::text[])
          `,
          [uid, addressId, ACTIVE_ORDER_STATUSES],
        );
        const linkedActiveCount = Number(linkedActiveOrdersRes.rows[0]?.active_count || 0);
        if (linkedActiveCount > 0) {
          throw new ConflictError('Cannot delete an address used by active orders');
        }

        let fallbackDefault = null;
        if (target.rows[0].is_default && totalAddresses > 1) {
          const fallbackRes = await client.query(
            `
            UPDATE user_addresses
            SET is_default = TRUE, updated_at = NOW()
            WHERE id = (
              SELECT id
              FROM user_addresses
              WHERE user_id = $1
                AND id <> $2
              ORDER BY updated_at DESC, id DESC
              LIMIT 1
            )
            RETURNING id, user_id, label, lat, lng, full_address, is_default, created_at, updated_at
            `,
            [userId, addressId],
          );
          fallbackDefault = fallbackRes.rows[0] || null;
        }

        await client.query(`DELETE FROM user_addresses WHERE id = $1 AND user_id = $2`, [
          addressId,
          userId,
        ]);
        await client.query('COMMIT');
        return { ok: true, deleted: true, fallback_default: fallbackDefault };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw error;
      }
    });
  }

  return {
    autocomplete,
    placeDetails,
    reverseGeocode,
    listAddresses,
    getDefaultAddress,
    createAddress,
    setDefaultAddress,
    updateAddress,
    deleteAddress,
  };
}

module.exports = {
  createAddressService,
};
