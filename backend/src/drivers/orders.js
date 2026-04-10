function createDriverOrderUtils({
  pool,
  normalizePhoneNumber,
  parseInteger,
  clamp,
  defaultVisibleLimit,
}) {
  async function isApprovedDriverPhone(phoneNumber) {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) return false;
    const result = await pool.query(
      `
      SELECT 1
      FROM driver_access
      WHERE phone_number = $1
        AND is_active = TRUE
      LIMIT 1
      `,
      [normalizedPhone],
    );
    return result.rowCount > 0;
  }

  async function resolveUserRole(phoneNumber) {
    const isApprovedDriver = await isApprovedDriverPhone(phoneNumber);
    return isApprovedDriver ? 'driver' : 'customer';
  }

  async function archiveDeliveredOrdersForDriver(firebaseUid, keepCount = defaultVisibleLimit) {
    const normalizedUid = String(firebaseUid || '').trim();
    if (!normalizedUid) return 0;
    const safeKeepCount = clamp(parseInteger(keepCount, defaultVisibleLimit), 1, defaultVisibleLimit);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      const updatedFlags = await client.query(
        `
        WITH ranked AS (
          SELECT
            o.id,
            ROW_NUMBER() OVER (
              ORDER BY COALESCE(o.delivered_at, o.updated_at, o.created_at) DESC, o.id DESC
            ) AS rank_num
          FROM orders o
          WHERE o.assigned_driver_uid = $1
            AND o.status = 'delivered'
        )
        UPDATE orders o
        SET
          driver_executed_archived_at = CASE
            WHEN ranked.rank_num > $2 THEN COALESCE(o.driver_executed_archived_at, NOW())
            ELSE NULL
          END,
          updated_at = CASE
            WHEN ranked.rank_num > $2 AND o.driver_executed_archived_at IS NULL THEN NOW()
            WHEN ranked.rank_num <= $2 AND o.driver_executed_archived_at IS NOT NULL THEN NOW()
            ELSE o.updated_at
          END
        FROM ranked
        WHERE o.id = ranked.id
          AND (
            (ranked.rank_num > $2 AND o.driver_executed_archived_at IS NULL)
            OR (ranked.rank_num <= $2 AND o.driver_executed_archived_at IS NOT NULL)
          )
        RETURNING o.id
        `,
        [normalizedUid, safeKeepCount],
      );

      await client.query('COMMIT');
      return updatedFlags.rowCount;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {}
      if (error?.code === '55P03') {
        console.warn(`Driver executed flag sync skipped for ${normalizedUid}: lock timeout`);
        return 0;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    isApprovedDriverPhone,
    resolveUserRole,
    archiveDeliveredOrdersForDriver,
  };
}

module.exports = { createDriverOrderUtils };
