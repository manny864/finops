/**
 * CSV export utilities per RFC 4180
 */

export function csvEscape(value: unknown): string {
  const str = String(value ?? "");
  
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
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
