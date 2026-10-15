/**
 * PERIM-01: normalización de reportes CSP para /api/csp-report. Allowlist de campos,
 * truncado y URLs redactadas a origen + path (la query y el fragmento pueden llevar tokens).
 */
export const CSP_REPORT_MAX_REPORTS = 10;

export function redactUrl(raw: unknown): string | undefined {
    if (typeof raw !== "string" || raw === "") return undefined;
    // Palabras clave de CSP ("inline", "eval", "self"...) no son URLs: se conservan.
    if (/^[a-z-]+$/i.test(raw)) return raw.slice(0, 32);
    try {
        const u = new URL(raw);
        if (u.protocol === "data:" || u.protocol === "blob:") return `${u.protocol}…`;
        return `${u.origin}${u.pathname}`.slice(0, 300);
    } catch {
        return "[invalid-url]";
    }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

type Violation = Record<string, string | number | undefined>;

export function normalizeViolation(body: Record<string, unknown>): Violation {
    // Legacy (report-uri): kebab-case. Reporting API (report-to): camelCase.
    const pick = (kebab: string, camel: string) => body[kebab] ?? body[camel];
    return {
        documentUrl: redactUrl(pick("document-uri", "documentURL")),
        blockedUrl: redactUrl(pick("blocked-uri", "blockedURL")),
        directive: str(pick("effective-directive", "effectiveDirective") ?? body["violated-directive"], 64),
        disposition: str(body.disposition, 16),
        sourceFile: redactUrl(pick("source-file", "sourceFile")),
        line: num(pick("line-number", "lineNumber")),
        column: num(pick("column-number", "columnNumber")),
        status: num(pick("status-code", "statusCode")),
        // Primeros caracteres del script bloqueado: suficiente para identificarlo, sin volcar datos.
        sample: str(pick("script-sample", "sample"), 40),
    };
}

export function extractViolations(payload: unknown): Violation[] {
    const items: unknown[] = Array.isArray(payload) ? payload : [payload];
    const out: Violation[] = [];
    for (const item of items.slice(0, CSP_REPORT_MAX_REPORTS)) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const body = rec["csp-report"] ?? (rec.type === "csp-violation" ? rec.body : undefined);
        if (body && typeof body === "object" && !Array.isArray(body)) out.push(normalizeViolation(body as Record<string, unknown>));
    }
    return out;
}
