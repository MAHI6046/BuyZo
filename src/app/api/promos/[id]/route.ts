import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const promoId = String(id || '').trim();
  if (!promoId) {
    return NextResponse.json({ error: 'Invalid promo id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const payload = await backendAdminFetchJson<{ promo?: unknown }>(`/api/admin/promos/${promoId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return NextResponse.json(payload.promo || null);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
