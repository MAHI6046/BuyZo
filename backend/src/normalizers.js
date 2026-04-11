const FAVORITE_BOOK_LABEL_MAX_LENGTH = 40;

function coercePromoDiscountType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'flat' ? 'flat' : 'percentage';
}

function normalizePromoCodeForStorage(value) {
  return String(value || '').trim().toUpperCase();
}

function parseOptionalTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizePhoneNumber(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+91${digits.slice(1)}`;
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  return `+${digits}`;
}

function normalizeDisplayName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePromoCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeReferralCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeFavoriteBookLabel(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, FAVORITE_BOOK_LABEL_MAX_LENGTH);
}

module.exports = {
  coercePromoDiscountType,
  normalizePromoCodeForStorage,
  parseOptionalTimestamp,
  normalizePhoneNumber,
  normalizeDisplayName,
  normalizePromoCode,
  normalizeReferralCode,
  normalizeFavoriteBookLabel,
};
