import Decimal from "decimal.js";

const STRICT_DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface MoneyDto {
  amount: string;
  currency: string;
}

export function parseDecimalStrict(raw: unknown, opts?: { maxScale?: number }): Decimal | null {
  const str = typeof raw === "string" ? raw.trim() : raw instanceof Decimal ? raw.toString() : String(raw ?? "").trim();
  if (!STRICT_DECIMAL_RE.test(str)) return null;
  const dec = new Decimal(str);
  if (opts?.maxScale !== undefined && dec.decimalPlaces() > opts.maxScale) return null;
  return dec;
}

export function requireDecimalStrict(raw: unknown, label: string, opts?: { maxScale?: number }): Decimal {
  const parsed = parseDecimalStrict(raw, opts);
  if (!parsed) throw new Error(`${label} inválido`);
  return parsed;
}

export function toMoneyDto(value: Decimal.Value, currency = "USD", scale = 2): MoneyDto {
  return {
    amount: new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale),
    currency,
  };
}

export function toMoneyNumber(value: Decimal.Value, scale = 2): number {
  return Number(new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale));
}

export function sumMoney(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(new Decimal(v)), new Decimal(0));
}
