import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { evaluateHALive } from "@/services/haService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

const MOCK_ITEMS = [
    // Crítico
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-payments-01', resourceName: 'vm-payments-01', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_zone', severity: 'critical', estimatedRisk: 'VM productiva del API de Payments en eastus sin zona ni Availability Set: caída zonal = pérdida total' },
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-payments-02', resourceName: 'vm-payments-02', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_zone', severity: 'critical', estimatedRisk: 'Segunda VM del cluster Payments en la misma zona implícita' },
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-db-prod-01', resourceName: 'vm-db-prod-01', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_backup', severity: 'critical', estimatedRisk: 'SQL Server self-hosted en VM sin política de backup en Recovery Services Vault' },
    { resourceId: '/subscriptions/sub-2/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-finance', resourceName: 'sql-finance', resourceType: 'Microsoft.Sql/servers', issueType: 'no_geo_redundancy', severity: 'critical', estimatedRisk: 'SQL Finance sin failover group ni geo-replica activa' },
    // Alta
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-api-app-01', resourceName: 'vm-api-app-01', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_availability_set', severity: 'high', estimatedRisk: 'API tier en single host sin Availability Set ni VMSS' },
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.ContainerService/managedClusters/aks-prod-east', resourceName: 'aks-prod-east', resourceType: 'Microsoft.ContainerService/managedClusters', issueType: 'no_zone', severity: 'high', estimatedRisk: 'AKS sin agent pool profiles zonales en eastus' },
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-web/providers/Microsoft.Web/serverfarms/asp-portal-prod', resourceName: 'asp-portal-prod', resourceType: 'Microsoft.Web/serverfarms', issueType: 'low_capacity', severity: 'high', estimatedRisk: 'App Service Plan productivo con capacidad 1 (single-instance)' },
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-data/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-orders', resourceName: 'cosmos-orders', resourceType: 'Microsoft.DocumentDB/databaseAccounts', issueType: 'no_geo_redundancy', severity: 'high', estimatedRisk: 'Cosmos DB con una sola región write configurada' },
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-data/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-events', resourceName: 'pg-events', resourceType: 'Microsoft.DBforPostgreSQL/flexibleServers', issueType: 'no_geo_redundancy', severity: 'high', estimatedRisk: 'Postgres Flexible sin Zone-Redundant HA habilitado' },
    // Media
    { resourceId: '/subscriptions/sub-2/resourceGroups/rg-network/providers/Microsoft.Network/publicIPAddresses/pip-lb-front', resourceName: 'pip-lb-front', resourceType: 'Microsoft.Network/publicIPAddresses', issueType: 'basic_sku', severity: 'medium', estimatedRisk: 'Public IP Basic SKU no soporta zonas ni reglas SLA' },
    { resourceId: '/subscriptions/sub-2/resourceGroups/rg-network/providers/Microsoft.Network/publicIPAddresses/pip-vpn-gw', resourceName: 'pip-vpn-gw', resourceType: 'Microsoft.Network/publicIPAddresses', issueType: 'basic_sku', severity: 'medium', estimatedRisk: 'Public IP de VPN Gateway con SKU Basic' },
    { resourceId: '/subscriptions/sub-3/resourceGroups/rg-cache/providers/Microsoft.Cache/Redis/redis-sessions', resourceName: 'redis-sessions', resourceType: 'Microsoft.Cache/Redis', issueType: 'low_capacity', severity: 'medium', estimatedRisk: 'Redis Standard (sin SLA de Premium zonal/geo)' },
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/sql-app-prod', resourceName: 'sql-app-prod', resourceType: 'Microsoft.Sql/servers', issueType: 'no_geo_redundancy', severity: 'medium', estimatedRisk: 'SQL App sin geo-replicación, solo backup local' },
    { resourceId: '/subscriptions/sub-3/resourceGroups/rg-data/providers/Microsoft.DBforMySQL/flexibleServers/mysql-cms', resourceName: 'mysql-cms', resourceType: 'Microsoft.DBforMySQL/flexibleServers', issueType: 'no_geo_redundancy', severity: 'medium', estimatedRisk: 'MySQL Flexible sin HA habilitada' },
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Web/serverfarms/asp-api-prod', resourceName: 'asp-api-prod', resourceType: 'Microsoft.Web/serverfarms', issueType: 'low_capacity', severity: 'medium', estimatedRisk: 'App Service Plan API con capacidad 1' },
    // Baja
    { resourceId: '/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/sapaymentlogs', resourceName: 'sapaymentlogs', resourceType: 'Microsoft.Storage/storageAccounts', issueType: 'single_replica', severity: 'low', estimatedRisk: 'Storage con redundancia Standard_LRS, considerar ZRS' },
    { resourceId: '/subscriptions/sub-2/resourceGroups/rg-archive/providers/Microsoft.Storage/storageAccounts/saarchive01', resourceName: 'saarchive01', resourceType: 'Microsoft.Storage/storageAccounts', issueType: 'single_replica', severity: 'low', estimatedRisk: 'Archive storage con LRS, datos críticos sin geo-replicación' },
    { resourceId: '/subscriptions/sub-2/resourceGroups/rg-backup/providers/Microsoft.Storage/storageAccounts/sabackupdb', resourceName: 'sabackupdb', resourceType: 'Microsoft.Storage/storageAccounts', issueType: 'single_replica', severity: 'low', estimatedRisk: 'Storage de backups con Premium_LRS (sin geo)' },
    { resourceId: '/subscriptions/sub-3/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/sadevstatic', resourceName: 'sadevstatic', resourceType: 'Microsoft.Storage/storageAccounts', issueType: 'single_replica', severity: 'low', estimatedRisk: 'Static website storage LRS' },
    { resourceId: '/subscriptions/sub-2/resourceGroups/rg-test/providers/Microsoft.Compute/virtualMachines/vm-test-bench', resourceName: 'vm-test-bench', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_availability_set', severity: 'low', estimatedRisk: 'VM de benchmark/test sin AS (no productivo)' },
];

function buildCounts(items: any[]) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    items.forEach(r => { if (r.severity in counts) counts[r.severity]++; });
    return counts;
}

const MOCK_RESPONSE = {
    success: true, mock: true, items: MOCK_ITEMS,
    counts: buildCounts(MOCK_ITEMS),
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded?.tid) return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });

        if (isMockTenant(tenantId)) return NextResponse.json(MOCK_RESPONSE);

        // 1) Try live ARG evaluation (cached SWR 15min/5min)
        try {
            const live = await getWithStaleWhileRevalidate(
                `ha:summary:v1:${tenantId}`,
                () => evaluateHALive(tenantId),
                900,
                300
            );
            return NextResponse.json({
                success: true,
                mock: false,
                source: 'arg',
                items: live.items,
                counts: live.counts,
                diagnostics: live.diagnostics,
            });
        } catch (e: any) {
            console.warn('[HA] ARG evaluation failed:', e?.message || e);
        }

        // 2) Fallback to DB table
        try {
            const [rows]: any = await pool.query(
                "SELECT * FROM HARecommendations WHERE tenant_id = ? ORDER BY FIELD(severity,'critical','high','medium','low'), detected_at DESC",
                [tenantId]
            );
            const items = rows || [];
            if (items.length > 0) {
                return NextResponse.json({ success: true, mock: false, source: 'db', items, counts: buildCounts(items) });
            }
        } catch {
            // ignore
        }

        // 3) Empty real result — return a no-issues success (not mock)
        return NextResponse.json({ success: true, mock: false, source: 'arg', items: [], counts: { critical: 0, high: 0, medium: 0, low: 0 } });
    } catch {
        return NextResponse.json(MOCK_RESPONSE);
    }
}
