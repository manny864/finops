function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/**
 * Resuelve el rango de fechas [start, end] (inclusive) a consultar para el
 * Invoicing Report. Acepta un mes puntual `YYYY-MM` o el valor especial
 * `last3m` (mes actual más los 2 anteriores). Única fuente de verdad — antes
 * esta lógica estaba duplicada entre route.ts y email/route.ts y divergió
 * (email nunca soportó `last3m`, por eso el botón "Email" siempre devolvía
 * "No data found" con el período por default).
 */
export function resolvePeriodRange(period: string): { start: string; end: string } {
    const now = new Date();
    if (period === "last3m") {
        const startD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
        const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
        return {
            start: `${startD.getUTCFullYear()}-${pad2(startD.getUTCMonth() + 1)}-01`,
            end: `${endD.getUTCFullYear()}-${pad2(endD.getUTCMonth() + 1)}-${pad2(endD.getUTCDate())}`,
        };
    }
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
