import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const params = new URLSearchParams();

    const limit = String(searchParams.get('limit') || '').trim();
    const cursor = String(searchParams.get('cursor') || '').trim();
    const status = String(searchParams.get('status') || '').trim();
    const paymentStatus = String(searchParams.get('payment_status') || '').trim();
    if (limit) params.set('limit', limit);
    if (cursor) params.set('cursor', cursor);
    if (status) params.set('status', status);
    if (paymentStatus) params.set('payment_status', paymentStatus);

    const query = params.toString();
    const payload = await backendAdminFetchJson<{
      orders?: unknown[];
      page_info?: {
        limit?: number;
        has_more?: boolean;
        next_cursor?: string | null;
        total_returned?: number;
      };
    }>(`/api/admin/orders${query ? `?${query}` : ''}`);

    return NextResponse.json({
      orders: payload.orders || [],
      page_info: payload.page_info || {
        limit: Number(limit) || 30,
        has_more: false,
        next_cursor: null,
        total_returned: Array.isArray(payload.orders) ? payload.orders.length : 0,
      },
    });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
