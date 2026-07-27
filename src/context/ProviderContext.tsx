"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import {
    normalizeProviderSetting,
    tierAllowsMultiProvider,
    type CloudProviderId,
    type TenantProviderSetting,
} from "@/lib/providerPolicy";

/**
 * Proveedor de nube que el usuario está mirando ahora mismo.
 *
 * Un tenant Enterprise puede tener `provider = 'both'`; el resto tiene uno
 * solo. Este contexto resuelve cuál está activo y lo persiste, para que el
 * Sidebar, el switch del header y las páginas coincidan sin pasarse props.
 *
 * Reglas que aplica (espejo cliente de `providerPolicy.ts`, que es la fuente de
 * verdad y se re-valida server-side en cada ruta — esto es UX, no seguridad):
 *  - `both` sólo vale si el tier lo permite (Enterprise). Si un tenant quedó
 *    con 'both' en la fila pero bajó de plan, acá se ve un solo proveedor
 *    igual que en el backend.
 *  - El proveedor archivado durante la ventana de gracia SIGUE siendo
 *    seleccionable: es de sólo lectura, pero el cliente tiene que poder entrar
 *    a exportar sus datos antes de la purga (ver docs/provider-downgrade-policy.md).
 *
 * RBAC: no aplica, es estado de presentación.
 */

export type { CloudProviderId };

interface ProviderContextValue {
    /** Valor crudo de `Tenants.provider`. */
    tenantProvider: TenantProviderSetting;
    /** Proveedores que el usuario puede ver, ya filtrados por tier. */
    availableProviders: CloudProviderId[];
    activeProvider: CloudProviderId;
    setActiveProvider: (provider: CloudProviderId) => void;
    /** true sólo si hay más de uno para elegir (Enterprise con 'both'). */
    canSwitch: boolean;
    /** Proveedor archivado en gracia, si lo hay: se ve pero no ingesta. */
    archivedProvider: CloudProviderId | null;
    /** true si el proveedor activo es el archivado (modo sólo lectura). */
    isActiveArchived: boolean;
}

const ProviderContext = createContext<ProviderContextValue | undefined>(undefined);

/** Flag global de UI para ocultar AWS en el cliente y presentar la plataforma exclusivamente como Azure FinOps */
export const ENABLE_AWS_UI = false;

const STORAGE_PREFIX = "finops_active_provider:";

function readStored(tenantId: string): CloudProviderId | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${tenantId}`);
    return raw === "azure" || raw === "aws" ? raw : null;
}

export function ProviderProvider({ children }: { children: React.ReactNode }) {
    const { selectedTenant } = useTenant();

    const tenantProvider = normalizeProviderSetting((selectedTenant as { provider?: unknown }).provider);
    const tier = selectedTenant.tier || "Essential";
    const archivedRaw = (selectedTenant as { provider_archived?: unknown }).provider_archived;
    const archivedProvider: CloudProviderId | null =
        archivedRaw === "azure" || archivedRaw === "aws" ? archivedRaw : null;

    const availableProviders = useMemo<CloudProviderId[]>(() => {
        if (!ENABLE_AWS_UI) return ["azure"];
        if (tenantProvider === "both" && tierAllowsMultiProvider(tier)) return ["azure", "aws"];
        if (tenantProvider === "both") {
            // Fila con 'both' pero tier sin derecho: hasta que el cron
            // reconcilie, se muestra el que NO está archivado.
            return archivedProvider ? [archivedProvider === "aws" ? "azure" : "aws"] : ["azure"];
        }
        return [tenantProvider];
    }, [tenantProvider, tier, archivedProvider]);

    // El archivado se agrega a la lista aunque el tier ya no lo habilite: sin
    // esto el cliente no tendría por dónde entrar a exportar antes de la purga.
    const selectableProviders = useMemo<CloudProviderId[]>(() => {
        if (!ENABLE_AWS_UI) return ["azure"];
        if (archivedProvider && !availableProviders.includes(archivedProvider)) {
            return [...availableProviders, archivedProvider];
        }
        return availableProviders;
    }, [availableProviders, archivedProvider]);

    const [activeProvider, setActiveProviderState] = useState<CloudProviderId>(selectableProviders[0]);

    // Rehidrata la elección al montar y cada vez que cambia el tenant. Va en un
    // efecto y no en el inicializador del useState porque el tenant se resuelve
    // asincrónicamente (TenantProvider arranca con id 'default').
    useEffect(() => {
        if (!selectedTenant.id || selectedTenant.id === "default") return;
        const stored = readStored(selectedTenant.id);
        const next = stored && selectableProviders.includes(stored) ? stored : selectableProviders[0];
        setActiveProviderState((prev) => (prev === next ? prev : next));
    }, [selectedTenant.id, selectableProviders]);

    const setActiveProvider = (provider: CloudProviderId) => {
        if (!selectableProviders.includes(provider)) return;
        setActiveProviderState(provider);
        if (typeof window !== "undefined" && selectedTenant.id && selectedTenant.id !== "default") {
            window.localStorage.setItem(`${STORAGE_PREFIX}${selectedTenant.id}`, provider);
        }
    };

    const value: ProviderContextValue = {
        tenantProvider,
        availableProviders: selectableProviders,
        activeProvider,
        setActiveProvider,
        canSwitch: selectableProviders.length > 1,
        archivedProvider,
        isActiveArchived: archivedProvider !== null && archivedProvider === activeProvider,
    };

    return <ProviderContext.Provider value={value}>{children}</ProviderContext.Provider>;
}

export function useCloudProvider(): ProviderContextValue {
    const ctx = useContext(ProviderContext);
    if (!ctx) {
        // Fallback silencioso a Azure: hay componentes (páginas públicas,
        // tests aislados) que se montan fuera del árbol de ClientShell y no
        // deben romper por esto.
        return {
            tenantProvider: "azure",
            availableProviders: ["azure"],
            activeProvider: "azure",
            setActiveProvider: () => {},
            canSwitch: false,
            archivedProvider: null,
            isActiveArchived: false,
        };
    }
    return ctx;
}
