'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CreditCard, DollarSign, RefreshCw, Wallet } from 'lucide-react';

type PaymentMethodMetric = {
  payment_method: string;
  order_count: number;
  paid_amount: number;
};

type TopPayment = {
  order_id: number;
  firebase_uid: string;
  amount: number;
  payment_method: string;
  created_at: string;
};

type AnalyticsMetrics = {
  total_orders: number;
  total_sales: number;
  successful_payments: number;
  failed_payments: number;
  payment_success_rate: number;
  total_credits_added: number;
  total_credits_used: number;
  total_credits_balance: number;
  payment_method_breakdown: PaymentMethodMetric[];
  top_payments: TopPayment[];
};

function toIso(date: Date) {
  return date.toISOString();
}

function formatCurrency(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const PRESETS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
];

const defaultMetrics: AnalyticsMetrics = {
  total_orders: 0,
  total_sales: 0,
  successful_payments: 0,
  failed_payments: 0,
  payment_success_rate: 0,
  total_credits_added: 0,
  total_credits_used: 0,
  total_credits_balance: 0,
  payment_method_breakdown: [],
  top_payments: [],
};

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<AnalyticsMetrics>(defaultMetrics);
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

  const rangeQuery = useMemo(() => {
    const start = new Date(`${activeStartDate}T00:00:00.000Z`);
    const end = new Date(`${activeEndDate}T23:59:59.999Z`);
    return `start_date=${encodeURIComponent(toIso(start))}&end_date=${encodeURIComponent(toIso(end))}`;
  }, [activeStartDate, activeEndDate]);

  async function loadMetrics() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/analytics/metrics?${rangeQuery}`, {
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(String(json?.error || 'Failed to load analytics'));
      }
      const raw = (json?.metrics || {}) as Partial<AnalyticsMetrics>;
      setMetrics({
        total_orders: Number(raw.total_orders || 0),
        total_sales: Number(raw.total_sales || 0),
        successful_payments: Number(raw.successful_payments || 0),
        failed_payments: Number(raw.failed_payments || 0),
        payment_success_rate: Number(raw.payment_success_rate || 0),
        total_credits_added: Number(
          (raw as { total_credits_added?: number; total_credits_earned?: number })
            .total_credits_added ??
            (raw as { total_credits_earned?: number }).total_credits_earned ??
            0,
        ),
        total_credits_used: Number(raw.total_credits_used || 0),
        total_credits_balance: Number(raw.total_credits_balance || 0),
        payment_method_breakdown: Array.isArray(raw.payment_method_breakdown)
          ? (raw.payment_method_breakdown as PaymentMethodMetric[])
          : [],
        top_payments: Array.isArray(raw.top_payments)
          ? (raw.top_payments as TopPayment[])
          : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeQuery]);

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
  }

  const statCards = [
    {
      title: 'Total Sales',
      value: formatCurrency(metrics.total_sales),
      icon: DollarSign,
    },
    {
      title: 'Successful Payments',
      value: String(metrics.successful_payments),
      icon: CreditCard,
    },
    {
      title: 'Failed Payments',
      value: String(metrics.failed_payments),
      icon: AlertCircle,
    },
    {
      title: 'Total Credits Balance',
      value: formatCurrency(metrics.total_credits_balance),
      icon: Wallet,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Analytics</h1>
          <p className="text-sm text-foreground/60">
            Sales, payment, and credits health with date filters.
          </p>
        </div>
        <button
          onClick={loadMetrics}
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
        <div className="mt-3 grid gap-3 md:grid-cols-2">
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((item) => (
          <div key={item.title} className="rounded-2xl border border-border bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">
                {item.title}
              </p>
              <item.icon className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-3 text-3xl font-black text-foreground">
              {loading ? '...' : item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-white p-5">
          <h2 className="text-lg font-black text-foreground">Payment Method Breakdown</h2>
          <div className="mt-4 space-y-3">
            {metrics.payment_method_breakdown.length === 0 ? (
              <p className="text-sm text-foreground/50">No payment data in selected range.</p>
            ) : (
              metrics.payment_method_breakdown.map((row) => (
                <div
                  key={row.payment_method}
                  className="flex items-center justify-between rounded-lg bg-surface px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold capitalize text-foreground">
                      {row.payment_method.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-foreground/50">{row.order_count} orders</p>
                  </div>
                  <p className="text-sm font-bold text-foreground">{formatCurrency(row.paid_amount)}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-white p-5">
          <h2 className="text-lg font-black text-foreground">Credits Summary</h2>
          <div className="mt-4 grid gap-3">
            <div className="rounded-lg bg-surface px-3 py-2">
              <p className="text-xs uppercase tracking-wider text-foreground/50">Credits Added</p>
              <p className="text-xl font-black text-foreground">
                {formatCurrency(metrics.total_credits_added)}
              </p>
            </div>
            <div className="rounded-lg bg-surface px-3 py-2">
              <p className="text-xs uppercase tracking-wider text-foreground/50">Credits Used</p>
              <p className="text-xl font-black text-foreground">
                {formatCurrency(metrics.total_credits_used)}
              </p>
            </div>
            <div className="rounded-lg bg-surface px-3 py-2">
              <p className="text-xs uppercase tracking-wider text-foreground/50">
                Payment Success Rate
              </p>
              <p className="text-xl font-black text-foreground">
                {metrics.payment_success_rate.toFixed(2)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white p-5">
        <h2 className="text-lg font-black text-foreground">Top Payments</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground/50">
                <th className="px-2 py-2 font-semibold">Order</th>
                <th className="px-2 py-2 font-semibold">Amount</th>
                <th className="px-2 py-2 font-semibold">Method</th>
                <th className="px-2 py-2 font-semibold">Customer</th>
                <th className="px-2 py-2 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {metrics.top_payments.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-foreground/50" colSpan={5}>
                    No successful payments in selected range.
                  </td>
                </tr>
              ) : (
                metrics.top_payments.map((row) => (
                  <tr key={row.order_id} className="border-b border-border/60">
                    <td className="px-2 py-2 font-semibold text-foreground">#{row.order_id}</td>
                    <td className="px-2 py-2 font-semibold text-foreground">
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="px-2 py-2 capitalize text-foreground/70">
                      {String(row.payment_method || 'unknown').replace(/_/g, ' ')}
                    </td>
                    <td className="px-2 py-2 text-foreground/60">{row.firebase_uid}</td>
                    <td className="px-2 py-2 text-foreground/60">{formatDateTime(row.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
