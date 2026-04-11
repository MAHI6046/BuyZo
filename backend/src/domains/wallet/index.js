function buildWalletSnapshotRow(row, { normalizeReferralCode, roundCurrencyAmount }) {
  if (!row) return null;
  const orderCreditsTotalBalance = Math.max(
    0,
    roundCurrencyAmount(
      Number((row.order_credits_total_balance ?? row.order_credits_balance) || 0),
    ),
  );
  const orderCreditsAvailableBalance = Math.max(
    0,
    roundCurrencyAmount(
      Number((row.order_credits_available_balance ?? row.order_credits_balance) || 0),
    ),
  );
  return {
    firebaseUid: String(row.firebase_uid || '').trim(),
    referralCode: normalizeReferralCode(row.referral_code || '') || null,
    referredByCode: normalizeReferralCode(row.referred_by_code || '') || null,
    deliveryCreditsBalance: Math.max(0, Number(row.delivery_credits_balance || 0)),
    orderCreditsBalance: orderCreditsAvailableBalance,
    orderCreditsAvailableBalance,
    orderCreditsTotalBalance,
  };
}

module.exports = {
  buildWalletSnapshotRow,
};
