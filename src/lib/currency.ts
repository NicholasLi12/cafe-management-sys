export const APP_CURRENCY = 'THB';
export const APP_TIMEZONE = 'Asia/Bangkok';

export function formatCurrencyTHB(value: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: APP_CURRENCY,
    minimumFractionDigits: 2,
  }).format(value);
}
