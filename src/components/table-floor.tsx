'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';
import { getFranchiseContext } from '@/lib/supabase/franchise-client';
import { formatCurrencyTHB } from '@/lib/currency';

export type CafeTable = {
  id: string;
  table_number: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved';
};

export type OrderMenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  estimated_cost: number;
};

const demoTables: CafeTable[] = [
  { id: 'demo-table-1', table_number: 'T1', capacity: 2, status: 'available' },
  { id: 'demo-table-2', table_number: 'T2', capacity: 4, status: 'occupied' },
  { id: 'demo-table-3', table_number: 'T3', capacity: 2, status: 'reserved' },
];
const demoMenu: OrderMenuItem[] = [
  { id: 'demo-latte', name: 'Latte', category: 'Coffee', price: 75, estimated_cost: 20 },
  { id: 'demo-croissant', name: 'Butter Croissant', category: 'Bakery', price: 60, estimated_cost: 24 },
];
const statusStyles = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  occupied: 'bg-amber-50 text-amber-700 border-amber-200',
  reserved: 'bg-violet-50 text-violet-700 border-violet-200',
};
type DrinkModifier = { group: string; option: string; upcharge: number };
type CartLine = {
  menu_item_id: string;
  quantity: number;
  unit_price: number;
  modifiers: DrinkModifier[];
  notes: string;
};
type OrderType = 'dine_in' | 'pickup' | 'online_delivery';
type ModifierChoices = {
  sweetness: string;
  ice: string;
  milk: string;
  addOns: string[];
  notes: string;
};

const defaultModifierChoices: ModifierChoices = {
  sweetness: '100%',
  ice: 'Normal',
  milk: 'Regular',
  addOns: [],
  notes: '',
};

const milkUpcharges: Record<string, number> = { Regular: 0, 'Oat Milk': 15, 'Soy Milk': 10 };
const addOnUpcharges: Record<string, number> = {
  'Extra Espresso Shot': 20,
  'Vanilla Syrup': 10,
  'Caramel Drizzle': 10,
};

function isDrink(item: OrderMenuItem) {
  return /coffee|tea|drink|beverage|juice|smoothie|latte|espresso/i.test(item.category);
}

function getModifiers(choices: ModifierChoices): DrinkModifier[] {
  return [
    { group: 'Sweetness', option: choices.sweetness, upcharge: 0 },
    { group: 'Ice', option: choices.ice, upcharge: 0 },
    { group: 'Milk', option: choices.milk, upcharge: milkUpcharges[choices.milk] ?? 0 },
    ...Object.keys(addOnUpcharges)
      .filter((addOn) => choices.addOns.includes(addOn))
      .map((addOn) => ({ group: 'Add-on', option: addOn, upcharge: addOnUpcharges[addOn] })),
  ];
}

function modifierSignature(line: Pick<CartLine, 'modifiers' | 'notes'>) {
  return JSON.stringify(line.modifiers) + line.notes.trim();
}

function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred.';
}

export function TableFloor({
  tables,
  menuItems,
  demo = false,
  isAdmin = false,
}: {
  tables: CafeTable[];
  menuItems: OrderMenuItem[];
  demo?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [tableRows, setTableRows] = useState(demo && !tables.length ? demoTables : tables);
  const orderMenu = demo && !menuItems.length ? demoMenu : menuItems;
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizingItem, setCustomizingItem] = useState<OrderMenuItem | null>(null);
  const [modifierChoices, setModifierChoices] = useState<ModifierChoices>(defaultModifierChoices);
  const [isAddingTable, setIsAddingTable] = useState(false);
  const [isRecordingOrder, setIsRecordingOrder] = useState(false);
  const [busyTableId, setBusyTableId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const addToCart = (item: OrderMenuItem, modifiers: DrinkModifier[] = [], notes = '') => {
    const unitPrice = item.price + modifiers.reduce((sum, modifier) => sum + modifier.upcharge, 0);
    const signature = modifierSignature({ modifiers, notes });
    setCart((current) => {
      const existing = current.find((line) => line.menu_item_id === item.id && modifierSignature(line) === signature);
      if (existing) {
        return current.map((line) => line === existing ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, { menu_item_id: item.id, quantity: 1, unit_price: unitPrice, modifiers, notes: notes.trim() }];
    });
  };

  const selectMenuItem = (item: OrderMenuItem) => {
    if (isDrink(item)) {
      setModifierChoices(defaultModifierChoices);
      setCustomizingItem(item);
    } else {
      addToCart(item);
    }
  };

  const addCustomizedDrink = () => {
    if (!customizingItem) return;
    addToCart(customizingItem, getModifiers(modifierChoices), modifierChoices.notes);
    setCustomizingItem(null);
  };

  const getOwnerId = async () => {
    const context = await getFranchiseContext();
    return context.franchiseId;
  };

  const handleAddTable = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsAddingTable(true);
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const ownerId = await getOwnerId();
      const { data, error } = await createSupabaseClient().from('cafe_tables')
        .insert({
          owner_id: ownerId,
          table_number: String(formData.get('table_number')).trim(),
          capacity: Number(formData.get('capacity')),
          status: String(formData.get('status')),
        })
        .select('id, table_number, capacity, status')
        .single();
      if (error) throw error;
      setTableRows((current) => [...current, data].sort((a, b) => a.table_number.localeCompare(b.table_number)));
      form.reset();
      setSuccessMessage(`Table ${data.table_number} added.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not add table.');
    } finally {
      setIsAddingTable(false);
    }
  };

  const toggleTableStatus = async (table: CafeTable) => {
    setErrorMessage('');
    setSuccessMessage('');
    setBusyTableId(table.id);
    const nextStatus = table.status === 'occupied' ? 'available' : 'occupied';
    try {
      await getOwnerId();
      const { data, error } = await createSupabaseClient().from('cafe_tables')
        .update({ status: nextStatus })
        .eq('id', table.id)
        .select('id, table_number, capacity, status')
        .single();
      if (error) throw error;
      setTableRows((current) => current.map((row) => row.id === table.id ? data : row));
      setSuccessMessage(`Table ${table.table_number} is now ${nextStatus}.`);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update table status.');
    } finally {
      setBusyTableId(null);
    }
  };

  const handleRecordOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsRecordingOrder(true);
    const formData = new FormData(event.currentTarget);
    const items = cart.filter((line) => line.menu_item_id && Number.isInteger(Number(line.quantity)) && line.quantity > 0);
    if (!items.length) {
      setErrorMessage('Add at least one menu item with a valid quantity.');
      setIsRecordingOrder(false);
      return;
    }
    if (orderType === 'dine_in' && !formData.get('table_id')) {
      setErrorMessage('Choose a table for a dine-in order.');
      setIsRecordingOrder(false);
      return;
    }

    try {
      const ownerId = await getOwnerId();
      const supabase = createSupabaseClient();
      const platformFeeValue = String(formData.get('platform_fee') ?? '').trim();
      const platformFee = platformFeeValue ? Number(platformFeeValue) : 0;
      if (!Number.isFinite(platformFee) || platformFee < 0) {
        throw new Error('Platform fee must be a non-negative amount.');
      }

      const tableId = orderType === 'dine_in' ? String(formData.get('table_id')) : null;
      if (tableId) {
        const { data: table, error: tableError } = await supabase
          .from('cafe_tables')
          .select('id')
          .eq('id', tableId)
          .eq('owner_id', ownerId)
          .maybeSingle();
        if (tableError) throw tableError;
        if (!table) throw new Error('The selected table does not belong to this cafe.');
      }

      const menuItemIds = Array.from(new Set(items.map((item) => item.menu_item_id)));
      const { data: selectedMenuItems, error: menuError } = await supabase
        .from('menu_items')
        .select('id, price, is_available')
        .eq('owner_id', ownerId)
        .in('id', menuItemIds);
      if (menuError) throw menuError;

      const menuById = new Map((selectedMenuItems ?? []).map((menuItem) => [menuItem.id, menuItem]));
      const orderItems = items.map((item) => {
        const menuItem = menuById.get(item.menu_item_id);
        if (!menuItem || !menuItem.is_available) {
          throw new Error('A selected menu item is unavailable or does not belong to this cafe.');
        }

        return {
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          modifiers: item.modifiers,
          notes: item.notes.trim() || null,
        };
      });
      const totalAmount = orderItems.reduce(
        (total, item) => total + item.quantity * item.unit_price,
        0
      );
      const notes = String(formData.get('notes') ?? '').trim() || null;
      const platformName = orderType === 'online_delivery'
        ? String(formData.get('platform_name') ?? '').trim()
        : 'In-House';
      if (orderType === 'online_delivery' && !platformName) {
        throw new Error('Delivery platform name is required.');
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          owner_id: ownerId,
          table_id: tableId,
          order_type: orderType,
          payment_method: String(formData.get('payment_method')),
          notes,
          platform_name: platformName,
          external_order_ref: orderType === 'online_delivery'
            ? String(formData.get('external_order_ref') ?? '').trim() || null
            : null,
          platform_fee: orderType === 'online_delivery' ? platformFee : 0,
          status: 'paid',
          total_amount: totalAmount,
          closed_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (orderError) throw orderError;
      if (!order) throw new Error('Order was not created.');

      const { error: orderItemsError } = await supabase
        .from('order_items')
        .insert(orderItems.map((item) => ({ ...item, order_id: order.id })));
      if (orderItemsError) {
        const { error: cleanupError } = await supabase
          .from('orders')
          .delete()
          .eq('id', order.id)
          .eq('owner_id', ownerId);
        if (cleanupError) {
          throw new Error(
            `Could not save order items: ${orderItemsError.message}. The incomplete order could not be removed: ${cleanupError.message}`
          );
        }
        throw orderItemsError;
      }

      let tableStatusWarning = '';
      if (tableId) {
        const { error: updateTableError } = await supabase
          .from('cafe_tables')
          .update({ status: 'occupied' })
          .eq('id', tableId)
          .eq('owner_id', ownerId);
        if (updateTableError) {
          tableStatusWarning = ` Table status could not be updated: ${updateTableError.message}`;
        } else {
          setTableRows((current) => current.map((table) => table.id === tableId ? { ...table, status: 'occupied' } : table));
        }
      }

      setCart([]);
      setSuccessMessage(`Paid order recorded successfully (${order.id.slice(0, 8)}).${tableStatusWarning}`);
      router.refresh();
    } catch (error) {
      setErrorMessage(`Could not record paid order: ${getErrorMessage(error)}`);
    } finally {
      setIsRecordingOrder(false);
    }
  };

  const total = cart.reduce((sum, line) => {
    return sum + line.unit_price * line.quantity;
  }, 0);

  return (
    <div className="space-y-6">
      {demo && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">Demo tables and menu are read-only. Sign in to manage tables or record orders.</p>}
      {errorMessage && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p>}

      {(isAdmin || demo) && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-slate-900">Add Table</h2>
        <form onSubmit={handleAddTable} className="mt-4 grid gap-3 sm:grid-cols-4">
          <label className="text-sm text-slate-700">Table number / name
            <input name="table_number" required disabled={demo || isAddingTable} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="T7" />
          </label>
          <label className="text-sm text-slate-700">Seats
            <input name="capacity" type="number" min="1" step="1" defaultValue="2" required disabled={demo || isAddingTable} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-700">Status
            <select name="status" defaultValue="available" disabled={demo || isAddingTable} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="available">Available</option><option value="occupied">Occupied</option><option value="reserved">Reserved</option>
            </select>
          </label>
          <button type="submit" disabled={demo || isAddingTable} className="self-end rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">{isAddingTable ? 'Saving…' : 'Add table'}</button>
        </form>
      </section>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-slate-900">Record Paid Order</h2>
        <form onSubmit={handleRecordOrder} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-slate-700">Order type
              <select value={orderType} onChange={(event) => setOrderType(event.target.value as OrderType)} disabled={demo || isRecordingOrder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="dine_in">Dine-in</option><option value="pickup">Takeaway / pickup</option><option value="online_delivery">Delivery</option>
              </select>
            </label>
            {orderType === 'dine_in' ? (
              <label className="text-sm text-slate-700">Table
                <select name="table_id" required disabled={demo || isRecordingOrder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">Select a table</option>
                  {tableRows.map((table) => <option key={table.id} value={table.id}>{table.table_number} · {table.status}</option>)}
                </select>
              </label>
            ) : orderType === 'online_delivery' ? (
              <>
                <label className="text-sm text-slate-700">Delivery platform
                  <input name="platform_name" required defaultValue="Grab" disabled={demo || isRecordingOrder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-700">Platform fee (฿)
                  <input name="platform_fee" type="number" min="0" step="0.01" disabled={demo || isRecordingOrder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Optional" />
                </label>
                <label className="text-sm text-slate-700">External order reference
                  <input name="external_order_ref" disabled={demo || isRecordingOrder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </label>
              </>
            ) : null}
            <label className="text-sm text-slate-700">Payment method
              <select name="payment_method" defaultValue="cash" disabled={demo || isRecordingOrder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="cash">Cash</option><option value="card">Card</option><option value="qr_transfer">QR transfer</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">Notes
              <input name="notes" disabled={demo || isRecordingOrder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700">Tap an item to add it</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {orderMenu.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-500">{item.category} · {formatCurrencyTHB(item.price)}</p>
                  {isDrink(item) ? (
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={demo || isRecordingOrder} onClick={() => selectMenuItem(item)} className="min-h-11 flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Customize</button>
                      <button type="button" disabled={demo || isRecordingOrder} onClick={() => addToCart(item, getModifiers(defaultModifierChoices))} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Quick Add Default</button>
                    </div>
                  ) : (
                    <button type="button" disabled={demo || isRecordingOrder} onClick={() => selectMenuItem(item)} className="mt-3 min-h-11 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Add to order</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-700">Order items</h3>
            {cart.map((line, index) => {
              const item = orderMenu.find((menuItem) => menuItem.id === line.menu_item_id);
              return (
                <div key={`${line.menu_item_id}-${modifierSignature(line)}-${index}`} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{item?.name ?? 'Menu item'} · {formatCurrencyTHB(line.unit_price)} each</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {line.modifiers.map((modifier, modifierIndex) => (
                        <span key={`${modifier.group}-${modifier.option}-${modifierIndex}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {modifier.option}{modifier.upcharge > 0 ? ` +${formatCurrencyTHB(modifier.upcharge)}` : ''}
                        </span>
                      ))}
                    </div>
                    {line.notes && <p className="mt-1 text-xs text-slate-500">Note: {line.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label={`Decrease ${item?.name ?? 'item'} quantity`} disabled={demo || isRecordingOrder} onClick={() => setCart((current) => current.flatMap((cartLine, cartIndex) => {
                      if (cartIndex !== index) return [cartLine];
                      return cartLine.quantity > 1 ? [{ ...cartLine, quantity: cartLine.quantity - 1 }] : [];
                    }))} className="min-h-10 min-w-10 rounded-lg border border-slate-300 text-lg disabled:opacity-50">−</button>
                    <span className="min-w-6 text-center font-medium">{line.quantity}</span>
                    <button type="button" aria-label={`Increase ${item?.name ?? 'item'} quantity`} disabled={demo || isRecordingOrder} onClick={() => setCart((current) => current.map((cartLine, cartIndex) => cartIndex === index ? { ...cartLine, quantity: cartLine.quantity + 1 } : cartLine))} className="min-h-10 min-w-10 rounded-lg border border-slate-300 text-lg disabled:opacity-50">+</button>
                    <button type="button" aria-label={`Remove ${item?.name ?? 'item'}`} disabled={demo || isRecordingOrder} onClick={() => setCart((current) => current.filter((_, cartIndex) => cartIndex !== index))} className="min-h-10 rounded-lg border border-rose-200 px-3 text-sm text-rose-700 disabled:opacity-50">Remove</button>
                  </div>
                </div>
              );
            })}
            {!cart.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Your order is empty.</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <span className="self-center text-sm font-semibold text-slate-800">Items total {formatCurrencyTHB(total)}</span>
            </div>
            <button type="submit" disabled={demo || isRecordingOrder || !cart.length} className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50">{isRecordingOrder ? 'Recording…' : 'Record paid order'}</button>
          </div>
          {!orderMenu.length && <p className="text-sm text-slate-500">Add an available menu item before recording orders.</p>}
        </form>
      </section>

      {customizingItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCustomizingItem(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="drink-modal-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Customize drink</p>
                <h2 id="drink-modal-title" className="text-xl font-bold text-slate-900">{customizingItem.name}</h2>
              </div>
              <button type="button" onClick={() => setCustomizingItem(null)} className="min-h-11 min-w-11 rounded-full bg-slate-100 text-lg text-slate-700" aria-label="Close customization">×</button>
            </div>

            {([
              ['Sweetness', ['0%', '25%', '50%', '75%', '100%'], 'sweetness'],
              ['Ice level', ['Normal', 'Less Ice', 'No Ice', 'Hot'], 'ice'],
              ['Milk option', ['Regular', 'Oat Milk', 'Soy Milk'], 'milk'],
            ] as const).map(([label, options, key]) => (
              <fieldset key={key} className="mt-5">
                <legend className="mb-2 text-sm font-semibold text-slate-800">{label}</legend>
                <div className="flex flex-wrap gap-2">
                  {options.map((option) => {
                    const selected = modifierChoices[key] === option;
                    const upcharge = key === 'milk' ? milkUpcharges[option] ?? 0 : 0;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setModifierChoices((current) => ({ ...current, [key]: option }))}
                        className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                      >
                        {option}{upcharge > 0 ? ` (+${formatCurrencyTHB(upcharge)})` : ''}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-semibold text-slate-800">Add-ons</legend>
              <div className="flex flex-wrap gap-2">
                {Object.entries(addOnUpcharges).map(([addOn, upcharge]) => {
                  const selected = modifierChoices.addOns.includes(addOn);
                  return (
                    <button
                      key={addOn}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setModifierChoices((current) => ({
                        ...current,
                        addOns: selected ? current.addOns.filter((value) => value !== addOn) : [...current.addOns, addOn],
                      }))}
                      className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                    >
                      {addOn} (+{formatCurrencyTHB(upcharge)})
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="mt-5 block text-sm font-semibold text-slate-800">Notes (optional)
              <input maxLength={120} value={modifierChoices.notes} onChange={(event) => setModifierChoices((current) => ({ ...current, notes: event.target.value }))} placeholder="Extra hot, separate ice…" className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
            </label>

            {(() => {
              const unitPrice = customizingItem.price + getModifiers(modifierChoices).reduce((sum, modifier) => sum + modifier.upcharge, 0);
              return (
                <button type="button" onClick={addCustomizedDrink} className="mt-6 min-h-12 w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700">
                  Add to Order · {formatCurrencyTHB(unitPrice)}
                </button>
              );
            })()}
          </section>
        </div>
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Table Status</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tableRows.map((table) => (
            <div key={table.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">{table.table_number}</h3>
                <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusStyles[table.status]}`}>{table.status}</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{table.capacity} seats</p>
              <button
                type="button"
                disabled={demo || busyTableId === table.id}
                onClick={() => toggleTableStatus(table)}
                className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                {busyTableId === table.id ? 'Saving…' : table.status === 'occupied' ? 'Mark available' : 'Mark occupied'}
              </button>
            </div>
          ))}
          {!tableRows.length && <p className="text-sm text-slate-500">No tables added yet.</p>}
        </div>
      </section>
    </div>
  );
}
