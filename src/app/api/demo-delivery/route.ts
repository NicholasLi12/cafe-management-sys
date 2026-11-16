import { NextResponse } from 'next/server';

export async function POST() {
  const demoOrder = {
    owner_id: 'demo-owner-id',
    platform_name: 'Demo Delivery',
    external_order_ref: 'DEMO-1042',
    payment_method: 'qr_transfer',
    commission_rate: 0.12,
    notes: 'Simulated delivery order for presentation/demo',
    items: [
      { menu_item_id: 'demo-latte-id', quantity: 2 },
      { menu_item_id: 'demo-croissant-id', quantity: 1 },
    ],
  };

  return NextResponse.json({
    message: 'Demo delivery order is prepared for testing.',
    payload: demoOrder,
    demo: true,
  });
}
