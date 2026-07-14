"use client";
import React from "react";
import { Crown } from "lucide-react";
import { DeleteResourceDomain } from "@/lib/tierLogic";

const REMEDIATION_TIER_LABEL: Record<DeleteResourceDomain, string> = {
    zombies: 'Business',
    networking: 'Business',
    ttl: 'Enterprise',
    advisor: 'Enterprise',
};

interface EnterpriseDeleteDisclaimerProps {
    /** Dominio del recurso — determina el tier mínimo que habilita el borrado (ver src/lib/tierLogic.ts). Default 'ttl' (Enterprise) por compatibilidad. */
    domain?: DeleteResourceDomain;
}

/**
 * Aviso compartido para toda pantalla con capacidad de ELIMINAR recursos de
 * Azure (Recursos Zombis, Networking Zombies, Expiraciones TTL, Azure
 * Advisor Action Center). El Service Principal solo tiene permisos `delete`
 * en Azure vía el Custom Role que el script de onboarding asigna, con un
 * umbral que depende del dominio (ver canDeleteResources en
 * src/lib/tierLogic.ts) — por debajo de ese tier se detectan/ven los
 * recursos pero no se pueden borrar desde la plataforma.
 */
export default function EnterpriseDeleteDisclaimer({ domain = 'ttl' }: EnterpriseDeleteDisclaimerProps) {
    const requiredTier = REMEDIATION_TIER_LABEL[domain];
    return (
        <div className="bg-indigo-50 dark:bg-indigo-950/20 p-3 flex gap-3 rounded-xl border border-indigo-200 dark:border-indigo-800/50 text-indigo-800 dark:text-indigo-300">
            <Crown className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">
                <span className="font-bold mr-2 px-1.5 py-0.5 bg-indigo-200 dark:bg-indigo-800 rounded text-xs">{requiredTier}</span>
                La eliminación de recursos es una capacidad del plan {requiredTier}. En tu plan actual podés detectar y revisar estos recursos, pero borrarlos desde la plataforma requiere upgrade a {requiredTier}.
            </div>
        </div>
    );
}
