import { TokenCredential } from "@azure/identity";
import { errorMessage } from '@/lib/apiErrors';

const ARM_BASE = "https://management.azure.com";
const CAPACITY_API_VERSION = "2022-11-01";

/**
 * Detalle de una reserva activa, equivalente al blade "Reservations" del portal Azure.
 * Fuente: Microsoft.Capacity/reservations.
 */
export interface ActiveReservationDetail {
    reservationId: string;
    orderId: string;
    name: string;                 // displayName
    status: string;               // provisioningState (Succeeded, Expired, ...)
    expiryDate: string | null;    // ISO date
    scopeType: string;            // Single | Shared | ManagementGroup
    scope: string;                // scope legible (subs/RG/MG destino) o "Shared"
    type: string;                 // reservedResourceType (VirtualMachines, SqlDatabases, ...)
    productName: string;          // skuDescription / sku
    region: string;               // location
    renew: boolean;               // auto-renovación activa
    quantity: number;             // cantidad de instancias reservadas
    term: string;                 // P1Y | P3Y
    utilizationLastDay: number | null;   // % último día (grain 1)
    utilizationLast7Days: number | null; // % últimos 7 días (grain 7)
}

/**
 * Punto de tendencia de utilización para el modal (clic sobre el %).
 */
export interface ReservationUtilizationTrend {
    aggregates: {
        oneDay: number | null;
        sevenDays: number | null;
        thirtyDays: number | null;
    };
    trend: Array<{ date: string; utilization: number }>;
}

async function armToken(credential: TokenCredential): Promise<string> {
    const tokenData = await credential.getToken(`${ARM_BASE}/.default`);
    if (!tokenData) {
        throw new Error("No se pudo obtener el token de acceso de Azure Management");
    }
    return tokenData.token;
}

/** Extrae orderId + reservationId de un resourceId de reserva de Capacity. */
export function parseReservationResourceId(resourceId: string): { orderId: string; reservationId: string } | null {
    const m = resourceId.match(/reservationOrders\/([^/]+)\/reservations\/([^/?]+)/i);
    if (!m) return null;
    return { orderId: m[1], reservationId: m[2] };
}

function pickAggregate(aggregates: any[], grain: number): number | null {
    if (!Array.isArray(aggregates)) return null;
    const found = aggregates.find((a) => Number(a?.grain) === grain);
    if (!found || found.value === undefined || found.value === null) return null;
    const val = Number(found.value);
    return Number.isFinite(val) ? val : null;
}

function readableScope(scopeType: string, appliedScopes: any): string {
    if (scopeType === "Shared") return "Shared";
    const scopes: string[] = Array.isArray(appliedScopes) ? appliedScopes : (appliedScopes ? [appliedScopes] : []);
    if (scopes.length === 0) return scopeType || "—";
    // Último segmento del scope (subscriptionId, resourceGroup o managementGroup)
    const first = String(scopes[0]);
    const seg = first.split("/").filter(Boolean).pop() || first;
    return scopes.length > 1 ? `${seg} (+${scopes.length - 1})` : seg;
}

/**
 * Trae TODAS las reservas activas visibles para el credential, con los campos del blade
 * "Reservations" de Azure (Nombre, Status, Expiration, Scope, Type, Product name, Region,
 * Renewal, Cantidad, Utilización 1 día / 7 días).
 *
 * RBAC Azure mínimo: rol "Reservations Reader" sobre el/los reservation order(s).
 */
export async function getActiveReservations(credential: TokenCredential): Promise<ActiveReservationDetail[]> {
    const token = await armToken(credential);
    const results: ActiveReservationDetail[] = [];
    let url: string | null =
        `${ARM_BASE}/providers/Microsoft.Capacity/reservations?api-version=${CAPACITY_API_VERSION}&$refreshSummary=true`;

    // Paginación por nextLink.
    while (url) {
        const res: Response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });

        if (!res.ok) {
            const errorText = await res.text().catch(() => "No response body");
            console.error(`[ReservationService] Capacity/reservations returned ${res.status}: ${errorText}`);
            break;
        }

        const json: any = await res.json();
        const value: any[] = json.value || [];

        for (const item of value) {
            const props = item.properties || {};
            const parsed = parseReservationResourceId(String(item.id || ""));
            const aggregates = props.utilization?.aggregates || [];

            results.push({
                reservationId: parsed?.reservationId || String(item.name || ""),
                orderId: parsed?.orderId || "",
                name: props.displayName || String(item.name || "—"),
                status: props.displayProvisioningState || props.provisioningState || "Unknown",
                expiryDate: props.expiryDateTime || props.expiryDate || null,
                scopeType: props.appliedScopeType || "—",
                scope: readableScope(props.appliedScopeType || "", props.appliedScopes),
                type: props.reservedResourceType || "—",
                productName: props.skuDescription || item.sku?.name || "—",
                region: item.location || props.location || "Global",
                renew: Boolean(props.renew),
                quantity: Number(props.quantity ?? 0),
                term: props.term || "—",
                utilizationLastDay: pickAggregate(aggregates, 1),
                utilizationLast7Days: pickAggregate(aggregates, 7),
            });
        }

        url = json.nextLink || null;
    }

    // Orden: primero las que expiran antes (activas primero), luego por nombre.
    results.sort((a, b) => {
        const ax = a.expiryDate ? Date.parse(a.expiryDate) : Number.MAX_SAFE_INTEGER;
        const bx = b.expiryDate ? Date.parse(b.expiryDate) : Number.MAX_SAFE_INTEGER;
        if (ax !== bx) return ax - bx;
        return a.name.localeCompare(b.name);
    });

    return results;
}

/**
 * Tendencia diaria de utilización de una reserva, para el modal que se abre al hacer clic
 * sobre el porcentaje de uso. Combina los aggregates (1/7/30 días) con la serie diaria de
 * Consumption (best-effort; requiere Billing Reader EA/MCA).
 */
export async function getReservationUtilizationTrend(
    credential: TokenCredential,
    orderId: string,
    reservationId: string,
    tenantId?: string,
): Promise<ReservationUtilizationTrend> {
    const token = await armToken(credential);

    const aggregates: ReservationUtilizationTrend["aggregates"] = { oneDay: null, sevenDays: null, thirtyDays: null };

    // 1) Aggregates 1/7/30 días desde la propia reserva.
    try {
        const url = `${ARM_BASE}/providers/Microsoft.Capacity/reservationOrders/${orderId}/reservations/${reservationId}?api-version=${CAPACITY_API_VERSION}&$expand=renewProperties`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
            const json: any = await res.json();
            const aggs = json?.properties?.utilization?.aggregates || [];
            aggregates.oneDay = pickAggregate(aggs, 1);
            aggregates.sevenDays = pickAggregate(aggs, 7);
            aggregates.thirtyDays = pickAggregate(aggs, 30);
        }
    } catch (e) {
        console.warn("[ReservationService] utilization aggregates failed:", errorMessage(e));
    }

    // 2) Serie diaria (últimos 30 días) desde Consumption reservationsSummaries (best-effort).
    const trend: Array<{ date: string; utilization: number }> = [];
    try {
        const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
        const consumption = new ConsumptionManagementClient(credential, tenantId || orderId);
        const end = new Date();
        const start = new Date(end.getTime() - 30 * 86400000);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const filter = `properties/usageDate ge ${fmt(start)} AND properties/usageDate le ${fmt(end)}`;

        const iter = consumption.reservationsSummaries.listByReservationOrderAndReservation(
            orderId,
            reservationId,
            "daily",
            { filter },
        );
        for await (const s of iter as any) {
            const date = s.usageDate ? new Date(s.usageDate).toISOString().slice(0, 10) : "";
            if (!date) continue;
            let util: number | null = null;
            if (typeof s.avgUtilizationPercentage === "number") {
                util = s.avgUtilizationPercentage;
            } else {
                const reserved = Number(s.reservedHours || 0);
                const used = Number(s.usedHours || 0);
                if (reserved > 0) util = (used / reserved) * 100;
            }
            if (util !== null) trend.push({ date, utilization: util });
        }
        trend.sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) {
        console.warn("[ReservationService] utilization daily trend failed:", errorMessage(e));
    }

    return { aggregates, trend };
}

/**
 * Activa o deshabilita la auto-renovación (renew) de una reserva. Mutación en Azure.
 *
 * RBAC Azure mínimo: rol "Reservations Contributor" u "Owner" sobre el reservation order.
 */
export async function setReservationRenew(
    credential: TokenCredential,
    orderId: string,
    reservationId: string,
    renew: boolean,
): Promise<{ renew: boolean; provisioningState?: string }> {
    const token = await armToken(credential);
    const url = `${ARM_BASE}/providers/Microsoft.Capacity/reservationOrders/${orderId}/reservations/${reservationId}?api-version=${CAPACITY_API_VERSION}`;

    const res = await fetch(url, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { renew } }),
    });

    if (!res.ok) {
        const errorText = await res.text().catch(() => "No response body");
        throw new Error(`Azure rechazó el cambio de renovación (${res.status}): ${errorText}`);
    }

    // La respuesta puede ser 200 (síncrono) o 202 (LRO). En ambos casos el cambio quedó aceptado.
    let provisioningState: string | undefined;
    try {
        const json: any = await res.json();
        provisioningState = json?.properties?.provisioningState;
    } catch {
        /* 202 sin body */
    }

    return { renew, provisioningState };
}

export interface ReservationOpportunity {
    skuName: string;
    resourceType: string;
    recommendedQuantity: number;
    totalMonthlyPAYGCost: number;
    costWith1YReservation: number;
    netSavings1Y: number;
    costWith3YReservation: number;
    netSavings3Y: number;
}

import { getSubscriptionsForTenant } from "@/lib/azure";

export async function getReservationRecommendations(credential: TokenCredential, subscriptionId: string, tenantId?: string): Promise<ReservationOpportunity[]> {
    try {
        console.log(`[ReservationService] Fetching reservation recommendations for subscription: ${subscriptionId}`);
        
        // Obtenemos el token de Azure Management
        const tokenData = await credential.getToken("https://management.azure.com/.default");
        if (!tokenData) {
            throw new Error("No se pudo obtener el token de acceso de Azure Management");
        }

        const subscriptions = subscriptionId === 'All' && tenantId ? await getSubscriptionsForTenant(tenantId) : [subscriptionId];
        
        const mapped: ReservationOpportunity[] = [];
        
        // Loop subscriptions and fetch reservations
        for (const sub of subscriptions) {
            const url = `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.CostManagement/generateReservationRecommendation?api-version=2023-03-01`;
            
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenData.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({}) // Cuerpo vacío requerido para llamadas generadoras POST en ARM
            });

            if (!res.ok) {
                const errorText = await res.text().catch(() => "No response body");
                console.error(`[ReservationService] Azure REST API returned status ${res.status} for sub ${sub}: ${errorText}`);
                continue; // Skip failing subscriptions instead of failing the whole tenant
            }

            const json = await res.json();
            console.log(`[ReservationService] Successful response received for sub ${sub}.`);

            const value = json.value || [];
            
            value.forEach((item: any) => {
            const props = item.properties || {};
            
            // Extraer y normalizar propiedades
            const skuName = props.skuName || props.instanceFlexibilityGroup || props.sku || "Unknown SKU";
            const resourceType = props.resourceType || "VirtualMachines";
            const recommendedQuantity = Number(props.recommendedQuantity || props.recommendedQuantityFor1Year || props.recommendedQuantityFor3Years || 1);
            
            // PAYG
            const totalMonthlyPAYGCost = Number(props.totalMonthlyPAYGCost || props.monthlyPAYGCost || props.costWithNoReservation || props.currentCost || 0);
            
            // 1 Year RI
            const costWith1YReservation = Number(props.costWith1YReservation || props.costWith1YearReservation || props.totalCostWith1YearReservation || (totalMonthlyPAYGCost * 0.7)); // fallback teórico 30% ahorro
            const netSavings1Y = Number(props.netSavings1Y || props.netSavingsFor1Year || props.netSavings || (totalMonthlyPAYGCost - costWith1YReservation));
            
            // 3 Years RI
            const costWith3YReservation = Number(props.costWith3YReservation || props.costWith3YearReservation || props.totalCostWith3YearReservation || (totalMonthlyPAYGCost * 0.5)); // fallback teórico 50% ahorro
            const netSavings3Y = Number(props.netSavings3Y || props.netSavingsFor3Years || props.netSavings || (totalMonthlyPAYGCost - costWith3YReservation));

            mapped.push({
                skuName,
                resourceType,
                recommendedQuantity,
                totalMonthlyPAYGCost,
                costWith1YReservation,
                netSavings1Y: netSavings1Y > 0 ? netSavings1Y : 0,
                costWith3YReservation,
                netSavings3Y: netSavings3Y > 0 ? netSavings3Y : 0
            });
        });
        }

        // Group by skuName + resourceType to aggregate cross-subscription recommendations
        const grouped = mapped.reduce((acc: any, curr) => {
            const key = `${curr.skuName}-${curr.resourceType}`;
            if (!acc[key]) {
                acc[key] = { ...curr };
            } else {
                acc[key].recommendedQuantity += curr.recommendedQuantity;
                acc[key].totalMonthlyPAYGCost += curr.totalMonthlyPAYGCost;
                acc[key].costWith1YReservation += curr.costWith1YReservation;
                acc[key].netSavings1Y += curr.netSavings1Y;
                acc[key].costWith3YReservation += curr.costWith3YReservation;
                acc[key].netSavings3Y += curr.netSavings3Y;
            }
            return acc;
        }, {});

        return Object.values(grouped);
    } catch (error) {
        console.error(`[ReservationService] Error querying Azure CostManagement generateReservationRecommendation:`, error);
        throw error;
    }
}
