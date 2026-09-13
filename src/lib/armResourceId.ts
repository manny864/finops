/**
 * Jerarquía de un ARM ID: quién es el padre de un recurso hijo.
 *
 * Azure anida recursos repitiendo pares `tipo/nombre` después de `/providers/`:
 *
 *   /subscriptions/S/resourceGroups/RG/providers/Microsoft.Compute/virtualMachines/vm-app-01
 *                                                └ namespace ────┘ └ tipo ──────┘ └ nombre ┘
 *
 *   …/virtualMachines/vm-app-01/extensions/AzureMonitorLinuxAgent
 *                               └ tipo ──┘ └ nombre ────────────┘   ← un hijo
 *
 * Una extensión, una NIC o una subred no tienen cargo propio en Cost Management:
 * lo que consumen se factura en el padre. Saber quién es ese padre permite
 * mostrar "facturado en vm-app-01" en vez de un "—" exacto pero inútil (MEJ-05).
 */

/** Nombre y tipo del último par `tipo/nombre` de un ARM ID. */
export function parseArmLeaf(id: string): { name: string; type: string } | null {
    const partes = String(id || "").split("/providers/");
    if (partes.length < 2) return null;
    const cola = partes[partes.length - 1].split("/").filter(Boolean);
    // namespace + al menos un par tipo/nombre
    if (cola.length < 3) return null;
    return { name: cola[cola.length - 1], type: cola[cola.length - 2] };
}

/**
 * ARM ID del padre, o `null` si el recurso es de primer nivel.
 *
 * Se corta por pares y no por "el penúltimo segmento" porque el namespace
 * (`Microsoft.Compute`) NO es un par: un recurso de primer nivel tiene 3
 * segmentos después de `/providers/` y no tiene padre, aunque sobren barras.
 */
export function resolveParentResourceId(id: string): string | null {
    const crudo = String(id || "").trim().replace(/\/+$/, "");
    const corte = crudo.lastIndexOf("/providers/");
    if (corte === -1) return null;

    const prefijo = crudo.slice(0, corte);
    const cola = crudo.slice(corte + "/providers/".length).split("/").filter(Boolean);

    // cola = [namespace, tipo1, nombre1, tipo2, nombre2, ...]
    // Con 3 o menos es un recurso de primer nivel: no hay padre.
    if (cola.length <= 3 || cola.length % 2 === 0) return null;

    return `${prefijo}/providers/${cola.slice(0, cola.length - 2).join("/")}`;
}

/** El `subscriptionId` embebido en el ARM ID, para poder consultar su costo. */
export function subscriptionIdFromArmId(id: string): string | null {
    const m = String(id || "").match(/\/subscriptions\/([^/]+)/i);
    return m ? m[1] : null;
}
