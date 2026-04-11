'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

const PAGE_SIZE = 30;

type OrderRow = {
  id: number | string;
  firebase_uid: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  currency: string | null;
  item_total: number;
  subtotal: number;
  delivery_fee: number;
  platform_fee: number;
  discount_amount: number;
  order_credit_used_amount: number;
  total_amount: number;
  created_at: string;
};

type OrdersApiResponse = {
  orders?: OrderRow[];
  page_info?: {
    has_more?: boolean;
    next_cursor?: string | null;
  };
};

const ORDER_STATUSES = [
  'all',
  'pending',
  'confirmed',
  'picked',
  'out_for_delivery',
  'delivered',
  'cancelled',
];

const PAYMENT_STATUSES = ['all', 'pending', 'paid', 'failed', 'refunded'];

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [activeStatus, setActiveStatus] = useState('all');
  const [activePaymentStatus, setActivePaymentStatus] = useState('all');

  const fetchOrders = useCallback(
    async ({ reset, cursor }: { reset: boolean; cursor?: string | null }) => {
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        setError(null);
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        if (activeStatus !== 'all') params.set('status', activeStatus);
        if (activePaymentStatus !== 'all') {
          params.set('payment_status', activePaymentStatus);
        }
        if (!reset && cursor) params.set('cursor', cursor);

        const res = await fetch(`/api/orders?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to fetch orders (${res.status})`);
        const json = (await res.json()) as OrdersApiResponse;
        const incoming = Array.isArray(json.orders) ? json.orders : [];

        if (reset) {
          setOrders(incoming);
        } else {
          setOrders((prev) => {
            const seen = new Set(prev.map((row) => String(row.id)));
            const merged = [...prev];
            for (const row of incoming) {
              if (!seen.has(String(row.id))) {
                seen.add(String(row.id));
                merged.push(row);
              }
            }
            return merged;
          });
        }

        setHasMore(Boolean(json.page_info?.has_more));
        setNextCursor(json.page_info?.next_cursor || null);
      } catch (e) {
        console.error(e);
        if (reset) setOrders([]);
        setHasMore(false);
        setNextCursor(null);
        setError(e instanceof Error ? e.message : 'Failed to load orders');
      } finally {
        if (reset) {
          setLoading(false);
        } else {
          setLoadingMore(false);
        }
      }
    },
    [activeStatus, activePaymentStatus],
  );

  useEffect(() => {
    void fetchOrders({ reset: true });
  }, [fetchOrders]);

  const onApplyFilters = () => {
    setActiveStatus(status);
    setActivePaymentStatus(paymentStatus);
  };

  const paidTotalLoaded = useMemo(
    () =>
      orders.reduce((sum, row) => {
        if (String(row.payment_status || '').toLowerCase() !== 'paid') return sum;
        return sum + Number(row.total_amount || 0);
      }, 0),
    [orders],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Orders</h1>
        <p className="mt-1 text-foreground/50">Pull-on-demand order list with cursor pagination.</p>
      </div>

      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-foreground/50">
              Order Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              {ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-foreground/50">
              Payment Status
            </label>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              {PAYMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={onApplyFilters}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90"
            >
              Apply Filters
            </button>
          </div>
          <div className="flex items-end justify-start md:justify-end">
            <button
              onClick={() => void fetchOrders({ reset: true })}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground hover:bg-surface"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-foreground/60">
          <p>
            Loaded orders: <span className="font-semibold text-foreground">{orders.length}</span>
          </p>
          <p>
            Paid total (loaded):{' '}
            <span className="font-semibold text-foreground">{formatCurrency(paidTotalLoaded)}</span>
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground/50">
                <th className="px-2 py-3">Order</th>
                <th className="px-2 py-3">User</th>
                <th className="px-2 py-3">Status</th>
                <th className="px-2 py-3">Payment</th>
                <th className="px-2 py-3">Items</th>
                <th className="px-2 py-3">Delivery</th>
                <th className="px-2 py-3">Platform</th>
                <th className="px-2 py-3">Discount</th>
                <th className="px-2 py-3">Credits</th>
                <th className="px-2 py-3">Total</th>
                <th className="px-2 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, index) => (
                  <tr key={index} className="border-b border-border">
                    <td colSpan={11} className="px-2 py-3">
                      <div className="h-8 w-full animate-pulse rounded bg-surface" />
                    </td>
                  </tr>
                ))
              ) : orders.length > 0 ? (
                orders.map((row) => (
                  <tr key={String(row.id)} className="border-b border-border/70 text-foreground/80">
                    <td className="px-2 py-3 font-semibold text-foreground">#{row.id}</td>
                    <td className="px-2 py-3 font-mono text-xs text-foreground/60">{row.firebase_uid}</td>
                    <td className="px-2 py-3">{row.status}</td>
                    <td className="px-2 py-3">
                      <div className="leading-tight">
                        <p className="font-medium">{row.payment_status}</p>
                        <p className="text-xs text-foreground/50">{row.payment_method || 'unknown'}</p>
                      </div>
                    </td>
                    <td className="px-2 py-3">{formatCurrency(Number(row.item_total || 0))}</td>
                    <td className="px-2 py-3">{formatCurrency(Number(row.delivery_fee || 0))}</td>
                    <td className="px-2 py-3">{formatCurrency(Number(row.platform_fee || 0))}</td>
                    <td className="px-2 py-3 text-red-600">-{formatCurrency(Number(row.discount_amount || 0))}</td>
                    <td className="px-2 py-3 text-emerald-700">
                      -{formatCurrency(Number(row.order_credit_used_amount || 0))}
                    </td>
                    <td className="px-2 py-3 font-semibold text-foreground">
                      {formatCurrency(Number(row.total_amount || 0))}
                    </td>
                    <td className="px-2 py-3 text-xs text-foreground/60">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="px-2 py-10 text-center text-foreground/50">
                    No orders found for selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div>{error ? <p className="text-sm text-red-600">{error}</p> : null}</div>
          {hasMore ? (
            <button
              onClick={() => void fetchOrders({ reset: false, cursor: nextCursor })}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface disabled:opacity-60"
            >
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loadingMore ? 'Loading...' : 'Load More'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
