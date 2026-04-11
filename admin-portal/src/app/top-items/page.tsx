'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type TopItem = {
  product_id: number;
  product_name: string;
  orders_count: number;
  total_quantity: number;
  total_value: number;
};

function formatCurrency(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

const PRESETS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
];

export default function TopItemsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('30d');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeStartDate, setActiveStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [activeEndDate, setActiveEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [limit, setLimit] = useState(20);
  const [activeLimit, setActiveLimit] = useState(20);
  const [page, setPage] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [topByOrders, setTopByOrders] = useState<TopItem[]>([]);
  const [mostValued, setMostValued] = useState<TopItem[]>([]);

  const query = useMemo(() => {
    const start = new Date(`${activeStartDate}T00:00:00.000Z`).toISOString();
    const end = new Date(`${activeEndDate}T23:59:59.999Z`).toISOString();
    return `start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&limit=${activeLimit}&page=${activePage}`;
  }, [activeStartDate, activeEndDate, activeLimit, activePage]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/analytics/top-items?${query}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json?.error || 'Failed to load top items'));

      setTopByOrders(
        Array.isArray(json?.top_by_order_count) ? (json.top_by_order_count as TopItem[]) : [],
      );
      setMostValued(
        Array.isArray(json?.most_valued_items) ? (json.most_valued_items as TopItem[]) : [],
      );
      setTotalPages(Number(json?.filters?.total_pages || 1));
      setTotalItems(Number(json?.filters?.total_items || 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load top items');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function applyPreset(days: number, key: string) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    setSelectedPreset(key);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(now.toISOString().slice(0, 10));
  }

  function applyFilters() {
    setActiveStartDate(startDate);
    setActiveEndDate(endDate);
    setActiveLimit(limit);
    setPage(1);
    setActivePage(1);
  }

  function goToPage(nextPage: number) {
    const safePage = Math.max(1, Math.min(totalPages, nextPage));
    setPage(safePage);
    setActivePage(safePage);
  }

  function renderTable(title: string, rows: TopItem[], valueLabel: 'orders' | 'quantity' | 'value') {
    return (
      <div className="rounded-2xl border border-border bg-white p-5">
        <h2 className="text-lg font-black text-foreground">{title}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground/50">
                <th className="px-2 py-2 font-semibold">#</th>
                <th className="px-2 py-2 font-semibold">Product</th>
                <th className="px-2 py-2 font-semibold">Orders</th>
                <th className="px-2 py-2 font-semibold">Qty</th>
                <th className="px-2 py-2 font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-foreground/50" colSpan={5}>
                    {loading ? 'Loading...' : 'No data in selected range.'}
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={`${title}-${row.product_id}-${idx}`} className="border-b border-border/60">
                    <td className="px-2 py-2 font-semibold text-foreground">{idx + 1}</td>
                    <td className="px-2 py-2 text-foreground">{row.product_name}</td>
                    <td className="px-2 py-2 text-foreground/80">{row.orders_count}</td>
                    <td className="px-2 py-2 text-foreground/80">{row.total_quantity}</td>
                    <td className="px-2 py-2 font-semibold text-foreground">
                      {formatCurrency(row.total_value)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-foreground/50">
          Sorted by {valueLabel === 'orders' ? 'order count' : valueLabel === 'quantity' ? 'repeat quantity' : 'value'}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Top Items</h1>
          <p className="text-sm text-foreground/60">
            Top selling, most repeated, and most valued items.
          </p>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground/70 hover:text-primary"
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => applyPreset(preset.days, preset.key)}
              type="button"
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                selectedPreset === preset.key
                  ? 'bg-primary text-white'
                  : 'bg-surface text-foreground/70 hover:text-primary'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-foreground/70">
            Start Date
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setSelectedPreset('custom');
                setStartDate(e.target.value);
              }}
              className="rounded-lg border border-border bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-foreground/70">
            End Date
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setSelectedPreset('custom');
                setEndDate(e.target.value);
              }}
              className="rounded-lg border border-border bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-foreground/70">
            Limit
            <input
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => {
                const value = Number(e.target.value || 20);
                setLimit(Math.max(1, Math.min(50, value)));
              }}
              className="rounded-lg border border-border bg-white px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            Apply Filters
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-1">
        {renderTable('Top Selling by Order Count', topByOrders, 'orders')}
        {renderTable('Most Valued Items', mostValued, 'value')}
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-border bg-white px-4 py-3">
        <p className="text-sm text-foreground/60">
          Page {activePage} of {totalPages} • {totalItems} items
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goToPage(activePage - 1)}
            disabled={activePage <= 1 || loading}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground/70 disabled:opacity-50"
          >
            Prev
          </button>
          <input
            type="number"
            min={1}
            max={Math.max(1, totalPages)}
            value={page}
            onChange={(e) => setPage(Math.max(1, Number(e.target.value || 1)))}
            className="w-20 rounded-lg border border-border px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => goToPage(page)}
            disabled={loading}
            className="rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold text-foreground/80"
          >
            Go
          </button>
          <button
            type="button"
            onClick={() => goToPage(activePage + 1)}
            disabled={activePage >= totalPages || loading}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground/70 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
