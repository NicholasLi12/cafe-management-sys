export function formatOrderNumber(num?: number | null) {
  return typeof num === 'number' && Number.isFinite(num)
    ? `#${String(num).padStart(3, '0')}`
    : '#---';
}
