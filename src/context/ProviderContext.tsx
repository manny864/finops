"use client";

import React, { createContext, useContext } from "react";
import type { CloudProviderId } from "@/lib/providerPolicy";

/**
 * Proveedor de nube activo. El producto es Azure-only: este contexto queda
 * como una constante para que el Sidebar y las páginas que todavía preguntan
 * "¿qué proveedor está activo?" no necesiten un caso especial.
 *
 * RBAC: no aplica, es estado de presentación.
 */

export type { CloudProviderId };

interface ProviderContextValue {
    activeProvider: CloudProviderId;
}

const VALUE: ProviderContextValue = { activeProvider: "azure" };

const ProviderContext = createContext<ProviderContextValue>(VALUE);

export function ProviderProvider({ children }: { children: React.ReactNode }) {
    return <ProviderContext.Provider value={VALUE}>{children}</ProviderContext.Provider>;
}

export function useCloudProvider(): ProviderContextValue {
    return useContext(ProviderContext);
}
