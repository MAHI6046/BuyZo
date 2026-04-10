import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const body = await request.json();
    const name =
      typeof body?.name === 'undefined' ? undefined : String(body?.name || '').trim();
    const image_url =
      typeof body?.image_url === 'undefined'
        ? undefined
        : String(body?.image_url || '').trim() || null;
    const is_active =
      typeof body?.is_active === 'boolean' ? Boolean(body?.is_active) : undefined;

    const payload = await backendAdminFetchJson<{ category?: unknown }>(
      `/api/admin/categories/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...(typeof name !== 'undefined' ? { name } : {}),
          ...(typeof image_url !== 'undefined' ? { image_url } : {}),
          ...(typeof is_active !== 'undefined' ? { is_active } : {}),
        }),
      },
    );

    return NextResponse.json(payload.category || null);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    await backendAdminFetchJson(`/api/admin/categories/${id}`, {
      method: 'DELETE',
    });
    return NextResponse.json({ ok: true, deleted: true });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
