'use client';

import { create } from 'zustand';

interface UIState {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: false,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  closeSidebar: () => set({ isSidebarOpen: false }),
}));

interface AuthUser {
  uid: string;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  authReady: boolean;
  setUser: (user: AuthUser) => void;
  setAuthReady: (ready: boolean) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  authReady: false,
  setUser: (user) => set({ user }),
  setAuthReady: (ready) => set({ authReady: ready }),
  clearUser: () => set({ user: null }),
}));
