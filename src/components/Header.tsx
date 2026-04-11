'use client';

import React, { useMemo, useState } from 'react';
import { Search, Bell, User, Menu, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { getFirebaseClientAuth } from '@/lib/firebase-client';
import { useAuthStore, useUIStore } from '@/lib/store';

export default function Header() {
  const router = useRouter();
  const { toggleSidebar } = useUIStore();
  const user = useAuthStore((state) => state.user);
  const clearUser = useAuthStore((state) => state.clearUser);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const displayEmail = useMemo(() => {
    return user?.email || 'Unknown email';
  }, [user?.email]);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } catch {
      // Best-effort cookie clear.
    }

    try {
      await signOut(getFirebaseClientAuth());
    } catch {
      // Firebase signout is best-effort too.
    }

    clearUser();
    router.replace('/login');
    router.refresh();
    setIsLoggingOut(false);
  };

  return (
    <header className="h-20 bg-white/80 backdrop-blur-md border-b border-border sticky top-0 z-40 px-4 md:px-8">
      <div className="h-full flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1">
          <button
            onClick={toggleSidebar}
            className="lg:hidden p-2 hover:bg-surface rounded-xl text-foreground/60 transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="flex-1 max-w-xl hidden md:block">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/30 group-focus-within:text-primary transition-colors" />
              <input
                type="text"
                placeholder="Search..."
                className="w-full bg-surface border border-transparent focus:border-primary/20 focus:bg-white px-12 py-2.5 rounded-xl outline-none transition-all text-sm"
              />
            </div>
          </div>

          <button className="md:hidden p-2 hover:bg-surface rounded-xl text-foreground/60 transition-colors">
            <Search className="w-6 h-6" />
          </button>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <button className="p-2 md:p-2.5 hover:bg-surface rounded-xl text-foreground/60 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-primary rounded-full border-2 border-white"></span>
          </button>

          <div className="h-8 w-[1px] bg-border mx-1 md:mx-2"></div>

          <button className="flex items-center gap-3 p-1.5 hover:bg-surface rounded-xl transition-colors">
            <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div className="text-left hidden lg:block">
              <p className="text-sm font-semibold text-foreground leading-none">Admin</p>
              <p className="text-xs text-foreground/40 mt-1">{displayEmail}</p>
            </div>
          </button>

          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-foreground/60 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors text-sm font-semibold disabled:opacity-60"
          >
            <LogOut className="w-4 h-4" />
            {isLoggingOut ? 'Signing out...' : 'Logout'}
          </button>
        </div>
      </div>
    </header>
  );
}
