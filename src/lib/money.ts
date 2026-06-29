function sanitizeNumericInput(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return value.toString();
  }

  if (typeof value === "string") {
    return value.trim().replace(/,/g, "");
  }

  return "0";
}

export function decimalToCents(value: unknown): number {
  const raw = sanitizeNumericInput(value);
  const sign = raw.startsWith("-") ? -1 : 1;
  const normalized = raw.replace(/^[+-]/, "");
  if (!/^\d*(\.\d+)?$/.test(normalized)) return 0;

  const [wholePart = "0", fractionPart = ""] = normalized.split(".");
  const whole = wholePart === "" ? 0 : Number(wholePart);
  const centsText = `${fractionPart}00`.slice(0, 2);
  const cents = Number(centsText);

  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(cents)) return 0;
  return sign * (whole * 100 + cents);
}

export function centsToDecimal(cents: number): number {
  const value = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return value / 100;
}

export function toMoneyNumber(value: unknown): number {
  return centsToDecimal(decimalToCents(value));
}
