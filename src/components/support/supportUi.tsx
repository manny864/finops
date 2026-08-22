"use client";
import React from "react";
import {
    IconAlertTriangle,
    IconCircleCheck,
    IconClock,
    IconLock,
    IconMessageCircle,
    IconRotateClockwise,
} from "@tabler/icons-react";
import type { TicketPriority, TicketStatus } from "@/types/supportTickets.types";
import { formatSlaRemaining } from "@/services/supportTickets.service";

/**
 * Badges y helpers de presentación del módulo de Soporte, compartidos entre la
 * vista de usuario, la cola global y el drawer de conversación.
 *
 * Paleta: los estados operativos van en azul corporativo; el ámbar queda
 * reservado para "esperando al cliente" y el riesgo de SLA, que son los dos
 * casos donde el color comunica que alguien tiene que hacer algo. Las cifras de
 * KPI nunca usan ámbar ni rojo (directiva de paleta).
 */

export const STATUS_BADGE: Record<TicketStatus, string> = {
    OPEN: "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] dark:text-blue-400 border border-blue-200 dark:border-blue-800",
    IN_PROGRESS: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700",
    WAITING_USER: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
    RESOLVED: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800",
    CLOSED: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700",
};

export const PRIORITY_PILL: Record<TicketPriority, string> = {
    CRITICAL: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800",
    HIGH: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
    MEDIUM: "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] dark:text-blue-400 border border-blue-200 dark:border-blue-800",
    LOW: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700",
};

/** Claves i18n heredadas: los diccionarios usan los valores de MySQL. */
export const STATUS_I18N: Record<TicketStatus, string> = {
    OPEN: "status_open",
    IN_PROGRESS: "status_in_progress",
    WAITING_USER: "status_waiting_customer",
    RESOLVED: "status_resolved",
    CLOSED: "status_closed",
};

export const PRIORITY_I18N: Record<TicketPriority, string> = {
    CRITICAL: "priority_urgent",
    HIGH: "priority_high",
    MEDIUM: "priority_medium",
    LOW: "priority_low",
};

export const CATEGORY_I18N: Record<string, string> = {
    CONSULTA: "category_question",
    FACTURACION_AZURE: "category_billing",
    CONEXION_TENANT: "category_connection",
    INCIDENCIA_TECNICA: "category_technical",
    SOLICITUD_FEATURE: "category_feature_request",
};

export function StatusBadge({ status, label }: { status: TicketStatus; label: string }) {
    return (
        <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-md whitespace-nowrap ${STATUS_BADGE[status]}`}>
            {label}
        </span>
    );
}

export function PriorityPill({ priority, label }: { priority: TicketPriority; label: string }) {
    return (
        <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap ${PRIORITY_PILL[priority]}`}>
            {label}
        </span>
    );
}

/**
 * Cuenta regresiva del SLA. El ámbar sólo aparece cuando el ticket está
 * efectivamente en riesgo: un ticket ya respondido muestra el resto en neutro
 * aunque queden pocos minutos, porque el SLA de primera respuesta ya se cumplió.
 */
export function SlaBadge({ minutes, atRisk, expiredLabel }: { minutes: number; atRisk: boolean; expiredLabel: string }) {
    const text = minutes <= 0 ? expiredLabel : formatSlaRemaining(minutes);
    const tone =
        minutes <= 0
            ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
            : atRisk
                ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                : "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] dark:text-blue-400 border-blue-200 dark:border-blue-800";
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-[3px] rounded-md border whitespace-nowrap ${tone}`}>
            {atRisk && minutes > 0 ? <IconAlertTriangle size={12} stroke={2} /> : <IconClock size={12} stroke={1.5} />}
            {text}
        </span>
    );
}

/**
 * Tarjeta de KPI. `value` se renderiza siempre en azul corporativo o slate
 * neutro — nunca ámbar ni rojo, por más crítico que sea el número. El color de
 * alerta va en el badge auxiliar, no en la cifra.
 */
export function KpiCard({
    icon: Icon,
    label,
    value,
    tone = "#0078D4",
    hint,
    badge,
    tooltip,
}: {
    icon: React.ComponentType<{ size?: number; className?: string; stroke?: number }>;
    label: string;
    value: React.ReactNode;
    tone?: string;
    hint?: string;
    badge?: React.ReactNode;
    tooltip?: React.ReactNode;
}) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                    <Icon size={16} stroke={1.5} className="text-[#0078D4]" />
                    {label}
                    {tooltip}
                </span>
                {badge}
            </div>
            <div className="text-[26px] font-extrabold leading-tight" style={{ color: tone }}>
                {value}
            </div>
            {hint && <div className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>}
        </div>
    );
}

export const STATUS_ICON: Record<TicketStatus, React.ComponentType<{ size?: number; className?: string; stroke?: number }>> = {
    OPEN: IconMessageCircle,
    IN_PROGRESS: IconRotateClockwise,
    WAITING_USER: IconClock,
    RESOLVED: IconCircleCheck,
    CLOSED: IconCircleCheck,
};

export function InternalNoteTag({ label }: { label: string }) {
    return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            <IconLock size={12} stroke={2} className="text-amber-600" />
            {label}
        </span>
    );
}

/** `DD/MM/YYYY HH:mm` estable entre servidor y cliente (no depende del locale del SO). */
export function formatDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
