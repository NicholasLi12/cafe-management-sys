'use client';

import { Fragment, useMemo, useState } from 'react';
import { APP_TIMEZONE, formatCurrencyTHB } from '@/lib/currency';

export type OrderModifier = { group: string; option: string; upcharge: number };

export type HistoryOrder = {
  id: string;
  order_type: string;
  platform_name: string | null;
  external_order_ref: string | null;
  payment_method: string | null;
  total_amount: number;
  platform_fee: number;
  notes: string | null;
  created_at: string;
  table: { table_number: string } | null;
  items: {
    name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    modifiers: OrderModifier[];
    notes: string | null;
  }[];
};

type DateFilter = 'all' | 'today' | 'last7' | 'custom';
type SortMode = 'newest' | 'oldest' | 'id' | 'highest' | 'lowest';

function getLocalDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function getOrderTypeLabel(order: HistoryOrder) {
  if (order.order_type === 'dine_in') return `Dine-in${order.table?.table_number ? ` · ${order.table.table_number}` : ''}`;
  if (order.order_type === 'online_delivery') return `Delivery${order.platform_name ? ` · ${order.platform_name}` : ''}`;
  return 'Takeaway / pickup';
}

function getPaymentLabel(method: string | null) {
  if (!method) return '—';
  if (method === 'qr_transfer') return 'QR Transfer';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function formatOrderDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));
}

export function OrderHistory({ orders }: { orders: HistoryOrder[] }) {
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [specificDate, setSpecificDate] = useState('');
  const [orderType, setOrderType] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(() => new Set());
  const [copyError, setCopyError] = useState('');

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    const today = getLocalDateKey(new Date());
    const sevenDayStart = new Date(`${today}T00:00:00Z`);
    sevenDayStart.setUTCDate(sevenDayStart.getUTCDate() - 6);
    const last7Start = getLocalDateKey(sevenDayStart);

    return orders.filter((order) => {
      const dateKey = getLocalDateKey(new Date(order.created_at));
      if (dateFilter === 'today' && dateKey !== today) return false;
      if (dateFilter === 'last7' && (dateKey < last7Start || dateKey > today)) return false;
      if (dateFilter === 'custom' && specificDate && dateKey !== specificDate) return false;
      if (orderType !== 'all' && order.order_type !== orderType) return false;
      if (paymentMethod !== 'all' && order.payment_method !== paymentMethod) return false;
      if (!query) return true;

      const normalizedQuery = query.replace(/^#/, '');
      const searchableText = [
        order.id,
        order.id.replaceAll('-', ''),
        order.id.replaceAll('-', '').slice(0, 8),
        order.external_order_ref ?? '',
        order.notes ?? '',
        ...order.items.map((item) => item.name),
      ].join(' ').toLowerCase();
      return searchableText.includes(normalizedQuery);
    }).sort((a, b) => {
      if (sortMode === 'oldest') return Date.parse(a.created_at) - Date.parse(b.created_at);
      if (sortMode === 'id') return a.id.localeCompare(b.id);
      if (sortMode === 'highest') return b.total_amount - a.total_amount;
      if (sortMode === 'lowest') return a.total_amount - b.total_amount;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  }, [orders, search, dateFilter, specificDate, orderType, paymentMethod, sortMode]);

  const grossSales = filteredOrders.reduce((total, order) => total + order.total_amount, 0);

  const resetFilters = () => {
    setSearch('');
    setDateFilter('all');
    setSpecificDate('');
    setOrderType('all');
    setPaymentMethod('all');
    setSortMode('newest');
  };

  const copyOrderId = async (id: string) => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      setCopyError('Could not copy the full order ID. Check clipboard permissions and try again.');
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedOrders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm text-slate-700 sm:col-span-2 lg:col-span-1">Search orders
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Order ID, reference, notes, item…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm text-slate-700">Date
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="last7">Last 7 Days</option>
            <option value="custom">Specific Date</option>
          </select>
        </label>
        {dateFilter === 'custom' && (
          <label className="text-sm text-slate-700">Specific date
            <input type="date" value={specificDate} onChange={(event) => setSpecificDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
        )}
        <label className="text-sm text-slate-700">Order type
          <select value={orderType} onChange={(event) => setOrderType(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="all">All Types</option>
            <option value="dine_in">Dine-in</option>
            <option value="pickup">Takeaway / pickup</option>
            <option value="online_delivery">Delivery</option>
          </select>
        </label>
        <label className="text-sm text-slate-700">Payment method
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="all">All Methods</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="qr_transfer">QR Transfer</option>
          </select>
        </label>
        <label className="text-sm text-slate-700">Sort
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="newest">Date & Time: Newest first</option>
            <option value="oldest">Date & Time: Oldest first</option>
            <option value="id">Payment / Order ID (A–Z)</option>
            <option value="highest">Total Amount: Highest first</option>
            <option value="lowest">Total Amount: Lowest first</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <p className="text-sm text-slate-500">Matching Orders</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{filteredOrders.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <p className="text-sm text-slate-500">Filtered Gross Sales</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{formatCurrencyTHB(grossSales)}</p>
        </div>
      </div>

      {copyError && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{copyError}</p>}

      {filteredOrders.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-soft">
          <h2 className="text-lg font-semibold text-slate-900">No orders match these filters</h2>
          <p className="mt-1 text-sm text-slate-500">Try another search or reset your filters.</p>
          <button type="button" onClick={resetFilters} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Reset filters
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-soft">
          <table className="min-w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Date & Time</th>
                <th className="px-4 py-3">Payment / Order ID</th>
                <th className="px-4 py-3">Type & Details</th>
                <th className="px-4 py-3">Payment Method</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3 text-right">Total (฿)</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const expanded = expandedOrders.has(order.id);
                const itemSummary = order.items.slice(0, 2).map((item) => `${item.quantity}× ${item.name}`).join(', ');
                const remainingItems = order.items.length - 2;
                return (
                  <Fragment key={order.id}>
                    <tr className="border-t border-slate-200 align-top">
                      <td className="whitespace-nowrap px-4 py-3">{formatOrderDate(order.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-slate-900">#{order.id.replaceAll('-', '').slice(0, 8).toUpperCase()}</span>
                          <button type="button" aria-label="Copy full order ID" onClick={() => copyOrderId(order.id)} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
                            Copy
                          </button>
                        </div>
                        {order.external_order_ref && <span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">Ref: {order.external_order_ref}</span>}
                      </td>
                      <td className="px-4 py-3">{getOrderTypeLabel(order)}</td>
                      <td className="px-4 py-3">{getPaymentLabel(order.payment_method)}</td>
                      <td className="px-4 py-3">
                        <div className="max-w-56 truncate">{itemSummary || 'No item details'}{remainingItems > 0 ? `, +${remainingItems} more` : ''}</div>
                        {order.items.length > 0 && (
                          <button type="button" onClick={() => toggleExpanded(order.id)} aria-expanded={expanded} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
                            {expanded ? 'Hide details' : 'View details'}
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{formatCurrencyTHB(order.total_amount)}</td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                            <div>
                              <h3 className="mb-2 font-semibold text-slate-800">Receipt items</h3>
                              <ul className="space-y-1">
                                {order.items.map((item, index) => (
                                  <li key={`${order.id}-${index}`} className="flex justify-between gap-4 text-sm">
                                    <div>
                                      <p>{item.quantity}× {item.name} <span className="text-slate-500">({formatCurrencyTHB(item.unit_price)} each)</span></p>
                                      {item.modifiers.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          {item.modifiers.map((modifier, modifierIndex) => (
                                            <span key={`${modifier.group}-${modifier.option}-${modifierIndex}`} className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                                              {modifier.option}{modifier.upcharge > 0 ? ` +${formatCurrencyTHB(modifier.upcharge)}` : ''}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      {item.notes && <p className="mt-1 text-xs text-slate-500">Note: {item.notes}</p>}
                                    </div>
                                    <span className="whitespace-nowrap">{formatCurrencyTHB(item.subtotal)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="min-w-52 space-y-1 text-sm">
                              <p className="flex justify-between gap-4"><span>Order total</span><strong>{formatCurrencyTHB(order.total_amount)}</strong></p>
                              <p className="flex justify-between gap-4"><span>Platform fee</span><span>{formatCurrencyTHB(order.platform_fee)}</span></p>
                              {order.notes && <p className="pt-2 text-slate-600"><span className="font-medium text-slate-700">Notes:</span> {order.notes}</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
