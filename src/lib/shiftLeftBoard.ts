import { csvEscape } from "@/lib/csvExport";

/**
 * MEJ-20 — lo que la pantalla de Shift-Left hace con los datos y no depende de React:
 * armar las claves de traducción de los códigos del estimador, la serie de la tendencia y
 * el CSV. Está acá y no en el componente para poder probarlo sin renderizar nada.
 */

export interface FilaEstimacion {
    id: number;
    repository: string;
    pr_number: number | null;
    author: string | null;
    current_monthly_cost_usd: string | number;
    projected_monthly_cost_usd: string | number;
    delta_cost_usd: string | number;
    resources_priced: number;
    resources_unpriced: number;
    gate_status: "NOT_EVALUATED" | "OK" | "EXCEEDED";
    created_at: string;
    meta?: {
        tool?: string;
        discount_pct?: number;
        list_delta_cost_usd?: number;
        resources_by_use?: number;
        gate_reason?: "usd" | "pct" | null;
        budget?: {
            cost_center: string;
            monthly_usd: number;
            spent_usd: number;
            remaining_usd: number;
            delta_pct_of_budget: number | null;
            delta_pct_of_remaining: number | null;
        } | null;
    } | null;
}

/** `por-uso` → `motivo_por_uso`: las claves de next-intl no llevan guiones. */
export const claveDeMotivo = (m: string): string => `motivo_${m.replace(/-/g, "_")}`;
export const claveDeNota = (n: string): string => `nota_${n.replace(/-/g, "_")}`;
export const claveDeAccion = (a: string): string => (a === "no-op" ? "action_noop" : `action_${a}`);

const num = (v: unknown): number => Number(v) || 0;

/** Repositorios con estimaciones, el de actividad más reciente primero. */
export function repositoriosDe(items: FilaEstimacion[]): string[] {
    const ultimo = new Map<string, number>();
    for (const i of items) {
        const t = Date.parse(i.created_at) || 0;
        ultimo.set(i.repository, Math.max(ultimo.get(i.repository) ?? 0, t));
    }
    return [...ultimo.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

export interface PuntoTendencia {
    id: number;
    fecha: number;
    delta: number;
    pr: number | null;
    gate: FilaEstimacion["gate_status"];
}

/** El delta de cada estimación del repositorio, del más viejo al más nuevo. */
export function serieDeTendencia(items: FilaEstimacion[], repo: string): PuntoTendencia[] {
    return items
        .filter((i) => i.repository === repo)
        .map((i) => ({ id: i.id, fecha: Date.parse(i.created_at) || 0, delta: num(i.delta_cost_usd), pr: i.pr_number, gate: i.gate_status }))
        .sort((a, b) => a.fecha - b.fecha || a.id - b.id);
}

/**
 * Una celda de texto que viene de afuera (el repositorio y el autor los manda el CI de
 * quien sea) no puede empezar con un carácter que Excel o Sheets interpreten como fórmula:
 * un autor llamado `=HYPERLINK(...)` se ejecutaría al abrir el archivo.
 */
export function celdaDeTexto(valor: unknown): string {
    // csvEscape ya neutraliza (AISEC-07); se fuerza string para que un número no se salte el prefijo.
    return csvEscape(String(valor ?? ""));
}

const COLUMNAS = [
    "fecha", "repositorio", "pr", "autor", "herramienta", "antes_usd", "despues_usd", "delta_usd",
    "delta_lista_usd", "descuento_pct", "umbral", "motivo_umbral", "sin_tarifar", "centro_de_costos", "pct_del_presupuesto",
];

export function construirCsv(items: FilaEstimacion[]): string {
    const filas = items.map((i) => {
        const m = i.meta ?? {};
        return [
            celdaDeTexto(new Date(i.created_at).toISOString()),
            celdaDeTexto(i.repository),
            i.pr_number ?? "",
            celdaDeTexto(i.author ?? ""),
            celdaDeTexto(m.tool ?? "terraform"),
            // Los montos son números: un delta negativo empieza con "-" y es legítimo.
            num(i.current_monthly_cost_usd).toFixed(2),
            num(i.projected_monthly_cost_usd).toFixed(2),
            num(i.delta_cost_usd).toFixed(2),
            m.list_delta_cost_usd !== undefined ? num(m.list_delta_cost_usd).toFixed(2) : "",
            m.discount_pct ?? 0,
            i.gate_status,
            m.gate_reason ?? "",
            i.resources_unpriced,
            celdaDeTexto(m.budget?.cost_center ?? ""),
            m.budget?.delta_pct_of_budget ?? "",
        ].join(",");
    });
    return [COLUMNAS.join(","), ...filas].join("\n");
}
