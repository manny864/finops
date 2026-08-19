export function formatCurrencyAxis(
  value: number,
  maxDatasetValue: number
): string {
  if (!Number.isFinite(value) || !Number.isFinite(maxDatasetValue)) {
    return "$0";
  }

  if (maxDatasetValue < 1000) {
    return `$${Math.round(value)}`;
  }

  return `$${(value / 1000).toFixed(1)}k`;
}