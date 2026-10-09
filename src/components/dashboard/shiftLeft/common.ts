import { getFreshIdToken } from "@/lib/msalToken";

/** El traductor de next-intl, con la firma mínima que usan estos componentes. */
export type T = (key: string, values?: Record<string, string | number>) => string;
export type HeadersFn = () => Promise<Record<string, string>>;

export interface Gate {
    repository: string;
    cost_center_name: string | null;
    threshold_usd: string | number | null;
    threshold_pct_of_remaining: string | number | null;
}

export interface CentroDeCostos {
    cost_center_name: string;
    monthly_budget_usd: string | number;
}

export interface LineaDetalle {
    direccion: string;
    tipo: string;
    accion: string;
    region: string;
    mensualAntes: number;
    mensualDespues: number;
    delta: number;
    componentes?: Array<{ etiqueta: string; cantidad: number; mensual: number }>;
    notas?: string[];
    motivo?: string;
}

export async function authHeaders(instance: any, accounts: any[], isMock: boolean): Promise<Record<string, string>> {
    if (isMock) return {};
    const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
    return { Authorization: `Bearer ${token}` };
}

export function buildFetcher(instance: any, accounts: any[], isMock: boolean) {
    return async (url: string) => {
        const headers = await authHeaders(instance, accounts, isMock);
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    };
}

export const usd = (v: unknown, locale: string): string =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(v) || 0);

export const numero = (v: unknown, locale: string, dec = 2): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: dec }).format(Number(v) || 0);

/** `PUT` JSON con los headers de sesión; lanza con el mensaje del servidor si falla. */
export async function enviar(url: string, cuerpo: unknown, headers: HeadersFn): Promise<void> {
    const res = await fetch(url, {
        method: "PUT",
        headers: { ...(await headers()), "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
}
