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
  const slabId = Number(id);
  if (!Number.isFinite(slabId) || slabId <= 0) {
    return NextResponse.json({ error: 'Invalid slab id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const payload = await backendAdminFetchJson<{ slab?: unknown }>(
      `/api/admin/delivery-fee-slabs/${slabId}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    );
    return NextResponse.json(payload.slab || null);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
