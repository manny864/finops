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

// Monedas cuya unidad menor NO tiene decimales (Paddle envía el monto tal cual).
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW"]);

/**
 * Convierte un monto en unidad menor (string/number entero, como lo envía Paddle)
 * a un string decimal exacto apto para columnas DECIMAL — sin pasar por floats.
 * Ej.: ("12345", "USD") -> "123.45" · ("500", "JPY") -> "500"
 * Devuelve null si el input no es un entero válido.
 */
export function minorUnitsToDecimalString(raw: unknown, currency?: string | null): string | null {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^-?\d+$/.test(s)) return null;

  if (ZERO_DECIMAL_CURRENCIES.has((currency || "").toUpperCase())) return s;

  const neg = s.startsWith("-");
  const digits = (neg ? s.slice(1) : s).padStart(3, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
