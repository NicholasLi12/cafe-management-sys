'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';
import { getFranchiseContext } from '@/lib/supabase/franchise-client';

export type MenuSupply = {
  id: string;
  item_name: string;
  unit: string;
  unit_cost: number;
};

export type RecipeIngredient = {
  supply_id: string;
  quantity_required: number;
};

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  estimated_cost: number;
  is_available: boolean;
  ingredients: RecipeIngredient[];
};

const demoItems: MenuItem[] = [
  { id: 'demo-espresso', name: 'Espresso', category: 'Coffee', price: 45, estimated_cost: 12, is_available: true, ingredients: [] },
  { id: 'demo-latte', name: 'Latte', category: 'Coffee', price: 75, estimated_cost: 20, is_available: true, ingredients: [] },
  { id: 'demo-croissant', name: 'Butter Croissant', category: 'Bakery', price: 60, estimated_cost: 24, is_available: true, ingredients: [] },
];

type MenuForm = { name: string; category: string; price: string; estimated_cost: string; is_available: boolean };
const emptyForm: MenuForm = { name: '', category: 'Coffee', price: '', estimated_cost: '0', is_available: true };

export function MenuManager({
  menuItems,
  supplies,
  demo = false,
  isAdmin = false,
}: {
  menuItems: MenuItem[];
  supplies: MenuSupply[];
  demo?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(demo && !menuItems.length ? demoItems : menuItems);
  const [form, setForm] = useState<MenuForm>(emptyForm);
  const [ingredientAmounts, setIngredientAmounts] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const getOwnerId = async () => {
    const context = await getFranchiseContext();
    return context.franchiseId;
  };

  const resetForm = () => {
    setForm(emptyForm);
    setIngredientAmounts({});
    setEditingId(null);
  };

  const startEditing = (item: MenuItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      category: item.category,
      price: String(item.price),
      estimated_cost: String(item.estimated_cost),
      is_available: item.is_available,
    });
    setIngredientAmounts(Object.fromEntries(item.ingredients.map((ingredient) => [
      ingredient.supply_id,
      String(ingredient.quantity_required),
    ])));
    setErrorMessage('');
    setSuccessMessage('');
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);

    try {
      const ownerId = await getOwnerId();
      const selectedIngredients = Object.entries(ingredientAmounts)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([supply_id, amount]) => ({ supply_id, quantity_required: Number(amount) }));
      const supplyCosts = new Map(supplies.map((supply) => [supply.id, Number(supply.unit_cost)]));
      const estimatedCost = selectedIngredients.length
        ? selectedIngredients.reduce((total, ingredient) => total + ingredient.quantity_required * (supplyCosts.get(ingredient.supply_id) ?? 0), 0)
        : Number(form.estimated_cost);
      const supabase = createSupabaseClient();
      const values = {
        owner_id: ownerId,
        name: form.name.trim(),
        category: form.category.trim(),
        price: Number(form.price),
        estimated_cost: estimatedCost,
        is_available: form.is_available,
      };
      const saveResult = editingId
        ? await supabase.from('menu_items').update(values).eq('id', editingId)
          .select('id, name, category, price, estimated_cost, is_available').single()
        : await supabase.from('menu_items').insert(values)
          .select('id, name, category, price, estimated_cost, is_available').single();
      if (saveResult.error) throw saveResult.error;

      const itemId = saveResult.data.id;
      const { error: deleteIngredientsError } = await supabase
        .from('menu_item_ingredients')
        .delete()
        .eq('menu_item_id', itemId);
      if (deleteIngredientsError) {
        throw new Error(`Menu item saved, but its previous recipe could not be updated: ${deleteIngredientsError.message}`);
      }

      if (selectedIngredients.length) {
        const { error: insertIngredientsError } = await supabase
          .from('menu_item_ingredients')
          .insert(selectedIngredients.map((ingredient) => ({ menu_item_id: itemId, ...ingredient })));
        if (insertIngredientsError) {
          throw new Error(`Menu item saved, but its recipe could not be saved: ${insertIngredientsError.message}`);
        }
      }

      const updatedItem: MenuItem = { ...saveResult.data, ingredients: selectedIngredients };
      setItems((current) => editingId
        ? current.map((item) => item.id === itemId ? updatedItem : item)
        : [...current, updatedItem].sort((a, b) => a.name.localeCompare(b.name)));
      resetForm();
      setSuccessMessage(editingId ? 'Menu item updated.' : 'Menu item added.');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save menu item.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: MenuItem) => {
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(item.id);
    try {
      await getOwnerId();
      const { error } = await createSupabaseClient().from('menu_items').delete().eq('id', item.id);
      if (error) throw error;
      setItems((current) => current.filter((row) => row.id !== item.id));
      if (editingId === item.id) resetForm();
      setSuccessMessage(`${item.name} deleted.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not delete menu item.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {demo && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">Demo menu is read-only. Sign in to manage live menu items.</p>}
      {errorMessage && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p>}

      {(isAdmin || demo) && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-slate-900">{editingId ? 'Edit Menu Item' : 'Add Menu Item'}</h2>
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-slate-700">Name
              <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Category
              <input required value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Price (฿)
              <input required type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Ingredient cost (฿)
              <input required type="number" min="0" step="0.01" value={form.estimated_cost} onChange={(event) => setForm((current) => ({ ...current, estimated_cost: event.target.value }))} disabled={demo || isSaving || Object.values(ingredientAmounts).some((amount) => Number(amount) > 0)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.is_available} onChange={(event) => setForm((current) => ({ ...current, is_available: event.target.checked }))} disabled={demo || isSaving} />
            Available for orders
          </label>

          {supplies.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold text-slate-800">Recipe ingredients (quantity per item)</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {supplies.map((supply) => (
                  <label key={supply.id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
                    <span className="min-w-0 flex-1">{supply.item_name} ({supply.unit})</span>
                    <input
                      aria-label={`${supply.item_name} quantity required`}
                      type="number"
                      min="0"
                      step="0.001"
                      value={ingredientAmounts[supply.id] ?? ''}
                      onChange={(event) => setIngredientAmounts((current) => ({ ...current, [supply.id]: event.target.value }))}
                      disabled={demo || isSaving}
                      placeholder="0"
                      className="w-24 rounded border border-slate-300 px-2 py-1"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">When recipe quantities are set, ingredient cost is calculated from inventory unit costs.</p>
            </fieldset>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={demo || isSaving} className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">{isSaving ? 'Saving…' : editingId ? 'Save changes' : 'Add menu item'}</button>
            {editingId && <button type="button" onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700">Cancel</button>}
          </div>
        </form>
      </section>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-soft">
        <table className="min-w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Price</th>{(isAdmin || demo) ? <><th className="px-4 py-3">Ingredient cost</th><th className="px-4 py-3">Availability / recipe</th><th className="px-4 py-3">Actions</th></> : <th className="px-4 py-3">Availability</th>}</tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-slate-200">
                <td className="px-4 py-3 font-medium">{item.name}</td>
                <td className="px-4 py-3">{item.category}</td>
                <td className="px-4 py-3">฿{Number(item.price).toFixed(2)}</td>
                {(isAdmin || demo) && <td className="px-4 py-3">฿{Number(item.estimated_cost).toFixed(2)}</td>}
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${item.is_available ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{item.is_available ? 'Available' : 'Unavailable'}</span>
                  {(isAdmin || demo) && item.ingredients.length > 0 && <p className="mt-1 text-xs text-slate-500">{item.ingredients.map((ingredient) => `${supplies.find((supply) => supply.id === ingredient.supply_id)?.item_name ?? 'Ingredient'} × ${ingredient.quantity_required}`).join(', ')}</p>}
                </td>
                {(isAdmin || demo) && <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button type="button" disabled={demo || !isAdmin || !!busyId} onClick={() => startEditing(item)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50">Edit</button>
                    <button type="button" disabled={demo || !isAdmin || busyId === item.id} onClick={() => handleDelete(item)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-rose-700 disabled:opacity-50">{busyId === item.id ? 'Deleting…' : 'Delete'}</button>
                  </div>
                </td>}
              </tr>
            ))}
            {!items.length && <tr><td colSpan={isAdmin || demo ? 6 : 4} className="px-4 py-8 text-center text-slate-500">No menu items added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
