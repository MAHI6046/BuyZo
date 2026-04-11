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
    const payload = await backendAdminFetchJson<{ slabs?: unknown[] }>(
      '/api/admin/delivery-fee-slabs',
    );
    return NextResponse.json(payload.slabs || []);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const payload = await backendAdminFetchJson<{ slab?: unknown }>(
      '/api/admin/delivery-fee-slabs',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    return NextResponse.json(payload.slab || null, { status: 201 });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
