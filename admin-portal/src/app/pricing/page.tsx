'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, RefreshCw, Truck, BadgeDollarSign } from 'lucide-react';

type PlatformFeeType = 'percentage' | 'flat';

type PlatformFeeRule = {
  id: number;
  name: string;
  platform_fee_type: PlatformFeeType;
  platform_fee_value: number;
  min_platform_fee: number;
  max_platform_fee: number | null;
  feature_flag_enabled: boolean;
  is_active: boolean;
  version: number;
};

type DeliveryFeeSlab = {
  id: number;
  city: string | null;
  start_time: string | null;
  end_time: string | null;
  user_type: string | null;
  min_order_amount: number;
  max_order_amount: number;
  delivery_fee: number;
  active: boolean;
};

type EditableSlab = {
  id?: number;
  city: string;
  start_time: string;
  end_time: string;
  user_type: string;
  min_order_amount: string;
  max_order_amount: string;
  delivery_fee: string;
  active: boolean;
};

function money(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function toEditableSlab(slab: DeliveryFeeSlab): EditableSlab {
  return {
    id: slab.id,
    city: slab.city || '',
    start_time: slab.start_time || '',
    end_time: slab.end_time || '',
    user_type: slab.user_type || '',
    min_order_amount: money(slab.min_order_amount),
    max_order_amount: money(slab.max_order_amount),
    delivery_fee: money(slab.delivery_fee),
    active: slab.active,
  };
}

const NEW_SLAB: EditableSlab = {
  city: '',
  start_time: '',
  end_time: '',
  user_type: '',
  min_order_amount: '0.00',
  max_order_amount: '0.00',
  delivery_fee: '0.00',
  active: true,
};

export default function PricingPage() {
  const [loading, setLoading] = useState(true);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [savingSlabId, setSavingSlabId] = useState<number | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [platformRule, setPlatformRule] = useState<PlatformFeeRule | null>(null);
  const [slabs, setSlabs] = useState<DeliveryFeeSlab[]>([]);
  const [editingSlabs, setEditingSlabs] = useState<Record<string, EditableSlab>>({});
  const [newSlab, setNewSlab] = useState<EditableSlab>(NEW_SLAB);

  const sortedSlabs = useMemo(
    () =>
      [...slabs].sort(
        (a, b) =>
          a.min_order_amount - b.min_order_amount ||
          a.max_order_amount - b.max_order_amount ||
          a.id - b.id,
      ),
    [slabs],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const [platformRes, slabsRes] = await Promise.all([
        fetch('/api/pricing/platform-fee', { cache: 'no-store' }),
        fetch('/api/pricing/delivery-slabs', { cache: 'no-store' }),
      ]);
      if (!platformRes.ok) {
        const payload = await platformRes.json().catch(() => ({}));
        throw new Error(payload?.error || 'Failed to load platform fee');
      }
      if (!slabsRes.ok) {
        const payload = await slabsRes.json().catch(() => ({}));
        throw new Error(payload?.error || 'Failed to load delivery fee slabs');
      }

      const platformData = (await platformRes.json()) as PlatformFeeRule | null;
      const slabData = (await slabsRes.json()) as DeliveryFeeSlab[];
      setPlatformRule(platformData);
      setSlabs(Array.isArray(slabData) ? slabData : []);
      setEditingSlabs({});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load pricing settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updatePlatformField = <K extends keyof PlatformFeeRule>(
    key: K,
    value: PlatformFeeRule[K],
  ) => {
    if (!platformRule) return;
    setPlatformRule({ ...platformRule, [key]: value });
  };

  const savePlatformRule = async () => {
    if (!platformRule) return;
    setSavingPlatform(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        name: platformRule.name,
        platform_fee_type: platformRule.platform_fee_type,
        platform_fee_value: Number(platformRule.platform_fee_value),
        min_platform_fee: Number(platformRule.min_platform_fee),
        max_platform_fee:
          platformRule.max_platform_fee === null || platformRule.max_platform_fee === undefined
            ? null
            : Number(platformRule.max_platform_fee),
        feature_flag_enabled: platformRule.feature_flag_enabled,
        is_active: platformRule.is_active,
      };
      const response = await fetch('/api/pricing/platform-fee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save platform fee');
      }
      setPlatformRule(data as PlatformFeeRule);
      setSuccess('Platform fee updated');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save platform fee');
    } finally {
      setSavingPlatform(false);
    }
  };

  const updateEditableSlab = (key: string, patch: Partial<EditableSlab>) => {
    setEditingSlabs((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || NEW_SLAB),
        ...patch,
      },
    }));
  };

  const getSlabDraft = (slab: DeliveryFeeSlab): EditableSlab => {
    return editingSlabs[String(slab.id)] || toEditableSlab(slab);
  };

  const saveExistingSlab = async (slab: DeliveryFeeSlab) => {
    const key = String(slab.id);
    const draft = getSlabDraft(slab);
    setSavingSlabId(slab.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/pricing/delivery-slabs/${slab.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: draft.city || null,
          start_time: draft.start_time || null,
          end_time: draft.end_time || null,
          user_type: draft.user_type || null,
          min_order_amount: Number(draft.min_order_amount),
          max_order_amount: Number(draft.max_order_amount),
          delivery_fee: Number(draft.delivery_fee),
          active: draft.active,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save slab');
      }
      setSlabs((prev) => prev.map((item) => (item.id === slab.id ? (data as DeliveryFeeSlab) : item)));
      setEditingSlabs((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSuccess(`Saved slab #${slab.id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save slab');
    } finally {
      setSavingSlabId(null);
    }
  };

  const createSlab = async () => {
    setSavingSlabId('new');
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/pricing/delivery-slabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: newSlab.city || null,
          start_time: newSlab.start_time || null,
          end_time: newSlab.end_time || null,
          user_type: newSlab.user_type || null,
          min_order_amount: Number(newSlab.min_order_amount),
          max_order_amount: Number(newSlab.max_order_amount),
          delivery_fee: Number(newSlab.delivery_fee),
          active: newSlab.active,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create slab');
      }
      setSlabs((prev) => [...prev, data as DeliveryFeeSlab]);
      setNewSlab(NEW_SLAB);
      setSuccess('Delivery slab added');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to create slab');
    } finally {
      setSavingSlabId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Pricing Control</h1>
          <p className="text-foreground/50 mt-1">
            Manage platform fee and delivery fee slabs from admin.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center justify-center gap-2 bg-surface border border-border text-foreground px-4 py-2.5 rounded-xl font-semibold hover:bg-surface/80 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <section className="bg-white border border-border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <BadgeDollarSign className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-bold text-foreground">Platform Fee</h2>
        </div>
        {loading || !platformRule ? (
          <p className="text-foreground/60">Loading platform fee...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-foreground/60 uppercase">Rule Name</span>
              <input
                value={platformRule.name}
                onChange={(e) => updatePlatformField('name', e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-foreground/60 uppercase">Fee Type</span>
              <select
                value={platformRule.platform_fee_type}
                onChange={(e) =>
                  updatePlatformField('platform_fee_type', e.target.value as PlatformFeeType)
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface"
              >
                <option value="percentage">Percentage</option>
                <option value="flat">Flat</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-foreground/60 uppercase">Value</span>
              <input
                type="number"
                step="0.0001"
                value={platformRule.platform_fee_value}
                onChange={(e) =>
                  updatePlatformField('platform_fee_value', Number(e.target.value))
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-foreground/60 uppercase">Min Fee</span>
              <input
                type="number"
                step="0.01"
                value={platformRule.min_platform_fee}
                onChange={(e) =>
                  updatePlatformField('min_platform_fee', Number(e.target.value))
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-foreground/60 uppercase">Max Fee</span>
              <input
                type="number"
                step="0.01"
                value={platformRule.max_platform_fee ?? ''}
                onChange={(e) =>
                  updatePlatformField(
                    'max_platform_fee',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface"
                placeholder="Optional"
              />
            </label>
            <label className="inline-flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                checked={platformRule.feature_flag_enabled}
                onChange={(e) =>
                  updatePlatformField('feature_flag_enabled', e.target.checked)
                }
              />
              <span className="text-sm text-foreground">Feature flag enabled</span>
            </label>
            <label className="inline-flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                checked={platformRule.is_active}
                onChange={(e) => updatePlatformField('is_active', e.target.checked)}
              />
              <span className="text-sm text-foreground">Rule active</span>
            </label>
            <div className="flex items-end">
              <button
                onClick={savePlatformRule}
                disabled={savingPlatform}
                className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {savingPlatform ? 'Saving...' : 'Save Platform Fee'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="bg-white border border-border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-bold text-foreground">Delivery Fee Slabs</h2>
        </div>
        <p className="text-sm text-foreground/60">
          Example: 0-19.99 =&gt; 8.00, 20+ =&gt; 5.00. Optional future filters: city, time window,
          user type.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-surface/60">
                <th className="px-3 py-2 border border-border">ID</th>
                <th className="px-3 py-2 border border-border">City</th>
                <th className="px-3 py-2 border border-border">Start</th>
                <th className="px-3 py-2 border border-border">End</th>
                <th className="px-3 py-2 border border-border">User Type</th>
                <th className="px-3 py-2 border border-border">Min Amount</th>
                <th className="px-3 py-2 border border-border">Max Amount</th>
                <th className="px-3 py-2 border border-border">Delivery Fee</th>
                <th className="px-3 py-2 border border-border">Active</th>
                <th className="px-3 py-2 border border-border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-3 border border-border text-foreground/60" colSpan={10}>
                    Loading slabs...
                  </td>
                </tr>
              ) : sortedSlabs.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 border border-border text-foreground/60" colSpan={10}>
                    No slabs found
                  </td>
                </tr>
              ) : (
                sortedSlabs.map((slab) => {
                  const draft = getSlabDraft(slab);
                  const editing = Boolean(editingSlabs[String(slab.id)]);
                  return (
                    <tr key={slab.id}>
                      <td className="px-3 py-2 border border-border">{slab.id}</td>
                      <td className="px-2 py-1 border border-border">
                        <input
                          value={draft.city}
                          onChange={(e) =>
                            updateEditableSlab(String(slab.id), { city: e.target.value })
                          }
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-2 py-1 border border-border">
                        <input
                          value={draft.start_time}
                          onChange={(e) =>
                            updateEditableSlab(String(slab.id), { start_time: e.target.value })
                          }
                          placeholder="HH:MM"
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-2 py-1 border border-border">
                        <input
                          value={draft.end_time}
                          onChange={(e) =>
                            updateEditableSlab(String(slab.id), { end_time: e.target.value })
                          }
                          placeholder="HH:MM"
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-2 py-1 border border-border">
                        <input
                          value={draft.user_type}
                          onChange={(e) =>
                            updateEditableSlab(String(slab.id), { user_type: e.target.value })
                          }
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-2 py-1 border border-border">
                        <input
                          type="number"
                          step="0.01"
                          value={draft.min_order_amount}
                          onChange={(e) =>
                            updateEditableSlab(String(slab.id), {
                              min_order_amount: e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-2 py-1 border border-border">
                        <input
                          type="number"
                          step="0.01"
                          value={draft.max_order_amount}
                          onChange={(e) =>
                            updateEditableSlab(String(slab.id), {
                              max_order_amount: e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-2 py-1 border border-border">
                        <input
                          type="number"
                          step="0.01"
                          value={draft.delivery_fee}
                          onChange={(e) =>
                            updateEditableSlab(String(slab.id), {
                              delivery_fee: e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-3 py-2 border border-border">
                        <input
                          type="checkbox"
                          checked={draft.active}
                          onChange={(e) =>
                            updateEditableSlab(String(slab.id), { active: e.target.checked })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 border border-border">
                        <button
                          onClick={() => saveExistingSlab(slab)}
                          disabled={savingSlabId === slab.id}
                          className="inline-flex items-center gap-1 bg-primary text-white px-3 py-1.5 rounded font-semibold disabled:opacity-60"
                        >
                          <Save className="w-3.5 h-3.5" />
                          {savingSlabId === slab.id ? 'Saving...' : editing ? 'Save' : 'Update'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}

              <tr>
                <td className="px-3 py-2 border border-border text-foreground/60">New</td>
                <td className="px-2 py-1 border border-border">
                  <input
                    value={newSlab.city}
                    onChange={(e) => setNewSlab((prev) => ({ ...prev, city: e.target.value }))}
                    className="w-full px-2 py-1 border border-border rounded"
                  />
                </td>
                <td className="px-2 py-1 border border-border">
                  <input
                    value={newSlab.start_time}
                    onChange={(e) =>
                      setNewSlab((prev) => ({ ...prev, start_time: e.target.value }))
                    }
                    placeholder="HH:MM"
                    className="w-full px-2 py-1 border border-border rounded"
                  />
                </td>
                <td className="px-2 py-1 border border-border">
                  <input
                    value={newSlab.end_time}
                    onChange={(e) =>
                      setNewSlab((prev) => ({ ...prev, end_time: e.target.value }))
                    }
                    placeholder="HH:MM"
                    className="w-full px-2 py-1 border border-border rounded"
                  />
                </td>
                <td className="px-2 py-1 border border-border">
                  <input
                    value={newSlab.user_type}
                    onChange={(e) =>
                      setNewSlab((prev) => ({ ...prev, user_type: e.target.value }))
                    }
                    className="w-full px-2 py-1 border border-border rounded"
                  />
                </td>
                <td className="px-2 py-1 border border-border">
                  <input
                    type="number"
                    step="0.01"
                    value={newSlab.min_order_amount}
                    onChange={(e) =>
                      setNewSlab((prev) => ({ ...prev, min_order_amount: e.target.value }))
                    }
                    className="w-full px-2 py-1 border border-border rounded"
                  />
                </td>
                <td className="px-2 py-1 border border-border">
                  <input
                    type="number"
                    step="0.01"
                    value={newSlab.max_order_amount}
                    onChange={(e) =>
                      setNewSlab((prev) => ({ ...prev, max_order_amount: e.target.value }))
                    }
                    className="w-full px-2 py-1 border border-border rounded"
                  />
                </td>
                <td className="px-2 py-1 border border-border">
                  <input
                    type="number"
                    step="0.01"
                    value={newSlab.delivery_fee}
                    onChange={(e) =>
                      setNewSlab((prev) => ({ ...prev, delivery_fee: e.target.value }))
                    }
                    className="w-full px-2 py-1 border border-border rounded"
                  />
                </td>
                <td className="px-3 py-2 border border-border">
                  <input
                    type="checkbox"
                    checked={newSlab.active}
                    onChange={(e) =>
                      setNewSlab((prev) => ({ ...prev, active: e.target.checked }))
                    }
                  />
                </td>
                <td className="px-3 py-2 border border-border">
                  <button
                    onClick={createSlab}
                    disabled={savingSlabId === 'new'}
                    className="inline-flex items-center gap-1 bg-primary text-white px-3 py-1.5 rounded font-semibold disabled:opacity-60"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {savingSlabId === 'new' ? 'Adding...' : 'Add Slab'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
