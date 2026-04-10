import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

type TopItemsPayload = {
  filters?: {
    start_date?: string;
    end_date?: string;
    limit?: number;
  };
  top_by_order_count?: unknown[];
  most_repeated_items?: unknown[];
  most_valued_items?: unknown[];
};

export async function GET(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const params = new URLSearchParams();
    const startDate = String(searchParams.get('start_date') || '').trim();
    const endDate = String(searchParams.get('end_date') || '').trim();
    const limit = String(searchParams.get('limit') || '').trim();
    const page = String(searchParams.get('page') || '').trim();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    if (limit) params.set('limit', limit);
    if (page) params.set('page', page);

    const query = params.toString();
    const path = `/api/admin/analytics/top-items${query ? `?${query}` : ''}`;
    const payload = await backendAdminFetchJson<TopItemsPayload>(path);

    return NextResponse.json({
      filters: payload.filters || {},
      top_by_order_count: payload.top_by_order_count || [],
      most_repeated_items: payload.most_repeated_items || [],
      most_valued_items: payload.most_valued_items || [],
    });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
