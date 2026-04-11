import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

type AnalyticsPayload = {
  filters?: {
    start_date?: string;
    end_date?: string;
  };
  metrics?: Record<string, unknown>;
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
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const query = params.toString();
    const path = `/api/admin/analytics/metrics${query ? `?${query}` : ''}`;
    const payload = await backendAdminFetchJson<AnalyticsPayload>(path);

    return NextResponse.json({
      filters: payload.filters || {},
      metrics: payload.metrics || {},
    });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
