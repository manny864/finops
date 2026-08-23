function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/**
 * Resuelve el rango de fechas [start, end] (inclusive) a consultar para el
 * Invoicing Report. Acepta:
 * - `last7d` — últimos 7 días
 * - `last30d` — últimos 30 días desde hoy
 * - `last3m` / `last90d` — mes actual más los 2 anteriores (o 90 días)
 * - `ytd` — año en curso desde el 1 de enero
 * - `last12m` — últimos 12 meses
 * - un mes puntual `YYYY-MM`
 * - un rango personalizado `YYYY-MM-DD_YYYY-MM-DD`, `custom:YYYY-MM-DD:YYYY-MM-DD`, `YYYY-MM-DD..YYYY-MM-DD`, `YYYY-MM-DD/YYYY-MM-DD`
 * - un día puntual `YYYY-MM-DD`
 * Única fuente de verdad compartida entre route.ts, email/route.ts y billingReport.service.ts.
 */
export function resolvePeriodRange(period: string): { start: string; end: string } {
    const now = new Date();
    
    if (!period) period = "last3m";

    // 1. Rango personalizado explícito entre dos fechas YYYY-MM-DD
    const rangeMatch = /^(?:custom:)?(\d{4}-\d{2}-\d{2})[_:\.\/\s~]+(\d{4}-\d{2}-\d{2})$/i.exec(period.trim());
    if (rangeMatch) {
        const d1 = rangeMatch[1];
        const d2 = rangeMatch[2];
        return d1 <= d2 ? { start: d1, end: d2 } : { start: d2, end: d1 };
    }

    if (period === "last7d") {
        const startD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
        const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        return {
            start: `${startD.getUTCFullYear()}-${pad2(startD.getUTCMonth() + 1)}-${pad2(startD.getUTCDate())}`,
            end: `${endD.getUTCFullYear()}-${pad2(endD.getUTCMonth() + 1)}-${pad2(endD.getUTCDate())}`,
        };
    }

    if (period === "last30d") {
        const startD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
        const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        return {
            start: `${startD.getUTCFullYear()}-${pad2(startD.getUTCMonth() + 1)}-${pad2(startD.getUTCDate())}`,
            end: `${endD.getUTCFullYear()}-${pad2(endD.getUTCMonth() + 1)}-${pad2(endD.getUTCDate())}`,
        };
    }
    
    if (period === "last3m" || period === "last90d") {
        const startD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
        const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
        return {
            start: `${startD.getUTCFullYear()}-${pad2(startD.getUTCMonth() + 1)}-01`,
            end: `${endD.getUTCFullYear()}-${pad2(endD.getUTCMonth() + 1)}-${pad2(endD.getUTCDate())}`,
        };
    }

    if (period === "ytd") {
        const startD = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        return {
            start: `${startD.getUTCFullYear()}-01-01`,
            end: `${endD.getUTCFullYear()}-${pad2(endD.getUTCMonth() + 1)}-${pad2(endD.getUTCDate())}`,
        };
    }

    if (period === "last12m") {
        const startD = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth() + 1, 1));
        const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
        return {
            start: `${startD.getUTCFullYear()}-${pad2(startD.getUTCMonth() + 1)}-01`,
            end: `${endD.getUTCFullYear()}-${pad2(endD.getUTCMonth() + 1)}-${pad2(endD.getUTCDate())}`,
        };
    }

    // 2. Día puntual YYYY-MM-DD
    const singleDayMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(period);
    if (singleDayMatch) {
        return { start: singleDayMatch[1], end: singleDayMatch[1] };
    }

    // 3. Mes puntual YYYY-MM
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const endD = new Date(Date.UTC(y, mo, 0));
        return { start: `${period}-01`, end: `${period}-${pad2(endD.getUTCDate())}` };
    }

    const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const cur = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
    return { start: `${cur}-01`, end: `${cur}-${pad2(endD.getUTCDate())}` };
}

