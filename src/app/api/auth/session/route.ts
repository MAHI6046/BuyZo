import { NextRequest, NextResponse } from 'next/server';
import { createSessionFromIdToken } from '@/lib/admin-auth';
import { ADMIN_SESSION_COOKIE_NAME } from '@/lib/admin-auth-constants';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;
const SESSION_EXPIRES_MS = SESSION_MAX_AGE_SECONDS * 1000;

function setSessionCookie(response: NextResponse, sessionCookieValue: string, maxAge: number) {
  response.cookies.set(ADMIN_SESSION_COOKIE_NAME, sessionCookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let idToken = '';
  try {
    const body = (await request.json()) as { idToken?: string };
    idToken = String(body?.idToken || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const sessionResult = await createSessionFromIdToken({
    idToken,
    expiresInMs: SESSION_EXPIRES_MS,
  });

  if (!sessionResult.ok) {
    return NextResponse.json({ error: sessionResult.message }, { status: sessionResult.status });
  }

  const response = NextResponse.json({ ok: true, user: sessionResult.user });
  setSessionCookie(response, sessionResult.sessionCookie, SESSION_MAX_AGE_SECONDS);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, '', 0);
  return response;
}
