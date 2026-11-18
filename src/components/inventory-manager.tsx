'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';
import { getFranchiseContext } from '@/lib/supabase/franchise-client';

export type Supply = {
  id: string;
  item_name: string;
  unit: string;
  current_stock: number;
  low_stock_threshold: number;
  unit_cost?: number;
  auto_reorder_qty?: number;
};

const demoSupplies: Supply[] = [
  { id: 'demo-beans', item_name: 'Arabica Beans', unit: 'kg', current_stock: 4.2, low_stock_threshold: 5, unit_cost: 420 },
  { id: 'demo-milk', item_name: 'Whole Milk', unit: 'L', current_stock: 28, low_stock_threshold: 30, unit_cost: 62 },
];

export function InventoryManager({
  supplies,
  demo = false,
  isAdmin = false,
}: {
  supplies: Supply[];
  demo?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(demo && !supplies.length ? demoSupplies : supplies);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restockAmounts, setRestockAmounts] = useState<Record<string, string>>({});
  const [thresholdInputs, setThresholdInputs] = useState<Record<string, string>>({});
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const lowStockCount = items.filter((item) => {
    const stock = Number(item.current_stock);
    const threshold = Number(item.low_stock_threshold);
    return stock <= 0 || (threshold > 0 && stock <= threshold);
  }).length;
  const visibleItems = showLowStockOnly
    ? items.filter((item) => {
      const stock = Number(item.current_stock);
      const threshold = Number(item.low_stock_threshold);
      return stock <= 0 || (threshold > 0 && stock <= threshold);
    })
    : items;

  const getStockStatus = (item: Supply) => {
    const stock = Number(item.current_stock);
    const threshold = Number(item.low_stock_threshold);
    if (stock <= 0) return { label: 'Out of Stock', style: 'bg-rose-100 text-rose-800' };
    if (threshold > 0 && stock <= threshold) return { label: 'Low Stock', style: 'bg-amber-100 text-amber-800' };
    return { label: 'In Stock', style: 'bg-emerald-100 text-emerald-800' };
  };

  const getOwnerId = async () => {
    const context = await getFranchiseContext();
    return context.franchiseId;
  };

  const saveStock = async (item: Supply, quantity: number, restocked = false) => {
    if (quantity < 0) return;
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(item.id);
    try {
      await getOwnerId();
      const updates = {
        current_stock: quantity,
        ...(restocked ? { last_restocked_at: new Date().toISOString() } : {}),
      };
      const { data, error } = await createSupabaseClient()
        .from('supplies')
        .update(updates)
        .eq('id', item.id)
        .select('id, item_name, unit, current_stock, low_stock_threshold, unit_cost, auto_reorder_qty')
        .single();
      if (error) throw error;
      setItems((current) => current.map((row) => row.id === item.id ? data : row));
      setSuccessMessage(`${item.item_name} stock updated.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update stock.');
    } finally {
      setBusyId(null);
    }
  };

  const saveThreshold = async (item: Supply) => {
    const threshold = Number(thresholdInputs[item.id] ?? item.low_stock_threshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      setErrorMessage('Minimum stock threshold must be a non-negative number.');
      return;
    }
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(item.id);
    try {
      await getOwnerId();
      const { data, error } = await createSupabaseClient()
        .from('supplies')
        .update({ low_stock_threshold: threshold })
        .eq('id', item.id)
        .select('id, low_stock_threshold')
        .single();
      if (error) throw error;
      setItems((current) => current.map((row) => row.id === item.id
        ? { ...row, low_stock_threshold: Number(data.low_stock_threshold) }
        : row));
      setThresholdInputs((current) => ({ ...current, [item.id]: String(data.low_stock_threshold) }));
      setSuccessMessage(`${item.item_name} minimum stock threshold updated.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update minimum stock threshold.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    const form = event.currentTarget;
    const formData = new FormData(event.currentTarget);
    try {
      const ownerId = await getOwnerId();
      const { data, error } = await createSupabaseClient()
        .from('supplies')
        .insert({
          owner_id: ownerId,
          item_name: String(formData.get('item_name')).trim(),
          unit: String(formData.get('unit')).trim(),
          current_stock: Number(formData.get('current_stock')),
          low_stock_threshold: Number(formData.get('low_stock_threshold')),
          unit_cost: Number(formData.get('unit_cost')),
        })
        .select('id, item_name, unit, current_stock, low_stock_threshold, unit_cost, auto_reorder_qty')
        .single();
      if (error) throw error;
      setItems((current) => [...current, data].sort((a, b) => a.item_name.localeCompare(b.item_name)));
      form.reset();
      setSuccessMessage(`${data.item_name} added to inventory.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not add supply.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: Supply) => {
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(item.id);
    try {
      await getOwnerId();
      const { error } = await createSupabaseClient().from('supplies').delete().eq('id', item.id);
      if (error) throw error;
      setItems((current) => current.filter((row) => row.id !== item.id));
      setSuccessMessage(`${item.item_name} deleted.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not delete supply.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {demo && (
        <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          Demo inventory is read-only. Sign in to manage live supplies.
        </p>
      )}
      {errorMessage && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p>}

      {!isAdmin && !demo && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <p className="font-semibold text-slate-900">Inventory status</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowLowStockOnly(false)} className={`rounded-lg px-3 py-2 text-sm font-medium ${!showLowStockOnly ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>All Items</button>
              <button type="button" onClick={() => setShowLowStockOnly(true)} className={`rounded-lg px-3 py-2 text-sm font-medium ${showLowStockOnly ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>Low &amp; Out of Stock ({lowStockCount})</button>
            </div>
          </div>
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-600">
              <tr><th className="px-4 py-3">Ingredient</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Min. Threshold</th><th className="px-4 py-3">Availability</th></tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const status = getStockStatus(item);
                return (
                  <tr key={item.id} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium">{item.item_name}</td>
                    <td className="px-4 py-3">{item.current_stock} {item.unit}</td>
                    <td className="px-4 py-3">{item.low_stock_threshold} {item.unit}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${status.style}`}>{status.label}</span></td>
                  </tr>
                );
              })}
              {!visibleItems.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">{showLowStockOnly ? 'No low or out-of-stock ingredients.' : 'No inventory items yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {(isAdmin || demo) && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-slate-900">Add Supply / Ingredient</h2>
        <form onSubmit={handleAdd} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm text-slate-700">Name
            <input name="item_name" required disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-700">Unit
            <input name="unit" required placeholder="kg, L, pcs" disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-700">Current stock
            <input name="current_stock" type="number" min="0" step="0.001" defaultValue="0" required disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-700">Low-stock threshold
            <input name="low_stock_threshold" type="number" min="0" step="0.001" defaultValue="5" required disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-700">Unit cost (฿)
            <input name="unit_cost" type="number" min="0" step="0.01" defaultValue="0" required disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={demo || isSaving} className="w-full rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Add supply'}
            </button>
          </div>
        </form>
      </section>}

      {(isAdmin || demo) && <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <p className="font-semibold text-slate-900">Inventory status</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowLowStockOnly(false)} className={`rounded-lg px-3 py-2 text-sm font-medium ${!showLowStockOnly ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>All Items</button>
            <button type="button" onClick={() => setShowLowStockOnly(true)} className={`rounded-lg px-3 py-2 text-sm font-medium ${showLowStockOnly ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>Low &amp; Out of Stock ({lowStockCount})</button>
          </div>
        </div>
        <table className="min-w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">Supply</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Min. Threshold</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Unit cost</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const status = getStockStatus(item);
              const busy = busyId === item.id;
              return (
                <tr key={item.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 font-medium">{item.item_name}</td>
                  <td className="px-4 py-3">{item.current_stock} {item.unit}</td>
                  <td className="min-w-44 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`Minimum stock threshold for ${item.item_name}`}
                        type="number"
                        min="0"
                        step="0.001"
                        value={thresholdInputs[item.id] ?? String(item.low_stock_threshold)}
                        onChange={(event) => setThresholdInputs((current) => ({ ...current, [item.id]: event.target.value }))}
                        disabled={demo || busy}
                        className="w-24 rounded border border-slate-300 px-2 py-1"
                      />
                      <span>{item.unit}</span>
                      <button type="button" disabled={demo || busy} onClick={() => void saveThreshold(item)} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${status.style}`}>{status.label}</span></td>
                  <td className="px-4 py-3">฿{Number(item.unit_cost).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" disabled={demo || busy || Number(item.current_stock) <= 0} onClick={() => saveStock(item, Math.max(0, Number(item.current_stock) - 1))} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">−1</button>
                      <button type="button" disabled={demo || busy} onClick={() => saveStock(item, Number(item.current_stock) + 1, true)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">+1</button>
                      <input
                        aria-label={`Restock amount for ${item.item_name}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={restockAmounts[item.id] ?? String(item.auto_reorder_qty ?? 1)}
                        onChange={(event) => setRestockAmounts((current) => ({ ...current, [item.id]: event.target.value }))}
                        disabled={demo || busy}
                        className="w-20 rounded border border-slate-300 px-2 py-1"
                      />
                      <button
                        type="button"
                        disabled={demo || busy || Number(restockAmounts[item.id] ?? item.auto_reorder_qty ?? 1) <= 0}
                        onClick={() => saveStock(item, Number(item.current_stock) + Number(restockAmounts[item.id] ?? item.auto_reorder_qty ?? 1), true)}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-white disabled:opacity-50"
                      >
                        {busy ? 'Saving…' : 'Restock'}
                      </button>
                      <button type="button" disabled={demo || busy} onClick={() => handleDelete(item)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-rose-700 disabled:opacity-50">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!visibleItems.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{showLowStockOnly ? 'No low or out-of-stock ingredients.' : 'No supplies added yet.'}</td></tr>}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
