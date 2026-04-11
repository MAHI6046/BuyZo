'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { ShieldCheck, Mail, Lock } from 'lucide-react';
import { getFirebaseClientAuth } from '@/lib/firebase-client';
import { useAuthStore } from '@/lib/store';

function getFirebaseErrorDetails(error: unknown): { code: string; message: string } {
  const code = String((error as { code?: string } | undefined)?.code || '').trim();
  const message = String((error as { message?: string } | undefined)?.message || '').trim();
  return { code, message };
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setUser = useAuthStore((state) => state.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const getNextPath = () => {
    const nextPath = searchParams.get('next') || '/';
    if (!nextPath.startsWith('/')) {
      return '/';
    }
    return nextPath;
  };

  const handleLogin = async () => {
    setErrorMessage('');

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setErrorMessage('Enter a valid email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const auth = getFirebaseClientAuth();
      const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      const idToken = await credential.user.getIdToken(true);

      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      const payload = (await response.json()) as {
        error?: string;
        user?: { uid?: string; email?: string };
      };

      if (!response.ok || !payload.user?.uid || !payload.user?.email) {
        await signOut(auth);
        setErrorMessage(payload.error || 'Login failed. This email may not be approved for admin access.');
        return;
      }

      setUser({ uid: payload.user.uid, email: payload.user.email });
      router.replace(getNextPath());
      router.refresh();
    } catch (error: unknown) {
      const { code, message } = getFirebaseErrorDetails(error);

      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setErrorMessage('Invalid email or password.');
      } else if (code === 'auth/user-not-found') {
        setErrorMessage('No Firebase account found for this email.');
      } else if (code === 'auth/invalid-email') {
        setErrorMessage('Email format is invalid.');
      } else if (code === 'auth/too-many-requests') {
        setErrorMessage('Too many attempts. Please wait and try again.');
      } else if (code === 'auth/operation-not-allowed') {
        setErrorMessage('Email/password sign-in is not enabled in Firebase Auth.');
      } else {
        setErrorMessage(`Unable to sign in. ${code ? `(${code}) ` : ''}${message || 'Please try again.'}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-white to-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-border rounded-3xl shadow-xl p-8 space-y-6">
        <div className="space-y-2 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">Admin Sign In</h1>
          <p className="text-sm text-foreground/50">
            Login is restricted to approved admin email addresses.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block text-sm font-semibold text-foreground/70">Email</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-foreground/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-surface/30 focus:bg-white focus:border-primary/30 focus:ring-2 focus:ring-primary/10 outline-none"
            />
          </div>

          <label className="block text-sm font-semibold text-foreground/70">Password</label>
          <div className="relative">
            <Lock className="w-4 h-4 text-foreground/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-surface/30 focus:bg-white focus:border-primary/30 focus:ring-2 focus:ring-primary/10 outline-none"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleLogin();
                }
              }}
            />
          </div>

          <button
            onClick={handleLogin}
            disabled={isSubmitting}
            className="w-full bg-primary text-white py-3 rounded-xl font-bold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </div>

        {errorMessage ? <p className="text-sm text-red-600 text-center">{errorMessage}</p> : null}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
