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
    const payload = await backendAdminFetchJson<{ current?: unknown }>(
      '/api/admin/fee-rules',
    );
    return NextResponse.json(payload.current || null);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const payload = await backendAdminFetchJson<{ fee_rule?: unknown }>(
      '/api/admin/fee-rules/current',
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    );
    return NextResponse.json(payload.fee_rule || null);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
