/**
 * FOCUS 1.1 CSV / JSON / NDJSON serialisation (RFC 4180).
 */

import { csvEscape } from "@/lib/csvExport";
import { FOCUS_COLUMNS, FOCUS_VERSION, type FocusRecord } from "./columns";

export function buildFocusCsvHeader(): string {
    return FOCUS_COLUMNS.join(",");
}

export function buildFocusCsvRow(rec: FocusRecord): string {
    return FOCUS_COLUMNS.map((col) => csvEscape(rec[col])).join(",");
}

export function buildFocusCsv(records: FocusRecord[]): string {
    const lines: string[] = [buildFocusCsvHeader()];
    for (const rec of records) {
        lines.push(buildFocusCsvRow(rec));
    }
    return lines.join("\n");
}

export function buildFocusJson(records: FocusRecord[]): string {
    return JSON.stringify({ focusVersion: FOCUS_VERSION, rows: records }, null, 2);
}

export function buildFocusNdjson(records: FocusRecord[]): string {
    return records.map((r) => JSON.stringify(r)).join("\n");
}
