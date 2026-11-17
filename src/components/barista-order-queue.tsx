'use client';

import { useCallback, useEffect, useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase/client';
import { formatCurrencyTHB } from '@/lib/currency';

type PrepStatus = 'new' | 'preparing' | 'ready' | 'completed';
type OrderModifier = { group: string; option: string; upcharge: number };

export type BaristaOrderTicket = {
  id: string;
  order_type: string;
  platform_name: string;
  created_at: string;
  prep_status: PrepStatus;
  table_number: string | null;
  items: {
    name: string;
    quantity: number;
    unit_price: number;
    modifiers: OrderModifier[];
    notes: string | null;
  }[];
};

const activeStatuses: PrepStatus[] = ['new', 'preparing', 'ready'];

function isPrepStatus(value: unknown): value is PrepStatus {
  return value === 'new' || value === 'preparing' || value === 'ready' || value === 'completed';
}

function normalizeModifiers(value: unknown): OrderModifier[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((modifier) => {
    if (
      typeof modifier !== 'object'
      || modifier === null
      || !('group' in modifier)
      || !('option' in modifier)
      || !('upcharge' in modifier)
      || typeof modifier.group !== 'string'
      || typeof modifier.option !== 'string'
      || typeof modifier.upcharge !== 'number'
    ) return [];
    return [{ group: modifier.group, option: modifier.option, upcharge: modifier.upcharge }];
  });
}

async function loadActiveTickets(franchiseId: string): Promise<BaristaOrderTicket[]> {
  const supabase = createSupabaseClient();
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, order_type, platform_name, created_at, table_id, prep_status')
    .eq('owner_id', franchiseId)
    .in('prep_status', activeStatuses)
    .order('created_at', { ascending: true });
  if (ordersError) throw ordersError;

  const orderRows = orders ?? [];
  const orderIds = orderRows.map((order) => order.id);
  const tableIds = Array.from(new Set(orderRows.flatMap((order) => order.table_id ? [order.table_id] : [])));
  const [itemsResult, tablesResult] = await Promise.all([
    orderIds.length
      ? supabase.from('order_items').select('order_id, menu_item_id, quantity, unit_price, modifiers, notes').in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
    tableIds.length
      ? supabase.from('cafe_tables').select('id, table_number').in('id', tableIds).eq('owner_id', franchiseId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const detailError = itemsResult.error ?? tablesResult.error;
  if (detailError) throw detailError;

  const itemRows = itemsResult.data ?? [];
  const menuItemIds = Array.from(new Set(itemRows.map((item) => item.menu_item_id)));
  const menuResult = menuItemIds.length
    ? await supabase.from('menu_items').select('id, name').in('id', menuItemIds).eq('owner_id', franchiseId)
    : { data: [], error: null };
  if (menuResult.error) throw menuResult.error;

  const itemNames = new Map((menuResult.data ?? []).map((item) => [item.id, item.name]));
  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }
  const tablesById = new Map((tablesResult.data ?? []).map((table) => [table.id, table]));

  return orderRows.flatMap((order) => {
    if (!isPrepStatus(order.prep_status) || !activeStatuses.includes(order.prep_status)) return [];
    return [{
      id: order.id,
      order_type: order.order_type,
      platform_name: order.platform_name ?? 'In-House',
      created_at: order.created_at ?? new Date(0).toISOString(),
      prep_status: order.prep_status,
      table_number: order.table_id ? tablesById.get(order.table_id)?.table_number ?? null : null,
      items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
        name: itemNames.get(item.menu_item_id) ?? 'Removed menu item',
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        modifiers: normalizeModifiers(item.modifiers),
        notes: item.notes,
      })),
    }];
  });
}

function elapsedMinutes(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000));
}

function statusStyle(status: PrepStatus) {
  if (status === 'new') return 'border-rose-300 bg-rose-50 text-rose-900';
  if (status === 'preparing') return 'border-amber-300 bg-amber-50 text-amber-900';
  return 'border-emerald-300 bg-emerald-50 text-emerald-900';
}

function nextAction(status: PrepStatus) {
  if (status === 'new') return { next: 'preparing' as const, label: 'Start Preparing', style: 'bg-blue-700 hover:bg-blue-800' };
  if (status === 'preparing') return { next: 'ready' as const, label: 'Ready for Pickup', style: 'bg-emerald-700 hover:bg-emerald-800' };
  return { next: 'completed' as const, label: 'Handed Off', style: 'bg-slate-800 hover:bg-slate-900' };
}

function statusLabel(status: PrepStatus) {
  if (status === 'new') return 'New';
  if (status === 'preparing') return 'In Progress';
  if (status === 'ready') return 'Ready for Pickup';
  return 'Completed';
}

function getOrderType(ticket: BaristaOrderTicket) {
  if (ticket.order_type === 'dine_in') {
    return `Dine-in${ticket.table_number ? ` · ${ticket.table_number}` : ''}`;
  }
  if (ticket.order_type === 'online_delivery') return `Delivery · ${ticket.platform_name}`;
  return 'Takeaway';
}

export function BaristaOrderQueue({
  initialTickets,
  franchiseId,
}: {
  initialTickets: BaristaOrderTicket[];
  franchiseId: string;
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [now, setNow] = useState(Date.now());

  const refreshTickets = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const currentTickets = await loadActiveTickets(franchiseId);
      setTickets(currentTickets);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not refresh the barista queue.');
    } finally {
      if (manual) setIsRefreshing(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`barista-queue-${franchiseId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'orders',
        filter: `owner_id=eq.${franchiseId}`,
      }, () => { void refreshTickets(); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `owner_id=eq.${franchiseId}`,
      }, () => { void refreshTickets(); })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnectionStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnectionStatus('offline');
        else setConnectionStatus('connecting');
      });

    void refreshTickets();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [franchiseId, refreshTickets]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(interval);
  }, []);

  const updateStatus = async (ticket: BaristaOrderTicket) => {
    const action = nextAction(ticket.prep_status);
    setUpdatingOrderId(ticket.id);
    setErrorMessage('');
    try {
      const { error } = await createSupabaseClient().rpc('update_order_prep_status', {
        p_order_id: ticket.id,
        p_prep_status: action.next,
      });
      if (error) throw error;
      setTickets((current) => action.next === 'completed'
        ? current.filter((order) => order.id !== ticket.id)
        : current.map((order) => order.id === ticket.id ? { ...order, prep_status: action.next } : order));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not update order preparation status.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl bg-slate-950 p-5 text-white shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Espresso Bar</p>
          <h1 className="mt-1 text-3xl font-bold">Barista Order Queue</h1>
          <p className="mt-1 text-sm text-slate-300">{tickets.length} active {tickets.length === 1 ? 'order' : 'orders'}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${connectionStatus === 'live' ? 'bg-emerald-300 text-emerald-950' : connectionStatus === 'offline' ? 'bg-rose-300 text-rose-950' : 'bg-amber-200 text-amber-950'}`}>
            <span className={`h-2 w-2 rounded-full ${connectionStatus === 'live' ? 'bg-emerald-700' : connectionStatus === 'offline' ? 'bg-rose-700' : 'bg-amber-700'}`} />
            {connectionStatus === 'live' ? 'Live' : connectionStatus === 'offline' ? 'Offline' : 'Connecting'}
          </span>
          <button type="button" disabled={isRefreshing} onClick={() => void refreshTickets(true)} className="min-h-11 rounded-xl border border-slate-500 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {errorMessage && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{errorMessage}</p>}

      {tickets.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
          <h2 className="text-xl font-semibold text-slate-900">No active orders</h2>
          <p className="mt-2 text-slate-600">New paid orders for this cafe will appear here automatically.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {tickets.map((ticket) => {
            const waitedMinutes = elapsedMinutes(ticket.created_at, now);
            const timerStyle = waitedMinutes >= 10
              ? 'bg-rose-600 text-white'
              : waitedMinutes >= 5
                ? 'bg-amber-400 text-amber-950'
                : 'bg-emerald-100 text-emerald-900';
            const action = nextAction(ticket.prep_status);
            return (
              <article key={ticket.id} className={`overflow-hidden rounded-2xl border-2 bg-white shadow-lg ${statusStyle(ticket.prep_status)}`}>
                <div className="flex items-start justify-between gap-3 bg-slate-950 px-5 py-4 text-white">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">Order #{ticket.id.replaceAll('-', '').slice(0, 8).toUpperCase()}</p>
                    <h2 className="mt-1 text-xl font-bold">{getOrderType(ticket)}</h2>
                  </div>
                  <span className={`shrink-0 rounded-xl px-3 py-2 text-center font-bold ${timerStyle}`}>
                    <span className="block text-xs uppercase">Wait</span>
                    <span className="text-xl">{waitedMinutes}m</span>
                  </span>
                </div>
                <div className="space-y-4 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-800">{statusLabel(ticket.prep_status)}</span>
                    <time className="text-sm text-slate-500" dateTime={ticket.created_at}>
                      {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(ticket.created_at))}
                    </time>
                  </div>

                  <ul className="divide-y divide-slate-200">
                    {ticket.items.map((item, index) => (
                      <li key={`${ticket.id}-${index}`} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex items-start gap-3">
                          <span className="flex h-10 min-w-10 items-center justify-center rounded-xl bg-slate-900 px-2 text-lg font-black text-white">{item.quantity}×</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-lg font-bold leading-tight text-slate-950">{item.name}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {item.modifiers.map((modifier, modifierIndex) => (
                                <span key={`${modifier.group}-${modifier.option}-${modifierIndex}`} className="rounded-md bg-cyan-100 px-2 py-1 text-xs font-bold text-cyan-950">
                                  {modifier.group}: {modifier.option}{modifier.upcharge > 0 ? ` (+${formatCurrencyTHB(modifier.upcharge)})` : ''}
                                </span>
                              ))}
                            </div>
                            {item.notes && <p className="mt-2 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">Note: {item.notes}</p>}
                          </div>
                        </div>
                      </li>
                    ))}
                    {!ticket.items.length && <li className="text-sm text-slate-500">No item details available.</li>}
                  </ul>

                  <button
                    type="button"
                    disabled={updatingOrderId === ticket.id}
                    onClick={() => void updateStatus(ticket)}
                    className={`min-h-14 w-full rounded-xl px-4 py-3 text-lg font-black text-white shadow-md transition disabled:cursor-wait disabled:opacity-60 ${action.style}`}
                  >
                    {updatingOrderId === ticket.id ? 'Updating…' : action.label}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
