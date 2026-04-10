import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const fileName = String(body?.fileName || '').trim();
    const contentType = String(body?.contentType || '').trim();
    const folder = String(body?.folder || 'products').trim();
    const payload = await backendAdminFetchJson<{
      ok?: boolean;
      key?: string;
      uploadUrl?: string;
      publicUrl?: string;
    }>('/api/admin/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        fileName: fileName || `upload-${Date.now()}.jpg`,
        contentType: contentType || 'image/jpeg',
        folder: folder || 'products',
      }),
    });

    return NextResponse.json(payload);
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
