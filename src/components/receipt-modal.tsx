'use client';

import { formatOrderNumber } from '@/lib/orders';
import { APP_TIMEZONE, formatCurrencyTHB } from '@/lib/currency';

export type ReceiptLineItem = {
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  modifiers: { group: string; option: string; upcharge: number }[];
  notes?: string | null;
};

export type ReceiptOrder = {
  order_number?: number | null;
  created_at: string;
  order_type: string;
  table_label: string | null;
  payment_status: string;
  total_amount: number;
  items: ReceiptLineItem[];
};

export function ReceiptModal({
  branchName,
  order,
  onClose,
}: {
  branchName: string;
  order: ReceiptOrder;
  onClose: () => void;
}) {
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(order.created_at));
  const orderTypeLabel = order.table_label
    ? `${order.order_type} · ${order.table_label}`
    : order.order_type;

  return (
    <div className="receipt-modal fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="receipt-title" className="max-h-[95vh] w-full max-w-[340px] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
        <div id="print-receipt" className="receipt-content font-mono text-sm text-black tabular-nums">
          <div className="text-center">
            <p className="font-bold">{branchName}</p>
            <h2 id="receipt-title" className="mt-2 text-2xl font-black tabular-nums">{formatOrderNumber(order.order_number)}</h2>
            <p className="mt-1">{dateLabel} · Bangkok</p>
          </div>
          <div className="my-3 border-y border-dashed border-black py-2">
            <p>{orderTypeLabel}</p>
            <p>Payment: {order.payment_status}</p>
          </div>
          <ul className="space-y-3">
            {order.items.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <div className="flex justify-between gap-2">
                  <span>{item.quantity}× {item.name}</span>
                  <span>{formatCurrencyTHB(item.subtotal)}</span>
                </div>
                {item.modifiers.map((modifier, modifierIndex) => (
                  <p key={`${modifier.group}-${modifier.option}-${modifierIndex}`} className="pl-4 text-xs">
                    {modifier.group === 'Size' ? modifier.option : `${modifier.group}: ${modifier.option}`}
                  </p>
                ))}
                {item.notes && <p className="pl-4 text-xs">Note: {item.notes}</p>}
              </li>
            ))}
          </ul>
          <div className="my-3 flex justify-between border-t border-dashed border-black pt-3 text-base font-bold">
            <span>Grand Total</span>
            <span>{formatCurrencyTHB(order.total_amount)}</span>
          </div>
          <p className="mt-5 text-center">Thank you for visiting!</p>
        </div>
        <div className="receipt-controls mt-4 flex gap-2">
          <button type="button" onClick={() => window.print()} className="min-h-11 flex-1 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700">Print</button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700">Close</button>
        </div>
      </section>
    </div>
  );
}
