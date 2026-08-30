/**
 * Tag Inheritance as a Service (Feature C, derivado del toolkit
 * src/bicep-registry/tag-inheritance).
 *
 * Aplica tags del Resource Group a sus recursos hijos vía Resource Graph
 * + Azure Resource Manager Tags API. No requiere despliegue Bicep en el
 * cliente — todo se ejecuta server-side con el SP del tenant.
 *
 * Política: MERGE (no Replace). Tags pre-existentes en el recurso NUNCA
 * se sobreescriben. Solo se añaden tags faltantes del RG.
 */

import { TokenCredential } from "@azure/identity";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { errorMessage } from '@/lib/apiErrors';

export interface MissingTagsRow {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    resourceGroupName: string;
    location: string;
    existingTags: Record<string, string>;
    rgTags: Record<string, string>;
    missingTags: Record<string, string>;
}

export interface ApplyOp {
    resourceId: string;
    tagsToMerge: Record<string, string>;
}

export interface ApplyResult {
    resourceId: string;
    success: boolean;
    error?: string;
}

const ARM_BASE = "https://management.azure.com";
const TAGS_API_VERSION = "2021-04-01";

/**
 * Mensaje legible a partir del cuerpo de error de ARM.
 *
 * ARM re-serializa el error del provider DENTRO de `error.message` como JSON
 * escapado, a veces en más de un nivel. Cortar el cuerpo crudo a 200 caracteres
 * —lo que se hacía antes— dejaba en pantalla algo como
 * `HTTP 409: {"error":{"code":"ProviderError","message":"{\\"error\\":{\\"code\\...`
 * truncado justo antes del motivo real. Acá se desanida hasta encontrarlo.
 */
export function describeArmError(status: number, rawBody: string): string {
    let code = "";
    let message = rawBody;
    let current: unknown = rawBody;

    for (let depth = 0; depth < 4; depth++) {
        if (typeof current !== "string") break;
        let parsed: any;
        try {
            parsed = JSON.parse(current);
        } catch {
            break;
        }
        const err = parsed?.error ?? parsed;
        if (err?.code) code = String(err.code);
        if (typeof err?.message === "string") {
            message = err.message;
            current = err.message;
        } else {
            break;
        }
    }

    const detail = message.length > 220 ? `${message.slice(0, 220)}…` : message;
    // El caso frecuente y transitorio: otra operación de Azure tiene tomado el
    // recurso. Sin esta pista el usuario no sabe que alcanza con reintentar.
    const isBusy = /OperationInProgress|another operation|Conflict/i.test(`${code} ${message}`);
    const hint = isBusy
        ? " El recurso tenía otra operación de Azure en curso; reintentá en unos minutos."
        : "";

    return `HTTP ${status}${code ? ` ${code}` : ""}: ${detail}${hint}`;
}

/**
 * Analiza qué recursos del scope tienen tags faltantes respecto a su RG.
 * Opcionalmente se filtran las tag keys (si no, todas las del RG se consideran).
 */
export async function analyzeMissingTags(
    credential: TokenCredential,
    subscriptionId: string,
    options: { tagKeys?: string[]; limit?: number } = {}
): Promise<MissingTagsRow[]> {
    const client = new ResourceGraphClient(credential);
    const limit = options.limit || 500;

    const subFilter = subscriptionId && subscriptionId !== "All"
        ? `| where subscriptionId =~ '${subscriptionId}'`
        : "";

    // Une recursos con su RG y compara tags. Excluye recursos sin RG (raros).
    // IMPORTANTE: el join se scopea por (subscriptionId, rgName), NO sólo por
    // nombre del RG. RGs homónimos entre subscripciones (p.ej. NetworkWatcherRG,
    // que Azure crea en TODAS las subs) producirían un producto cruzado y filas
    // duplicadas con subscriptionId="All".
    const query = `
        Resources
        ${subFilter}
        | extend rgName = tolower(resourceGroup)
        | project resourceId = id, resourceName = name, resourceType = type, subscriptionId, rgName, location, resourceTags = coalesce(tags, parse_json("{}"))
        | join kind=inner (
            ResourceContainers
            | where type =~ 'microsoft.resources/subscriptions/resourcegroups'
            ${subFilter}
            | project subscriptionId, rgName = tolower(name), rgTags = coalesce(tags, parse_json("{}"))
        ) on subscriptionId, rgName
        | project resourceId, resourceName, resourceType, resourceGroupName = rgName, location, resourceTags, rgTags
        | limit ${limit}
    `;

    const result = await client.resources({ query });
    const rows = (result.data as any[]) || [];

    const out: MissingTagsRow[] = [];
    for (const r of rows) {
        const existingTags: Record<string, string> = r.resourceTags || {};
        const rgTags: Record<string, string> = r.rgTags || {};
        const missingTags: Record<string, string> = {};

        const keys = options.tagKeys?.length ? options.tagKeys : Object.keys(rgTags);
        for (const k of keys) {
            const rgVal = rgTags[k];
            if (rgVal === undefined || rgVal === null || rgVal === "") continue;
            if (existingTags[k] === undefined || existingTags[k] === null || existingTags[k] === "") {
                missingTags[k] = String(rgVal);
            }
        }

        if (Object.keys(missingTags).length === 0) continue;

        out.push({
            resourceId: r.resourceId,
            resourceName: r.resourceName,
            resourceType: r.resourceType,
            resourceGroupName: r.resourceGroupName,
            location: r.location,
            existingTags,
            rgTags,
            missingTags,
        });
    }
    return out;
}

/**
 * Aplica los merges de tags con concurrencia controlada y retry exponencial.
 * Si dryRun=true, NO hace PATCH — solo valida tokens y reporta lo que haría.
 */
export async function applyTagInheritance(
    credential: TokenCredential,
    ops: ApplyOp[],
    options: { dryRun?: boolean; concurrency?: number; maxRetries?: number } = {}
): Promise<ApplyResult[]> {
    const dryRun = options.dryRun ?? false;
    const concurrency = options.concurrency ?? 8;
    const maxRetries = options.maxRetries ?? 2;

    if (ops.length === 0) return [];

    // Obtener token una sola vez (ARM scope).
    const tokenObj = await credential.getToken("https://management.azure.com/.default");
    if (!tokenObj?.token) throw new Error("No se pudo obtener token ARM");

    const headers = {
        Authorization: `Bearer ${tokenObj.token}`,
        "Content-Type": "application/json",
    };

    const results: ApplyResult[] = [];
    let cursor = 0;

    async function worker() {
        while (cursor < ops.length) {
            const idx = cursor++;
            const op = ops[idx];

            if (dryRun) {
                results[idx] = { resourceId: op.resourceId, success: true };
                continue;
            }

            let lastErr: any = null;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const url = `${ARM_BASE}${op.resourceId}/providers/Microsoft.Resources/tags/default?api-version=${TAGS_API_VERSION}`;
                    const res = await fetch(url, {
                        method: "PATCH",
                        headers,
                        body: JSON.stringify({
                            operation: "Merge",
                            properties: { tags: op.tagsToMerge },
                        }),
                    });
                    if (!res.ok) {
                        const text = await res.text();
                        lastErr = describeArmError(res.status, text);
                        // 409 es reintentable y antes no lo era: ARM lo devuelve
                        // cuando el recurso tiene OTRA operación en curso
                        // (`ManagedEnvironmentOperationInProgress` y familia),
                        // que termina sola. Salir al primer intento convertía un
                        // conflicto pasajero en un fallo definitivo — el caso
                        // reportado, que "no aparece siempre" justamente porque
                        // depende de si algo más estaba tocando el recurso.
                        // El PATCH es idempotente (Merge con los mismos tags),
                        // así que reintentar es seguro.
                        if (res.status === 409 || res.status === 429 || res.status >= 500) {
                            // Espera más larga para el 409: un 429 se despeja en
                            // milisegundos, una operación de ARM en curso no.
                            const baseDelay = res.status === 409 ? 2000 : 500;
                            await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
                            continue;
                        }
                        break;
                    }
                    results[idx] = { resourceId: op.resourceId, success: true };
                    lastErr = null;
                    break;
                } catch (e) {
                    lastErr = errorMessage(e) || String(e);
                    await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
                }
            }
            if (lastErr) {
                results[idx] = { resourceId: op.resourceId, success: false, error: lastErr };
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, ops.length) }, worker));
    return results;
}
