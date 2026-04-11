import { NextResponse } from 'next/server';

interface BackendApiErrorPayload {
  ok?: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export class BackendAdminApiError extends Error {
  status: number;
  payload: BackendApiErrorPayload;
  backendUrl?: string;

  constructor(status: number, payload: BackendApiErrorPayload, backendUrl?: string) {
    super(String(payload?.message || payload?.error || 'Backend admin API request failed'));
    this.status = status;
    this.payload = payload;
    this.backendUrl = backendUrl;
  }
}

function getBackendBaseUrl() {
  const configured = String(
    process.env.BACKEND_BASE_URL || process.env.NEXT_PUBLIC_BACKEND_BASE_URL || '',
  ).trim();
  const fallbackDefault =
    process.env.NODE_ENV === 'production'
      ? 'https://anydot-backend.vercel.app'
      : 'http://localhost:3000';
  const value = configured || fallbackDefault;
  return value.replace(/\/$/, '');
}

function getBackendFallbackBaseUrl(primaryBaseUrl: string): string | null {
  const configuredFallback = String(process.env.BACKEND_FALLBACK_BASE_URL || '').trim();
  const candidates = [
    configuredFallback,
    'https://share.dotdelivery.com.au',
    'https://anydot-backend.vercel.app',
  ]
    .map((value) => value.replace(/\/$/, ''))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate !== primaryBaseUrl) {
      return candidate;
    }
  }
  return null;
}

function getBackendAdminKey() {
  const key = String(process.env.ADMIN_PORTAL_API_KEY || '').trim();
  if (!key) {
    throw new BackendAdminApiError(500, {
      ok: false,
      message: 'ADMIN_PORTAL_API_KEY is not configured on admin portal server',
    });
  }
  return key;
}

export async function backendAdminFetchJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('x-admin-portal-key', getBackendAdminKey());

  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const requestOnce = async (baseUrl: string): Promise<T> => {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    console.log('[backend-admin-api] request', {
      url,
      path,
      hasAdminKey: Boolean(String(process.env.ADMIN_PORTAL_API_KEY || '').trim()),
    });
    const response = await fetch(url, {
      ...options,
      headers,
      cache: 'no-store',
    });

    const text = await response.text();
    let payload: BackendApiErrorPayload;
    if (!text) {
      payload = { ok: false, message: 'Empty backend response' };
    } else {
      try {
        payload = JSON.parse(text) as BackendApiErrorPayload;
      } catch {
        payload = { ok: false, message: 'Invalid backend response payload' };
      }
    }

    if (!response.ok) {
      console.log('[backend-admin-api] response error', {
        url,
        status: response.status,
        payload,
      });
      throw new BackendAdminApiError(response.status, payload, baseUrl);
    }

    console.log('[backend-admin-api] response ok', {
      url,
      status: response.status,
    });

    return payload as T;
  };

  const primaryBaseUrl = getBackendBaseUrl();
  const tried = new Set<string>();
  const attemptedHosts = [];
  let currentBaseUrl: string | null = primaryBaseUrl;
  let lastError: unknown = null;

  while (currentBaseUrl && !tried.has(currentBaseUrl)) {
    tried.add(currentBaseUrl);
    attemptedHosts.push(currentBaseUrl);
    try {
      return await requestOnce(currentBaseUrl);
    } catch (error) {
      lastError = error;
      const retriable =
        error instanceof BackendAdminApiError &&
        error.status === 404;
      if (!retriable) {
        throw error;
      }
      currentBaseUrl = getBackendFallbackBaseUrl(currentBaseUrl);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new BackendAdminApiError(502, {
        ok: false,
        message: `Unable to reach backend admin API (attempted: ${attemptedHosts.join(', ')})`,
      });
}

export function toBackendErrorResponse(error: unknown) {
  if (error instanceof BackendAdminApiError) {
    return NextResponse.json(
      {
        error: String(error.payload?.message || error.payload?.error || error.message),
      },
      { status: error.status },
    );
  }

  console.error('Backend admin fetch unhandled error:', error);
  return NextResponse.json(
    { 
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : String(error)
    }, 
    { status: 500 }
  );
}
