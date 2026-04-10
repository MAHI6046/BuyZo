const { createHash } = require('crypto');

function parseNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundCurrencyAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function generateOrderIntegrityHash({ items, totalAmount, currency, fallbackCurrency = 'inr' }) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const canonicalItems = normalizedItems
    .map((item) => {
      const productId = Number(item?.product_id);
      const quantity = Number(item?.quantity);
      const unitPrice = roundCurrencyAmount(Number(item?.unit_price));
      if (!Number.isInteger(productId) || productId <= 0) return null;
      if (!Number.isInteger(quantity) || quantity <= 0) return null;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
      return `${productId}:${quantity}:${unitPrice.toFixed(2)}`;
    })
    .filter(Boolean)
    .sort();
  const safeTotalAmount = roundCurrencyAmount(Number(totalAmount));
  const normalizedCurrency =
    String(currency || fallbackCurrency).trim().toLowerCase() || fallbackCurrency;
  const canonicalPayload = `${canonicalItems.join('|')}|total:${safeTotalAmount.toFixed(2)}|currency:${normalizedCurrency}`;
  return createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}

function coerceFeeType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'flat' ? 'flat' : 'percentage';
}

function parseSqlTimeOrNull(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3] || 0);
  return { hh, mm, ss };
}

function timeInWindow({ nowSeconds, startSeconds, endSeconds }) {
  if (startSeconds === null || endSeconds === null) return true;
  if (startSeconds === endSeconds) return true;
  if (startSeconds < endSeconds) {
    return nowSeconds >= startSeconds && nowSeconds <= endSeconds;
  }
  return nowSeconds >= startSeconds || nowSeconds <= endSeconds;
}

function toTimeSegments(startTime, endTime) {
  const start = parseSqlTimeOrNull(startTime);
  const end = parseSqlTimeOrNull(endTime);
  if (!start || !end) {
    return [[0, 86400]];
  }
  const startSeconds = start.hh * 3600 + start.mm * 60 + start.ss;
  const endSeconds = end.hh * 3600 + end.mm * 60 + end.ss;
  if (startSeconds === endSeconds) {
    return [[0, 86400]];
  }
  if (startSeconds < endSeconds) {
    return [[startSeconds, endSeconds]];
  }
  return [
    [startSeconds, 86400],
    [0, endSeconds],
  ];
}

function segmentsOverlap(segmentsA, segmentsB) {
  for (const [aStart, aEnd] of segmentsA) {
    for (const [bStart, bEnd] of segmentsB) {
      if (aStart < bEnd && bStart < aEnd) {
        return true;
      }
    }
  }
  return false;
}

function amountRangesOverlap(minA, maxA, minB, maxB) {
  return Math.max(minA, minB) <= Math.min(maxA, maxB);
}

function optionalDimensionOverlaps(valueA, valueB) {
  const a = valueA ? String(valueA).trim().toLowerCase() : null;
  const b = valueB ? String(valueB).trim().toLowerCase() : null;
  if (!a || !b) return true;
  return a === b;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

module.exports = {
  parseNullableNumber,
  roundCurrencyAmount,
  generateOrderIntegrityHash,
  coerceFeeType,
  parseSqlTimeOrNull,
  timeInWindow,
  toTimeSegments,
  segmentsOverlap,
  amountRangesOverlap,
  optionalDimensionOverlaps,
  haversineDistanceKm,
};
