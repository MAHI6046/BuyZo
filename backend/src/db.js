const { Pool } = require('pg');

function normalizePostgresConnectionString(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return value;

  try {
    const parsed = new URL(value);
    const sslMode = String(parsed.searchParams.get('sslmode') || '').trim().toLowerCase();
    const usesLibpqCompat =
      String(parsed.searchParams.get('uselibpqcompat') || '').trim().toLowerCase() === 'true';

    if (sslMode === 'require' && !usesLibpqCompat) {
      parsed.searchParams.set('sslmode', 'verify-full');
      return parsed.toString();
    }
    return value;
  } catch (_error) {
    // Fall back to input value if URL parsing fails.
    return value;
  }
}

const rawConnectionString = String(process.env.POSTGRES_URL || '').trim();
if (!rawConnectionString) {
  throw new Error('POSTGRES_URL is required');
}
const connectionString = normalizePostgresConnectionString(rawConnectionString);

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

module.exports = { pool };
