'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, TicketPercent } from 'lucide-react';

type DiscountType = 'percentage' | 'flat';

type PromoCode = {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  max_discount: number | null;
  min_order_amount: number;
  usage_limit: number | null;
  used_count: number;
  per_user_limit: number;
  city: string | null;
  user_type: string | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type EditablePromo = {
  code: string;
  discount_type: DiscountType;
  discount_value: string;
  max_discount: string;
  min_order_amount: string;
  usage_limit: string;
  per_user_limit: string;
  city: string;
  user_type: string;
  start_date: string;
  end_date: string;
  active: boolean;
};

const NEW_PROMO: EditablePromo = {
  code: '',
  discount_type: 'percentage',
  discount_value: '10',
  max_discount: '',
  min_order_amount: '0',
  usage_limit: '',
  per_user_limit: '1',
  city: '',
  user_type: '',
  start_date: '',
  end_date: '',
  active: true,
};

function money(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function toDateTimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toEditablePromo(promo: PromoCode): EditablePromo {
  return {
    code: promo.code,
    discount_type: promo.discount_type,
    discount_value: money(promo.discount_value),
    max_discount: promo.max_discount === null ? '' : money(promo.max_discount),
    min_order_amount: money(promo.min_order_amount),
    usage_limit: promo.usage_limit === null ? '' : String(promo.usage_limit),
    per_user_limit: String(promo.per_user_limit),
    city: promo.city || '',
    user_type: promo.user_type || '',
    start_date: toDateTimeLocal(promo.start_date),
    end_date: toDateTimeLocal(promo.end_date),
    active: promo.active,
  };
}

function toNullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function PromosPage() {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | 'new' | null>(null);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [editingPromos, setEditingPromos] = useState<Record<string, EditablePromo>>({});
  const [newPromo, setNewPromo] = useState<EditablePromo>(NEW_PROMO);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const sortedPromos = useMemo(
    () =>
      [...promos].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.code.localeCompare(b.code);
      }),
    [promos],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/promos', { cache: 'no-store' });
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error((payload as { error?: string })?.error || 'Failed to load promos');
      }
      setPromos(Array.isArray(payload) ? (payload as PromoCode[]) : []);
      setEditingPromos({});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load promos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateDraft = (id: string, patch: Partial<EditablePromo>) => {
    setEditingPromos((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || NEW_PROMO),
        ...patch,
      },
    }));
  };

  const getDraft = (promo: PromoCode): EditablePromo => {
    return editingPromos[promo.id] || toEditablePromo(promo);
  };

  const buildPayload = (draft: EditablePromo) => ({
    code: draft.code.trim().toUpperCase(),
    discount_type: draft.discount_type,
    discount_value: Number(draft.discount_value),
    max_discount: toNullableNumber(draft.max_discount),
    min_order_amount: Number(draft.min_order_amount),
    usage_limit: toNullableNumber(draft.usage_limit),
    per_user_limit: Number(draft.per_user_limit),
    city: draft.city.trim() || null,
    user_type: draft.user_type.trim() || null,
    start_date: toIsoOrNull(draft.start_date),
    end_date: toIsoOrNull(draft.end_date),
    active: draft.active,
  });

  const savePromo = async (promo: PromoCode) => {
    const draft = getDraft(promo);
    setSavingId(promo.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/promos/${promo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(draft)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { error?: string })?.error || 'Failed to save promo');
      }
      setPromos((prev) => prev.map((item) => (item.id === promo.id ? (payload as PromoCode) : item)));
      setEditingPromos((prev) => {
        const next = { ...prev };
        delete next[promo.id];
        return next;
      });
      setSuccess(`Saved ${promo.code}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save promo');
    } finally {
      setSavingId(null);
    }
  };

  const createPromo = async () => {
    setSavingId('new');
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(newPromo)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { error?: string })?.error || 'Failed to create promo');
      }
      setPromos((prev) => [payload as PromoCode, ...prev]);
      setNewPromo(NEW_PROMO);
      setSuccess('Promo created');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to create promo');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">Promo Codes</h1>
            <p className="mt-1 text-sm text-foreground/70">
              Create and update promo rules. Backend validates and recalculates on payment intent.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-foreground/5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2 text-foreground">
          <Plus className="h-4 w-4" />
          <h2 className="text-lg font-semibold">Create Promo</h2>
        </div>
        <PromoEditor draft={newPromo} onChange={(patch) => setNewPromo((prev) => ({ ...prev, ...patch }))} />
        <div className="mt-4">
          <button
            type="button"
            disabled={savingId === 'new'}
            onClick={createPromo}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Plus className="h-4 w-4" />
            {savingId === 'new' ? 'Creating...' : 'Add Promo'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2 text-foreground">
          <TicketPercent className="h-4 w-4" />
          <h2 className="text-lg font-semibold">Existing Promos</h2>
        </div>

        {loading ? (
          <div className="py-8 text-sm text-foreground/60">Loading promos...</div>
        ) : sortedPromos.length === 0 ? (
          <div className="py-8 text-sm text-foreground/60">No promo codes yet.</div>
        ) : (
          <div className="space-y-4">
            {sortedPromos.map((promo) => {
              const draft = getDraft(promo);
              return (
                <div key={promo.id} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{promo.code}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${promo.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {promo.active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        Used: {promo.used_count}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => savePromo(promo)}
                      disabled={savingId === promo.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Save className="h-4 w-4" />
                      {savingId === promo.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <PromoEditor draft={draft} onChange={(patch) => updateDraft(promo.id, patch)} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function PromoEditor({
  draft,
  onChange,
}: {
  draft: EditablePromo;
  onChange: (patch: Partial<EditablePromo>) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <Field label="Code">
        <input
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.code}
          onChange={(event) => onChange({ code: event.target.value.toUpperCase() })}
          placeholder="SAVE20"
        />
      </Field>

      <Field label="Discount Type">
        <select
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.discount_type}
          onChange={(event) => onChange({ discount_type: event.target.value as DiscountType })}
        >
          <option value="percentage">Percentage</option>
          <option value="flat">Flat</option>
        </select>
      </Field>

      <Field label="Discount Value">
        <input
          type="number"
          step="0.01"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.discount_value}
          onChange={(event) => onChange({ discount_value: event.target.value })}
        />
      </Field>

      <Field label="Max Discount">
        <input
          type="number"
          step="0.01"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.max_discount}
          onChange={(event) => onChange({ max_discount: event.target.value })}
          placeholder="Optional"
        />
      </Field>

      <Field label="Min Order Amount">
        <input
          type="number"
          step="0.01"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.min_order_amount}
          onChange={(event) => onChange({ min_order_amount: event.target.value })}
        />
      </Field>

      <Field label="Usage Limit">
        <input
          type="number"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.usage_limit}
          onChange={(event) => onChange({ usage_limit: event.target.value })}
          placeholder="Optional"
        />
      </Field>

      <Field label="Per User Limit">
        <input
          type="number"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.per_user_limit}
          onChange={(event) => onChange({ per_user_limit: event.target.value })}
        />
      </Field>

      <Field label="City">
        <input
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.city}
          onChange={(event) => onChange({ city: event.target.value })}
          placeholder="Optional"
        />
      </Field>

      <Field label="User Type">
        <input
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.user_type}
          onChange={(event) => onChange({ user_type: event.target.value })}
          placeholder="Optional"
        />
      </Field>

      <Field label="Start Date">
        <input
          type="datetime-local"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.start_date}
          onChange={(event) => onChange({ start_date: event.target.value })}
        />
      </Field>

      <Field label="End Date">
        <input
          type="datetime-local"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          value={draft.end_date}
          onChange={(event) => onChange({ end_date: event.target.value })}
        />
      </Field>

      <Field label="Active">
        <label className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => onChange({ active: event.target.checked })}
          />
          Enabled
        </label>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">{label}</span>
      {children}
    </label>
  );
}
