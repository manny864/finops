"use client";
import React from "react";
import { Link } from "@/i18n/routing";
import { Lock, Sparkles } from "lucide-react";

/**
 * Cartel de "función bloqueada por tier" — reemplaza tanto el mensaje crudo
 * de error (`requireTenantTier` responde 403 con
 * "Esta función requiere el plan X o superior.", que antes se mostraba tal
 * cual en una caja de error genérica) como el bloqueo a nivel de página de
 * RouteTierGate. Mismo componente para ambos casos: consistencia visual en
 * toda la app quien sea que dispare el aviso.
 */
export default function TierLockedNotice({
    requiredTier,
    currentTier,
    featureName,
    compact = false,
}: {
    requiredTier: string;
    currentTier?: string;
    featureName?: string;
    compact?: boolean;
}) {
    return (
        <div
            className={`bg-gradient-to-br from-brand-deep/5 to-brand-bright/5 dark:from-brand-deep/10 dark:to-brand-bright/10 border border-brand-deep/15 dark:border-brand-bright/20 rounded-2xl ${compact ? "p-5" : "p-8"} animate-in fade-in`}
        >
            <div className="flex items-start gap-4">
                <div className="shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-brand-deep to-brand-bright flex items-center justify-center shadow-sm">
                    <Lock className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className={`font-bold text-slate-800 dark:text-slate-100 ${compact ? "text-base" : "text-xl"} mb-1`}>
                        {featureName ? `${featureName} está en el plan ${requiredTier}` : "Función no disponible en tu plan"}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                        Esta función está disponible a partir del plan <strong className="text-slate-800 dark:text-slate-200">{requiredTier}</strong>
                        {currentTier ? (
                            <> — tu plan actual es <strong className="text-slate-800 dark:text-slate-200">{currentTier}</strong>.</>
                        ) : "."}
                        {" "}Actualizá tu suscripción para desbloquearla.
                    </p>
                    <Link
                        href="/upgrade"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-deep hover:bg-brand-bright text-white text-sm font-semibold transition-colors shadow-sm"
                    >
                        <Sparkles className="w-4 h-4" />
                        Ver planes y precios
                    </Link>
                </div>
            </div>
        </div>
    );
}

/**
 * Detecta si un mensaje de error de API es del tipo generado por
 * `requireTenantTier` en src/lib/requestAuth.ts ("Esta función requiere el
 * plan X o superior.") y extrae el tier requerido. Devuelve null si el
 * mensaje no matchea ese formato (error real, no un bloqueo de plan).
 */
export function parseTierRequiredError(message: string | undefined | null): string | null {
    if (!message) return null;
    const match = message.match(/requiere el plan (\w+)/i);
    return match ? match[1] : null;
}
