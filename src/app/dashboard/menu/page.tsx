import { DashboardShell } from '@/components/dashboard-shell';
import { MenuManager, type MenuItem, type MenuSupply, type ModifierSupplyRule, type RecipeIngredient } from '@/components/menu-manager';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

export default async function MenuPage() {
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();
  if (authError) {
    return <DashboardShell><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify your session: {authError.message}</p></DashboardShell>;
  }

  let menuItems: MenuItem[] = [];
  let supplies: MenuSupply[] = [];
  let modifierRules: ModifierSupplyRule[] = [];
  let cafeName: string | undefined;
  let ownerName: string | null = null;
  let role: 'admin' | 'barista' | null = null;
  if (user) {
    if (profileError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load your profile: {profileError.message}</p></DashboardShell>;
    if (!profile) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">No profile was found for this account.</p></DashboardShell>;
    role = profile.role === 'barista' ? 'barista' : 'admin';
    cafeName = profile.cafe_name;
    ownerName = profile.owner_name;
    const franchiseId = profile.franchise_owner_id ?? user.id;
    const [baseItemsResult, supplyResult] = await Promise.all([
      role === 'admin'
        ? supabase.from('menu_items').select('id, name, category, price, estimated_cost, is_available, has_sizes, size_prices').eq('owner_id', franchiseId).order('name')
        : supabase.from('menu_items').select('id, name, category, price, is_available, has_sizes, size_prices').eq('owner_id', franchiseId).order('name'),
      role === 'admin'
        ? supabase.from('supplies').select('id, item_name, unit, unit_cost').eq('owner_id', franchiseId).order('item_name')
        : supabase.from('supplies').select('id, item_name, unit').eq('owner_id', franchiseId).order('item_name'),
    ]);
    if (baseItemsResult.error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load menu data: {baseItemsResult.error.message}</p></DashboardShell>;
    if (supplyResult.error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load menu ingredients: {supplyResult.error.message}</p></DashboardShell>;

    const baseItems = baseItemsResult.data ?? [];
    supplies = (supplyResult.data ?? []).map((supply) => ({
      ...supply,
      unit_cost: Number('unit_cost' in supply ? supply.unit_cost ?? 0 : 0),
    })) as MenuSupply[];

    {
      const recipeQuery = baseItems.length
        ? supabase
          .from('menu_item_recipes')
          .select('menu_item_id, supply_id, quantity_used, slot_type')
          .eq('tenant_id', franchiseId)
          .in('menu_item_id', baseItems.map((item) => item.id))
        : Promise.resolve({ data: [], error: null });
      const [recipeResult, modifierRulesResult] = await Promise.all([
        recipeQuery,
        supabase.from('modifier_supply_rules')
          .select('id, modifier_name, group_type, action_type, target_slot, supply_id, quantity_used, price_delta, is_active, sort_order')
          .eq('tenant_id', franchiseId),
      ]);
      if (recipeResult.error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load menu recipes: {recipeResult.error.message}</p></DashboardShell>;
      if (modifierRulesResult.error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load modifier stock rules: {modifierRulesResult.error.message}</p></DashboardShell>;
      modifierRules = (modifierRulesResult.data ?? []).map((rule) => ({
        ...rule,
        supply_name: supplies.find((supply) => supply.id === rule.supply_id)?.item_name ?? null,
        supply_unit: supplies.find((supply) => supply.id === rule.supply_id)?.unit ?? null,
        price_delta: Number(rule.price_delta),
        quantity_used: rule.quantity_used === null ? null : Number(rule.quantity_used),
      })) as ModifierSupplyRule[];
      const recipesByItem = new Map<string, RecipeIngredient[]>();
      for (const recipe of recipeResult.data ?? []) {
        const ingredients = recipesByItem.get(recipe.menu_item_id) ?? [];
        ingredients.push({
          supply_id: recipe.supply_id,
          quantity_required: Number(recipe.quantity_used),
          slot_type: recipe.slot_type as RecipeIngredient['slot_type'],
        });
        recipesByItem.set(recipe.menu_item_id, ingredients);
      }
      menuItems = baseItems.map((item) => ({
        ...item,
        price: Number(item.price),
        estimated_cost: Number('estimated_cost' in item ? item.estimated_cost ?? 0 : 0),
        is_available: Boolean(item.is_available),
        has_sizes: item.has_sizes,
        size_prices: item.size_prices,
        ingredients: recipesByItem.get(item.id) ?? [],
      }));
    }
  }

  return (
    <DashboardShell mode={user ? 'live' : 'demo'} cafeName={cafeName} ownerName={ownerName} role={role}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Menu</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Menu & Recipe Controls</h1>
          <p className="mt-1 text-sm text-slate-500">Manage menu availability, pricing, recipes, and drink options.</p>
        </div>
        <MenuManager menuItems={menuItems} supplies={supplies} modifierRules={modifierRules} demo={!user} isAdmin={!user || role === 'admin'} />
      </div>
    </DashboardShell>
  );
}
