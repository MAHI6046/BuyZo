import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const payload = await backendAdminFetchJson<{ promos?: unknown[] }>('/api/admin/promos');
    return NextResponse.json(payload.promos || []);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const payload = await backendAdminFetchJson<{ promo?: unknown }>('/api/admin/promos', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(payload.promo || null, { status: 201 });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
