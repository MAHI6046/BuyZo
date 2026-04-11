import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const folder = String(formData.get('folder') || 'products').trim() || 'products';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const fileName = String(file.name || `upload-${Date.now()}.jpg`).trim();
    const contentType = String(file.type || 'image/jpeg').trim() || 'image/jpeg';

    const signed = await backendAdminFetchJson<{
      ok?: boolean;
      key?: string;
      uploadUrl?: string;
      publicUrl?: string;
    }>('/api/admin/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        fileName,
        contentType,
        folder,
      }),
    });

    if (!signed?.uploadUrl || !signed?.publicUrl) {
      return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 502 });
    }

    const body = Buffer.from(await file.arrayBuffer());
    const uploadRes = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body,
    });

    if (!uploadRes.ok) {
      const details = await uploadRes.text().catch(() => '');
      return NextResponse.json(
        {
          error: `Cloudflare upload failed (${uploadRes.status})`,
          details: details.slice(0, 500),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      key: signed.key || null,
      publicUrl: signed.publicUrl,
    });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
