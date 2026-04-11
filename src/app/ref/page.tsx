'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

function sanitizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function ReferralLandingContent() {
  const searchParams = useSearchParams();
  const referralCode = useMemo(
    () => sanitizeReferralCode(searchParams.get('code') || ''),
    [searchParams],
  );

  const inviteLink = referralCode
    ? `https://share.dotdelivery.com.au/ref?code=${encodeURIComponent(referralCode)}`
    : 'https://share.dotdelivery.com.au/ref';

  const handleCopyCode = async () => {
    if (!referralCode) return;
    await navigator.clipboard.writeText(referralCode);
    window.alert('Referral code copied');
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(inviteLink);
    window.alert('Invite link copied');
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-6 py-12 text-center">
        <p className="mb-3 rounded-full border border-white/20 px-3 py-1 text-xs tracking-[0.2em] text-white/70">
          BuyZo
        </p>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
          Refer friends. Earn free delivery credits.
        </h1>
        <p className="mt-3 max-w-md text-sm text-white/75 sm:text-base">
          Share your code with a friend. When they complete their first successful order, both of
          you get delivery credits.
        </p>

        <div className="mt-8 w-full rounded-2xl border border-white/15 bg-white/5 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-white/60">Referral Code</p>
          <p className="mt-2 break-all text-3xl font-black tracking-[0.08em]">
            {referralCode || 'NO CODE'}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleCopyCode}
              disabled={!referralCode}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-zinc-700"
            >
              Copy Code
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/25 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Copy Link
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left text-sm text-white/80">
          <p className="font-semibold text-white">How to use</p>
          <p className="mt-1">1. Open the DOT app</p>
          <p>2. Sign up / login</p>
          <p>3. Enter this referral code during referral claim</p>
        </div>
      </section>
    </main>
  );
}

function ReferralFallback() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-6 py-12 text-center">
        <p className="text-sm text-white/75">Loading referral...</p>
      </section>
    </main>
  );
}

export default function ReferralLandingPage() {
  return (
    <Suspense fallback={<ReferralFallback />}>
      <ReferralLandingContent />
    </Suspense>
  );
}
