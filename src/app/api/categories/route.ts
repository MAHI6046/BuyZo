import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const payload = await backendAdminFetchJson<{ categories?: unknown[] }>(
      '/api/admin/categories',
    );
    return NextResponse.json(payload.categories || []);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const name = String(body?.name || '').trim();
    const image_url = String(body?.image_url || '').trim();
    const payload = await backendAdminFetchJson<{ category?: unknown }>(
      '/api/admin/categories',
      {
        method: 'POST',
        body: JSON.stringify({ name, image_url: image_url || null }),
      },
    );

    return NextResponse.json(payload.category || null, { status: 201 });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
