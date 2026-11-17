'use client';

import { useEffect, useState } from 'react';
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
  slot_type: 'standard' | 'milk';
};

export type ModifierSupplyRule = {
  modifier_name: string;
  action_type: 'replace_slot' | 'add_ingredient';
  target_slot: string | null;
  supply_id: string;
  quantity_used: number | null;
};

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  estimated_cost: number;
  is_available: boolean;
  has_sizes: boolean;
  size_prices: Record<'Small' | 'Medium' | 'Large', number>;
  ingredients: RecipeIngredient[];
};

const demoItems: MenuItem[] = [
  { id: 'demo-espresso', name: 'Espresso', category: 'Coffee', price: 45, estimated_cost: 12, is_available: true, has_sizes: true, size_prices: { Small: -10, Medium: 0, Large: 15 }, ingredients: [] },
  { id: 'demo-latte', name: 'Latte', category: 'Coffee', price: 75, estimated_cost: 20, is_available: true, has_sizes: true, size_prices: { Small: -10, Medium: 0, Large: 15 }, ingredients: [] },
  { id: 'demo-croissant', name: 'Butter Croissant', category: 'Bakery', price: 60, estimated_cost: 24, is_available: true, has_sizes: false, size_prices: { Small: -10, Medium: 0, Large: 15 }, ingredients: [] },
];

type MenuForm = {
  name: string;
  category: string;
  price: string;
  estimated_cost: string;
  is_available: boolean;
  has_sizes: boolean;
  size_prices: Record<'Small' | 'Medium' | 'Large', string>;
};
const defaultSizePrices = { Small: '-10', Medium: '0', Large: '15' };
const emptyForm: MenuForm = {
  name: '',
  category: 'Coffee',
  price: '',
  estimated_cost: '0',
  is_available: true,
  has_sizes: true,
  size_prices: defaultSizePrices,
};
const supportedModifiers = [
  'Oat Milk',
  'Soy Milk',
  'Extra Espresso Shot',
  'Vanilla Syrup',
  'Caramel Drizzle',
  'Small Cup',
  'Medium Cup',
  'Large Cup',
] as const;

function isNonDrinkCategory(category: string) {
  return /food|pastry|bakery|dessert|snack/i.test(category);
}

function formatPriceDelta(value: number) {
  const amount = Number(value) || 0;
  return `${amount > 0 ? '+' : amount < 0 ? '−' : ''}฿${Math.abs(amount).toFixed(2)}`;
}

export function MenuManager({
  menuItems,
  supplies,
  modifierRules,
  demo = false,
  isAdmin = false,
}: {
  menuItems: MenuItem[];
  supplies: MenuSupply[];
  modifierRules: ModifierSupplyRule[];
  demo?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(demo && !menuItems.length ? demoItems : menuItems);
  const [form, setForm] = useState<MenuForm>(emptyForm);
  const [ingredientAmounts, setIngredientAmounts] = useState<Record<string, string>>({});
  const [ingredientSlots, setIngredientSlots] = useState<Record<string, 'standard' | 'milk'>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recipeItem, setRecipeItem] = useState<MenuItem | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<Record<string, { quantity: string; slot_type: 'standard' | 'milk' }>>({});
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, { supply_id: string; quantity_used: string }>>({});
  const [ruleActions, setRuleActions] = useState<Record<string, 'replace_slot' | 'add_ingredient'>>({});
  const [rules, setRules] = useState(modifierRules);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    setRules(modifierRules);
  }, [modifierRules]);

  const getOwnerId = async () => {
    const context = await getFranchiseContext();
    return context.franchiseId;
  };

  const resetForm = () => {
    setForm(emptyForm);
    setIngredientAmounts({});
    setIngredientSlots({});
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
      has_sizes: item.has_sizes,
      size_prices: {
        Small: String(item.size_prices?.Small ?? -10),
        Medium: String(item.size_prices?.Medium ?? 0),
        Large: String(item.size_prices?.Large ?? 15),
      },
    });
    setIngredientAmounts(Object.fromEntries(item.ingredients.map((ingredient) => [
      ingredient.supply_id,
      String(ingredient.quantity_required),
    ])));
    setIngredientSlots(Object.fromEntries(item.ingredients.map((ingredient) => [
      ingredient.supply_id,
      ingredient.slot_type,
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
        .map(([supply_id, amount]) => ({
          supply_id,
          quantity_required: Number(amount),
          slot_type: ingredientSlots[supply_id] ?? 'standard',
        }));
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
        has_sizes: form.has_sizes && !isNonDrinkCategory(form.category),
        size_prices: Object.fromEntries(
          Object.entries(form.size_prices).map(([size, price]) => [size, Number(price)])
        ),
      };
      const saveResult = editingId
        ? await supabase.from('menu_items').update(values).eq('id', editingId)
          .select('id, name, category, price, estimated_cost, is_available, has_sizes, size_prices').single()
        : await supabase.from('menu_items').insert(values)
          .select('id, name, category, price, estimated_cost, is_available, has_sizes, size_prices').single();
      if (saveResult.error) throw saveResult.error;

      const itemId = saveResult.data.id;
      const { error: deleteIngredientsError } = await supabase
        .from('menu_item_recipes')
        .delete()
        .eq('tenant_id', ownerId)
        .eq('menu_item_id', itemId);
      if (deleteIngredientsError) {
        throw new Error(`Menu item saved, but its previous recipe could not be updated: ${deleteIngredientsError.message}`);
      }

      if (selectedIngredients.length) {
        const { error: insertIngredientsError } = await supabase
          .from('menu_item_recipes')
          .insert(selectedIngredients.map((ingredient) => ({
            tenant_id: ownerId,
            menu_item_id: itemId,
            supply_id: ingredient.supply_id,
            quantity_used: ingredient.quantity_required,
            slot_type: ingredient.slot_type,
          })));
        if (insertIngredientsError) {
          throw new Error(`Menu item saved, but its recipe could not be saved: ${insertIngredientsError.message}`);
        }
      }

      const updatedItem: MenuItem = {
        ...saveResult.data,
        ingredients: selectedIngredients.map(({ supply_id, quantity_required, slot_type }) => ({ supply_id, quantity_required, slot_type })),
      };
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

  const openRecipeEditor = (item: MenuItem) => {
    setRecipeItem(item);
    setRecipeDraft(Object.fromEntries(supplies.map((supply) => {
      const current = item.ingredients.find((ingredient) => ingredient.supply_id === supply.id);
      return [supply.id, {
        quantity: current ? String(current.quantity_required) : '',
        slot_type: current?.slot_type ?? 'standard',
      }];
    })));
    setErrorMessage('');
    setSuccessMessage('');
  };

  const saveRecipe = async () => {
    if (!recipeItem) return;
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(`recipe-${recipeItem.id}`);
    try {
      const ownerId = await getOwnerId();
      const ingredients = Object.entries(recipeDraft)
        .filter(([, value]) => Number(value.quantity) > 0)
        .map(([supply_id, value]) => ({
          tenant_id: ownerId,
          menu_item_id: recipeItem.id,
          supply_id,
          quantity_used: Number(value.quantity),
          slot_type: value.slot_type,
        }));
      if (Object.entries(recipeDraft).some(([, value]) => value.quantity && (!Number.isFinite(Number(value.quantity)) || Number(value.quantity) < 0))) {
        throw new Error('Recipe quantities must be positive numbers.');
      }

      const supabase = createSupabaseClient();
      const { error: deleteError } = await supabase.from('menu_item_recipes')
        .delete()
        .eq('tenant_id', ownerId)
        .eq('menu_item_id', recipeItem.id);
      if (deleteError) throw deleteError;
      if (ingredients.length) {
        const { error: insertError } = await supabase.from('menu_item_recipes').insert(ingredients);
        if (insertError) throw new Error(`Could not save recipe ingredients: ${insertError.message}`);
      }

      const cost = ingredients.reduce((total, ingredient) => {
        const unitCost = Number(supplies.find((supply) => supply.id === ingredient.supply_id)?.unit_cost ?? 0);
        return total + ingredient.quantity_used * unitCost;
      }, 0);
      const { error: menuUpdateError } = await supabase.from('menu_items')
        .update({ estimated_cost: cost })
        .eq('id', recipeItem.id)
        .eq('owner_id', ownerId);
      if (menuUpdateError) throw new Error(`Recipe saved, but menu cost could not be updated: ${menuUpdateError.message}`);

      const savedIngredients = ingredients.map((ingredient) => ({
        supply_id: ingredient.supply_id,
        quantity_required: ingredient.quantity_used,
        slot_type: ingredient.slot_type,
      }));
      setItems((current) => current.map((item) => item.id === recipeItem.id
        ? { ...item, ingredients: savedIngredients, estimated_cost: cost }
        : item));
      setRecipeItem(null);
      setSuccessMessage(`${recipeItem.name} recipe and cost updated.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save this recipe.');
    } finally {
      setBusyId(null);
    }
  };

  const saveModifierRule = async (modifierName: string) => {
    setErrorMessage('');
    setSuccessMessage('');
    setBusyId(`modifier-${modifierName}`);
    try {
      const ownerId = await getOwnerId();
      const draft = ruleDrafts[modifierName] ?? {
        supply_id: rules.find((rule) => rule.modifier_name === modifierName)?.supply_id ?? '',
        quantity_used: String(rules.find((rule) => rule.modifier_name === modifierName)?.quantity_used ?? (modifierName.endsWith('Cup') ? 1 : '')),
      };
      const actionType = ruleActions[modifierName]
        ?? rules.find((rule) => rule.modifier_name === modifierName)?.action_type
        ?? (modifierName.endsWith('Milk') ? 'replace_slot' : 'add_ingredient');
      const supabase = createSupabaseClient();
      if (!draft.supply_id) {
        const { error } = await supabase.from('modifier_supply_rules')
          .delete()
          .eq('tenant_id', ownerId)
          .eq('modifier_name', modifierName);
        if (error) throw error;
        setRules((current) => current.filter((rule) => rule.modifier_name !== modifierName));
        setSuccessMessage(`${modifierName} stock rule removed.`);
      } else {
        const quantity = Number(draft.quantity_used);
        if (actionType === 'add_ingredient' && (!Number.isFinite(quantity) || quantity <= 0)) {
          throw new Error('Enter a positive quantity for an added ingredient.');
        }
        const payload: ModifierSupplyRule & { tenant_id: string } = {
          tenant_id: ownerId,
          modifier_name: modifierName,
          action_type: actionType,
          target_slot: actionType === 'replace_slot' ? 'milk' : null,
          supply_id: draft.supply_id,
          quantity_used: actionType === 'add_ingredient' ? quantity : null,
        };
        const { data, error } = await supabase.from('modifier_supply_rules')
          .upsert(payload, { onConflict: 'tenant_id,modifier_name' })
          .select('modifier_name, action_type, target_slot, supply_id, quantity_used')
          .single();
        if (error) throw error;
        const updatedRule = { ...data, quantity_used: data.quantity_used === null ? null : Number(data.quantity_used) } as ModifierSupplyRule;
        setRules((current) => [
          ...current.filter((rule) => rule.modifier_name !== modifierName),
          updatedRule,
        ]);
        setSuccessMessage(`${modifierName} stock rule saved.`);
      }
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Could not save ${modifierName} stock rule.`);
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
              <input required value={form.category} onChange={(event) => setForm((current) => ({
                ...current,
                category: event.target.value,
                has_sizes: isNonDrinkCategory(event.target.value) ? false : current.has_sizes,
              }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Price (฿)
              <input required type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-700">Ingredient cost (฿)
              <input required type="number" min="0" step="0.01" value={form.estimated_cost} onChange={(event) => setForm((current) => ({ ...current, estimated_cost: event.target.value }))} disabled={demo || isSaving || Object.values(ingredientAmounts).some((amount) => Number(amount) > 0)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" checked={form.has_sizes} onChange={(event) => setForm((current) => ({ ...current, has_sizes: event.target.checked }))} disabled={demo || isSaving || isNonDrinkCategory(form.category)} />
              Enable drink sizes (Small / Medium / Large)
            </label>
            {isNonDrinkCategory(form.category) && <p className="mt-1 text-xs text-slate-500">Food, pastry, bakery, dessert, and snack items do not use drink sizes.</p>}
            {form.has_sizes && !isNonDrinkCategory(form.category) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {(['Small', 'Medium', 'Large'] as const).map((size) => (
                  <label key={size} className="text-sm text-slate-700">{size} price adjustment (฿)
                    <input type="number" step="0.01" value={form.size_prices[size]} onChange={(event) => setForm((current) => ({
                      ...current,
                      size_prices: { ...current.size_prices, [size]: event.target.value },
                    }))} disabled={demo || isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                ))}
              </div>
            )}
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
                    <select
                      aria-label={`${supply.item_name} recipe slot`}
                      value={ingredientSlots[supply.id] ?? 'standard'}
                      onChange={(event) => setIngredientSlots((current) => ({
                        ...current,
                        [supply.id]: event.target.value as 'standard' | 'milk',
                      }))}
                      disabled={demo || isSaving}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="standard">Standard</option>
                      <option value="milk">Milk base</option>
                    </select>
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
                <td className="px-4 py-3 font-medium">
                  {item.name}
                  {item.has_sizes && <p className="mt-1 text-xs font-normal text-slate-500">S {formatPriceDelta(item.size_prices.Small)} · M {formatPriceDelta(item.size_prices.Medium)} · L {formatPriceDelta(item.size_prices.Large)}</p>}
                </td>
                <td className="px-4 py-3">{item.category}</td>
                <td className="px-4 py-3">฿{Number(item.price).toFixed(2)}</td>
                {(isAdmin || demo) && <td className="px-4 py-3">฿{Number(item.estimated_cost).toFixed(2)}</td>}
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${item.is_available ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{item.is_available ? 'Available' : 'Unavailable'}</span>
                  {(isAdmin || demo) && item.ingredients.length > 0 && <p className="mt-1 text-xs text-slate-500">{item.ingredients.map((ingredient) => `${supplies.find((supply) => supply.id === ingredient.supply_id)?.item_name ?? 'Ingredient'} × ${ingredient.quantity_required}`).join(', ')}</p>}
                </td>
                {(isAdmin || demo) && <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button type="button" disabled={demo || !isAdmin || !!busyId} onClick={() => openRecipeEditor(item)} className="rounded-lg border border-brand-200 px-3 py-1.5 text-brand-700 disabled:opacity-50">Recipe & Cost</button>
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

      {isAdmin && !demo && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Modifier Stock Rules</h2>
          <p className="mt-1 text-sm text-slate-500">Map POS drink modifiers to cafe supplies. Milk options replace the recipe’s Milk base slot by default.</p>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {supportedModifiers.map((modifierName) => {
            const existing = rules.find((rule) => rule.modifier_name === modifierName);
            const draft = ruleDrafts[modifierName];
            const selectedSupplyId = draft?.supply_id ?? existing?.supply_id ?? '';
            const actionType = ruleActions[modifierName] ?? existing?.action_type ?? (modifierName.endsWith('Milk') ? 'replace_slot' : 'add_ingredient');
            const quantity = draft?.quantity_used ?? String(existing?.quantity_used ?? '');
            return (
              <div key={modifierName} className="rounded-xl border border-slate-200 p-3">
                <p className="font-semibold text-slate-900">{modifierName}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs text-slate-600">Action
                    <select value={actionType} onChange={(event) => setRuleActions((current) => ({
                      ...current,
                      [modifierName]: event.target.value as 'replace_slot' | 'add_ingredient',
                    }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                      <option value="replace_slot">Replace Milk Slot</option>
                      <option value="add_ingredient">Add Ingredient</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-600">Supply
                    <select value={selectedSupplyId} onChange={(event) => setRuleDrafts((current) => ({
                      ...current,
                      [modifierName]: { ...current[modifierName], supply_id: event.target.value,                       quantity_used: current[modifierName]?.quantity_used ?? (modifierName.endsWith('Cup') ? '1' : quantity) },
                    }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                      <option value="">Not linked</option>
                      {supplies.map((supply) => <option key={supply.id} value={supply.id}>{supply.item_name} ({supply.unit})</option>)}
                    </select>
                  </label>
                  {actionType === 'add_ingredient' && (
                    <label className="text-xs text-slate-600 sm:col-span-2">Quantity used per modifier
                      <input type="number" min="0.001" step="0.001" value={quantity || (modifierName.endsWith('Cup') ? '1' : '')} onChange={(event) => setRuleDrafts((current) => ({
                        ...current,
                        [modifierName]: { ...current[modifierName], supply_id: current[modifierName]?.supply_id ?? selectedSupplyId, quantity_used: event.target.value },
                      }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" />
                    </label>
                  )}
                  {actionType === 'replace_slot' && <p className="self-end text-xs text-slate-500 sm:col-span-2">Uses the quantity specified by each item’s Milk base recipe line.</p>}
                </div>
                <button type="button" disabled={busyId === `modifier-${modifierName}`} onClick={() => void saveModifierRule(modifierName)} className="mt-3 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {busyId === `modifier-${modifierName}` ? 'Saving…' : 'Save Stock Rule'}
                </button>
              </div>
            );
          })}
        </div>
      </section>}

      {recipeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && busyId !== `recipe-${recipeItem.id}`) setRecipeItem(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="recipe-dialog-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">Recipe & Cost</p>
                <h2 id="recipe-dialog-title" className="mt-1 text-xl font-bold text-slate-900">{recipeItem.name}</h2>
              </div>
              <button type="button" onClick={() => setRecipeItem(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Close</button>
            </div>
            <div className="mt-4 space-y-2">
              {supplies.map((supply) => {
                const draft = recipeDraft[supply.id] ?? { quantity: '', slot_type: 'standard' as const };
                return (
                  <div key={supply.id} className="grid items-center gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_140px_160px]">
                    <label htmlFor={`recipe-${supply.id}`} className="font-medium text-slate-800">{supply.item_name} <span className="text-sm text-slate-500">({supply.unit})</span></label>
                    <div className="flex items-center gap-2">
                      <input id={`recipe-${supply.id}`} aria-label={`${supply.item_name} quantity used`} type="number" min="0" step="0.001" value={draft.quantity} onChange={(event) => setRecipeDraft((current) => ({
                        ...current,
                        [supply.id]: { ...draft, quantity: event.target.value },
                      }))} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                      <span className="text-sm text-slate-500">{supply.unit}</span>
                    </div>
                    <select aria-label={`${supply.item_name} recipe slot`} value={draft.slot_type} onChange={(event) => setRecipeDraft((current) => ({
                      ...current,
                      [supply.id]: { ...draft, slot_type: event.target.value as 'standard' | 'milk' },
                    }))} className="rounded-lg border border-slate-300 px-3 py-2">
                      <option value="standard">Standard ingredient</option>
                      <option value="milk">Milk base slot</option>
                    </select>
                  </div>
                );
              })}
              {!supplies.length && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Add supplies in Inventory before building a recipe.</p>}
            </div>
            {(() => {
              const cost = Object.entries(recipeDraft).reduce((total, [supplyId, draft]) => {
                return total + Math.max(0, Number(draft.quantity) || 0) * Number(supplies.find((supply) => supply.id === supplyId)?.unit_cost ?? 0);
              }, 0);
              const margin = recipeItem.price > 0 ? ((recipeItem.price - cost) / recipeItem.price) * 100 : 0;
              return (
                <div className="mt-4 grid gap-3 rounded-xl bg-brand-50 p-4 sm:grid-cols-2">
                  <div><p className="text-sm text-brand-800">Drink Cost (COGS)</p><p className="text-xl font-bold text-brand-950">฿{cost.toFixed(2)}</p></div>
                  <div><p className="text-sm text-brand-800">Net Profit Margin</p><p className="text-xl font-bold text-brand-950">{margin.toFixed(1)}%</p></div>
                </div>
              );
            })()}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busyId === `recipe-${recipeItem.id}`} onClick={() => setRecipeItem(null)} className="rounded-lg border border-slate-300 px-4 py-2">Cancel</button>
              <button type="button" disabled={busyId === `recipe-${recipeItem.id}`} onClick={() => void saveRecipe()} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                {busyId === `recipe-${recipeItem.id}` ? 'Saving…' : 'Save Recipe'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
