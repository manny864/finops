/**
 * CSV export utilities per RFC 4180
 */

/** Número literal (`-12.5`, `+3`, `1e-3`): Excel lo lee como número, no como fórmula. */
const NUMERIC_LITERAL = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)([eE][+-]?\d+)?$/;

/**
 * AISEC-07 (OWASP CSV Injection): un texto que empieza con `= + - @ TAB CR` se
 * ejecuta como fórmula al abrir el archivo en Excel/Sheets/Power BI. Se le
 * antepone `'`. Los números (tipo number o literal numérico) pasan intactos:
 * un `-12.5` legítimo no se toca, `-2+3` sí.
 */
export function neutralizeCsvFormula(value: unknown): string {
  const str = String(value ?? "");
  if (typeof value === "number" || typeof value === "bigint") return str;
  return /^[=+\-@\t\r]/.test(str) && !NUMERIC_LITERAL.test(str) ? `'${str}` : str;
}

/** Celda CSV: neutraliza fórmulas y entrecomilla si hace falta (`,` `;` `"` saltos). */
export function csvEscape(value: unknown): string {
  const str = neutralizeCsvFormula(value);
  return /[",;\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Celda siempre entrecomillada (para los exports que ya lo hacían así). */
export function csvQuote(value: unknown): string {
  return `"${neutralizeCsvFormula(value).replace(/"/g, '""')}"`;
}

/** Arma el texto CSV completo; cada celda pasa por `csvEscape`. */
export function toCsvText(headers: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

export interface AuditLogRow {
  id: number;
  timestamp: string;
  user_email: string;
  action_type: string;
  resource_id: string;
  status: string;
}

export function buildCsvHeader(): string {
  return "id,timestamp,user_email,action_type,resource_id,status";
}

export function buildCsvRow(log: AuditLogRow): string {
  return [
    log.id,
    log.timestamp,
    log.user_email,
    log.action_type,
    log.resource_id,
    log.status,
  ]
    .map(csvEscape)
    .join(",");
}

export function buildCsv(logs: AuditLogRow[]): string {
  const lines = [buildCsvHeader()];
  for (const log of logs) {
    lines.push(buildCsvRow(log));
  }
  return lines.join("\n");
}
