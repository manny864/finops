"use client";

import React from "react";
import type { ExternalSpendStatus } from "@/types/externalSpend.types";

/** Debajo de esto la revisión marca el campo o la línea para verificarlo contra el original. */
export const LOW_CONFIDENCE = 0.8;

export const API = "/api/intelligence/external-spend";

/** Error de la API con el motivo que la pantalla traduce como `error_<motivo>`. */
export class ApiError extends Error {
    readonly status: number;
    readonly reason: string | undefined;
    constructor(status: number, reason: string | undefined, message: string | undefined) {
        super(message || "");
        this.status = status;
        this.reason = reason;
    }
}

export function formatMoney(value: number | null, currency: string | null, locale: string): string {
    if (value === null) return "—";
    try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD" }).format(value);
    } catch {
        // Un código que Intl no conoce: lo que leyó el modelo antes de la revisión.
        return `${value.toFixed(2)} ${currency ?? ""}`.trim();
    }
}

export const percent = (confidence: number) => Math.round(confidence * 100);

/** Días de hoy a una fecha `YYYY-MM-DD`, en UTC como el cron de avisos. */
export function daysUntil(ymd: string): number {
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    return Math.round((Date.parse(`${ymd}T00:00:00Z`) - today) / 86_400_000);
}

const STATUS_STYLE: Record<ExternalSpendStatus, string> = {
    uploaded: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    extracting: "bg-blue-50 text-[#0054A6] border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
    needs_review: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    rejected: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    failed: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
};

export function StatusBadge({ status, label }: { status: ExternalSpendStatus; label: string }) {
    return (
        <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap ${STATUS_STYLE[status]}`}>
            {label}
        </span>
    );
}

export const inputClass =
    "w-full px-2.5 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:bg-slate-50 disabled:text-slate-500 dark:disabled:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40";

export const primaryButton =
    "inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-[#0078D4] hover:bg-[#0060AA] text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:text-white";

export const secondaryButton =
    "inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const cardClass = "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm";
