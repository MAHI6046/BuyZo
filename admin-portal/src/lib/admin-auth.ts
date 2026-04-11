import type { DecodedIdToken } from 'firebase-admin/auth';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE_NAME } from '@/lib/admin-auth-constants';
import { getFirebaseAdminAuth } from '@/lib/firebase-admin';

const allowedEmailsCache: {
  raw: string;
  emails: Set<string>;
} = {
  raw: '',
  emails: new Set<string>(),
};

function parseBooleanEnv(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === 'true';
}

const verifySessionRevocation = parseBooleanEnv(
  process.env.ADMIN_VERIFY_SESSION_REVOCATION,
  false,
);

export interface AdminSession {
  uid: string;
  email: string;
  token: DecodedIdToken;
}

export function normalizeEmail(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const trimmed = rawValue.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    return null;
  }

  return trimmed;
}

function getAllowedEmailsRawConfig(): string {
  return String(
    process.env.ADMIN_ALLOWED_EMAILS || process.env.ADMIN_ALLOWED_EMAIL_ADDRESSES || '',
  );
}

export function getAllowedAdminEmails(): Set<string> {
  const raw = getAllowedEmailsRawConfig();
  if (raw === allowedEmailsCache.raw) {
    return allowedEmailsCache.emails;
  }

  const emails = new Set<string>();
  for (const entry of raw.split(/[\n,;]/)) {
    const normalized = normalizeEmail(entry);
    if (normalized) {
      emails.add(normalized);
    }
  }

  allowedEmailsCache.raw = raw;
  allowedEmailsCache.emails = emails;
  return emails;
}

export function isAllowedAdminEmail(email: unknown): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  const allowList = getAllowedAdminEmails();
  if (allowList.size === 0) {
    return false;
  }

  return allowList.has(normalized);
}

export async function createSessionFromIdToken({
  idToken,
  expiresInMs,
}: {
  idToken: string;
  expiresInMs: number;
}): Promise<
  | {
      ok: true;
      sessionCookie: string;
      user: { uid: string; email: string };
    }
  | {
      ok: false;
      status: number;
      message: string;
    }
> {
  const trimmedToken = idToken.trim();
  if (!trimmedToken) {
    return { ok: false, status: 400, message: 'Missing Firebase ID token' };
  }

  if (getAllowedAdminEmails().size === 0) {
    return {
      ok: false,
      status: 500,
      message: 'Admin email allowlist is not configured on server',
    };
  }

  try {
    const auth = getFirebaseAdminAuth();
    const decoded = await auth.verifyIdToken(trimmedToken);
    const email = normalizeEmail(decoded.email);

    if (!email) {
      return {
        ok: false,
        status: 403,
        message: 'This account does not have an email address',
      };
    }

    if (!isAllowedAdminEmail(email)) {
      return {
        ok: false,
        status: 403,
        message: 'This email is not allowed for admin access',
      };
    }

    const sessionCookie = await auth.createSessionCookie(trimmedToken, {
      expiresIn: expiresInMs,
    });

    return {
      ok: true,
      sessionCookie,
      user: {
        uid: decoded.uid,
        email,
      },
    };
  } catch (error: unknown) {
    const firebaseCode = String((error as { code?: string } | undefined)?.code || '').trim();
    const message = String((error as { message?: string } | undefined)?.message || '');
    console.error('Admin email session creation failed', {
      code: firebaseCode || 'unknown',
      message,
    });

    if (message.includes('Firebase Admin is not configured')) {
      return {
        ok: false,
        status: 500,
        message: 'Firebase Admin auth is not configured on server',
      };
    }

    if (message.includes('credential')) {
      return {
        ok: false,
        status: 500,
        message: 'Firebase Admin credentials are invalid or missing',
      };
    }

    if (firebaseCode.startsWith('auth/')) {
      return {
        ok: false,
        status: 401,
        message: `Unable to verify login token (${firebaseCode})`,
      };
    }

    return {
      ok: false,
      status: 401,
      message: 'Invalid or expired login session. Please login again.',
    };
  }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value || '';
    console.log('[admin-auth] getAdminSession', {
      hasSessionCookie: Boolean(sessionCookie),
      cookieLength: sessionCookie.length,
    });
    if (!sessionCookie) {
      return null;
    }

    const decoded = await getFirebaseAdminAuth().verifySessionCookie(
      sessionCookie,
      verifySessionRevocation,
    );
    console.log('[admin-auth] verifySessionCookie ok', {
      uid: decoded.uid,
      email: decoded.email,
    });
    const email = normalizeEmail(decoded.email);
    if (!email || !isAllowedAdminEmail(email)) {
      console.log('[admin-auth] email not allowed', { email });
      return null;
    }

    return {
      uid: decoded.uid,
      email,
      token: decoded,
    };
  } catch {
    return null;
  }
}

export async function requireAdminSession(): Promise<
  | { ok: true; session: AdminSession }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized. Please sign in with an allowed admin email.' },
        { status: 401 },
      ),
    };
  }

  return { ok: true, session };
}
