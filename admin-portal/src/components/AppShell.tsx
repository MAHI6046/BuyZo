'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useAuthStore } from '@/lib/store';

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground/60">
      <div className="text-center space-y-2">
        <div className="h-10 w-10 mx-auto rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        <p className="text-sm font-medium">Validating session...</p>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const clearUser = useAuthStore((state) => state.clearUser);
  const [checkingSession, setCheckingSession] = useState(true);

  const isLoginPage = pathname === '/login';
  const isPublicReferralPage = pathname === '/ref';
  const isPublicPage = isLoginPage || isPublicReferralPage;

  useEffect(() => {
    let cancelled = false;

    async function validateSession() {
      if (isPublicPage) {
        setCheckingSession(false);
        return;
      }

      setCheckingSession(true);
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (response.ok) {
          const payload = (await response.json()) as {
            user?: { uid?: string; email?: string };
          };

          const uid = String(payload?.user?.uid || '').trim();
          const email = String(payload?.user?.email || '').trim();
          if (uid && email) {
            setUser({ uid, email });
          }

          if (!cancelled) {
            setCheckingSession(false);
          }
          return;
        }
      } catch {
        // Intentional no-op. Redirect happens below.
      }

      clearUser();
      if (!cancelled) {
        const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
        router.replace(`/login${next}`);
      }
    }

    void validateSession();

    return () => {
      cancelled = true;
    };
  }, [clearUser, isPublicPage, pathname, router, setUser]);

  if (isPublicPage) {
    return <main className="min-h-screen">{children}</main>;
  }

  if (checkingSession) {
    return <FullPageLoader />;
  }

  return (
    <>
      <Sidebar />
      <div className="lg:pl-64 min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 p-4 md:p-8">{children}</main>
        <footer className="px-4 md:px-8 py-6 border-t border-border bg-surface/50 text-center">
          <p className="text-sm text-foreground/40">
            © {new Date().getFullYear()} DOT Commerce. All rights reserved.
          </p>
        </footer>
      </div>
    </>
  );
}
