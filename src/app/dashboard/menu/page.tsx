import { DashboardShell } from '@/components/dashboard-shell';
import { MenuManager, type MenuItem, type MenuSupply, type RecipeIngredient } from '@/components/menu-manager';
import { getDashboardContext } from '@/lib/supabase/dashboard-context';

export default async function MenuPage() {
  const { supabase, user, profile, authError, profileError } = await getDashboardContext();
  if (authError) {
    return <DashboardShell><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not verify your session: {authError.message}</p></DashboardShell>;
  }

  let menuItems: MenuItem[] = [];
  let supplies: MenuSupply[] = [];
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
        ? supabase.from('menu_items').select('id, name, category, price, estimated_cost, is_available').eq('owner_id', franchiseId).order('name')
        : supabase.from('menu_items').select('id, name, category, price, is_available').eq('owner_id', franchiseId).order('name'),
      role === 'admin'
        ? supabase.from('supplies').select('id, item_name, unit, unit_cost').eq('owner_id', franchiseId).order('item_name')
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (baseItemsResult.error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load menu data: {baseItemsResult.error.message}</p></DashboardShell>;
    if (supplyResult.error) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load menu ingredients: {supplyResult.error.message}</p></DashboardShell>;

    const baseItems = baseItemsResult.data ?? [];
    if (role === 'admin') {
      supplies = (supplyResult.data ?? []) as MenuSupply[];
    }

    if (baseItems.length && role === 'admin') {
      const { data: recipeRows, error: recipeError } = await supabase
        .from('menu_item_ingredients')
        .select('menu_item_id, supply_id, quantity_required')
        .in('menu_item_id', baseItems.map((item) => item.id));
      if (recipeError) return <DashboardShell mode="live"><p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">Could not load menu recipes: {recipeError.message}</p></DashboardShell>;
      const recipesByItem = new Map<string, RecipeIngredient[]>();
      for (const recipe of recipeRows ?? []) {
        const ingredients = recipesByItem.get(recipe.menu_item_id) ?? [];
        ingredients.push({ supply_id: recipe.supply_id, quantity_required: Number(recipe.quantity_required) });
        recipesByItem.set(recipe.menu_item_id, ingredients);
      }
      menuItems = baseItems.map((item) => ({
        ...item,
        price: Number(item.price),
        estimated_cost: Number('estimated_cost' in item ? item.estimated_cost ?? 0 : 0),
        is_available: Boolean(item.is_available),
        ingredients: recipesByItem.get(item.id) ?? [],
      }));
    } else {
      menuItems = baseItems.map((item) => ({
        ...item,
        price: Number(item.price),
        estimated_cost: 0,
        is_available: Boolean(item.is_available),
        ingredients: [],
      }));
    }
  }

  return (
    <DashboardShell mode={user ? 'live' : 'demo'} cafeName={cafeName} ownerName={ownerName} role={role}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Menu</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Menu & Recipe Controls</h1>
        </div>
        <MenuManager menuItems={menuItems} supplies={supplies} demo={!user} isAdmin={!user || role === 'admin'} />
      </div>
    </DashboardShell>
  );
}
