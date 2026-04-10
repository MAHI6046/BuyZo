import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  backendAdminFetchJson,
  toBackendErrorResponse,
} from '@/lib/backend-admin-api';

type DashboardStatsPayload = {
  stats?: {
    totalProducts?: number;
    activeProducts?: number;
    totalCategories?: number;
    lowStock?: number;
  };
};

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const payload = await backendAdminFetchJson<DashboardStatsPayload>(
      '/api/admin/dashboard-stats',
    );

    return NextResponse.json({
      totalProducts: Number(payload.stats?.totalProducts || 0),
      activeProducts: Number(payload.stats?.activeProducts || 0),
      totalCategories: Number(payload.stats?.totalCategories || 0),
      lowStock: Number(payload.stats?.lowStock || 0),
    });
  } catch (error) {
    return toBackendErrorResponse(error);
  }
}
