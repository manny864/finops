"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Cloud } from "lucide-react";
import { useCloudProvider, type CloudProviderId } from "@/context/ProviderContext";

/**
 * Switch AWS/Azure del header. Sólo se renderiza cuando el tenant tiene los dos
 * proveedores para elegir — es decir, Enterprise con `provider = 'both'`, o un
 * tenant en ventana de gracia que todavía puede entrar al proveedor archivado
 * a exportar sus datos.
 *
 * Para el otro ~99% de los tenants no ocupa un solo pixel: mostrar un selector
 * de una sola opción es ruido.
 *
 * RBAC: ninguno. Cambiar de proveedor sólo cambia qué datos mira el usuario;
 * cada API revalida el acceso server-side.
 */

const LABELS: Record<CloudProviderId, string> = {
    azure: "Azure",
    aws: "AWS",
};

export default function ProviderSwitcher() {
    const t = useTranslations("provider");
    const { availableProviders, activeProvider, setActiveProvider, canSwitch, archivedProvider } =
        useCloudProvider();

    if (!canSwitch) return null;

    return (
        <div
            role="radiogroup"
            aria-label={t("switchLabel")}
            className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
        >
            {availableProviders.map((provider) => {
                const isActive = provider === activeProvider;
                const isArchived = provider === archivedProvider;
                return (
                    <button
                        key={provider}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => setActiveProvider(provider)}
                        title={isArchived ? t("archivedHint") : undefined}
                        className={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                            isActive
                                ? "bg-brand-deep text-white shadow-sm"
                                : "text-ink-soft hover:bg-surface hover:text-ink"
                        }`}
                    >
                        <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                        {LABELS[provider]}
                        {isArchived && (
                            <span
                                aria-label={t("archivedBadge")}
                                className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
