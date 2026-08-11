/**
 * Backup Orphan Service — detecta instancias protegidas en Recovery Services
 * Vault cuyo recurso original (VM, base de datos, etc.) ya no existe pero
 * sigue generando puntos de restauración y facturando almacenamiento.
 *
 * RBAC mínimo (Service Principal del tenant, solo lectura):
 *   - Reader (Resource Graph) para inventariar vaults y TODOS los resourceId
 *     del tenant (para el diff de existencia).
 *   - Backup Reader sobre cada vault para listar protectedItems.
 *
 * La antigüedad de snapshots ya se cubre en /api/cleanup/zombies
 * (kqlCatalog.oldSnapshots). Este service cubre el gap complementario del
 * reporte: "Instancias Reservadas (RI)"-equivalente para backups — el punto
 * protegido sigue vivo aunque el recurso fuente ya no exista.
 */
import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import { isMockTenant } from "@/lib/mockData";

const ARM_BASE = "https://management.azure.com";
const BACKUP_API_VERSION = "2023-04-01";

// Estimación de costo mensual de almacenamiento de puntos de restauración por
// tipo de carga protegida — no hay tamaño real disponible sin $expand por item
// (llamada extra por recurso), así que se usa un orden de magnitud de
// referencia (LRS, retención estándar), mismo criterio que el resto de los
// costos planos de zombies/networking en esta app.
const MONTHLY_COST_BY_TYPE: Record<string, number> = {
    AzureIaasVM: 12.0,
    AzureWorkload: 8.0,
    AzureStorage: 5.0,
    MAB: 3.0,
    AzureSql: 6.0,
};
const DEFAULT_MONTHLY_COST = 6.0;

export interface OrphanedBackupItemRow {
    subscriptionId: string;
    subscriptionName: string;
    region: string;
    vaultName: string;
    resourceGroup: string;
    itemName: string;
    sourceResourceId: string;
    backupManagementType: string;
    protectionState: string;
    estimatedMonthlyCost: number;
}

export interface BackupOrphanResult {
    items: OrphanedBackupItemRow[];
    totalEstimatedMonthlyCost: number;
    dataAvailable: boolean;
}

const MOCK_ITEMS: OrphanedBackupItemRow[] = [
    { subscriptionId: 'sub-mock-01', subscriptionName: 'Subscription Mock 01', region: 'eastus', vaultName: 'rsv-prod-backup', resourceGroup: 'rg-backups', itemName: 'vm-decommissioned-01', sourceResourceId: 'mock', backupManagementType: 'AzureIaasVM', protectionState: 'ProtectionStopped', estimatedMonthlyCost: 12.0 },
    { subscriptionId: 'sub-mock-01', subscriptionName: 'Subscription Mock 01', region: 'eastus', vaultName: 'rsv-prod-backup', resourceGroup: 'rg-backups', itemName: 'sqldb-legacy-app', sourceResourceId: 'mock', backupManagementType: 'AzureWorkload', protectionState: 'ProtectionStopped', estimatedMonthlyCost: 8.0 },
];

async function armToken(credential: any): Promise<string> {
    const tokenData = await credential.getToken(`${ARM_BASE}/.default`);
    if (!tokenData) throw new Error("No se pudo obtener el token de acceso de Azure Management");
    return tokenData.token;
}

export const getOrphanedBackupItems = async (tenantId: string): Promise<BackupOrphanResult> => {
    if (isMockTenant(tenantId)) {
        return { items: MOCK_ITEMS, totalEstimatedMonthlyCost: Number(MOCK_ITEMS.reduce((s, i) => s + i.estimatedMonthlyCost, 0).toFixed(2)), dataAvailable: true };
    }

    let vaults: any[] = [];
    let allResourceIds: Set<string> = new Set();
    let subscriptionsById = new Map<string, string>();
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const vaultsRes: any = await argClient.resources({
            query: `Resources | where type =~ 'microsoft.recoveryservices/vaults' | project name, resourceGroup, subscriptionId, location, id`,
            options: { resultFormat: "objectArray", top: 1000 },
        });
        vaults = (vaultsRes.data as any[]) || [];

        const subsRes: any = await argClient.resources({
            query: `ResourceContainers | where type =~ 'microsoft.resources/subscriptions' | project subscriptionId, subscriptionName=name`,
            options: { resultFormat: "objectArray", top: 1000 },
        });
        subscriptionsById = new Map(
            (((subsRes.data as any[]) || []) as any[]).map((s: any) => [String(s.subscriptionId), String(s.subscriptionName || s.subscriptionId)])
        );

        // Inventario completo de resourceIds (un solo query) para el diff de
        // existencia — evita N llamadas a Resource Graph, una por item protegido.
        const allRes: any = await argClient.resources({
            query: `Resources | project id`,
            options: { resultFormat: "objectArray", top: 1000 },
        });
        allResourceIds = new Set(((allRes.data as any[]) || []).map((r) => String(r.id).toLowerCase()));
    } catch (e: unknown) {
        console.warn(`[Backup Orphan] No se pudo inventariar para ${tenantId}:`, e instanceof Error ? e.message : e);
        return { items: [], totalEstimatedMonthlyCost: 0, dataAvailable: false };
    }

    if (vaults.length === 0) return { items: [], totalEstimatedMonthlyCost: 0, dataAvailable: true };

    let credential;
    try {
        credential = await getAzureCredential(tenantId);
    } catch {
        return { items: [], totalEstimatedMonthlyCost: 0, dataAvailable: false };
    }

    const items: OrphanedBackupItemRow[] = [];
    for (const vault of vaults) {
        try {
            const token = await armToken(credential);
            const url = `${ARM_BASE}/Subscriptions/${vault.subscriptionId}/resourceGroups/${vault.resourceGroup}/providers/Microsoft.RecoveryServices/vaults/${vault.name}/backupProtectedItems?api-version=${BACKUP_API_VERSION}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) continue;
            const json: any = await res.json();
            for (const item of json.value || []) {
                const props = item.properties || {};
                const sourceResourceId = String(props.sourceResourceId || props.virtualMachineId || "").toLowerCase();
                if (!sourceResourceId) continue;
                if (allResourceIds.has(sourceResourceId)) continue; // recurso fuente sigue existiendo
                const backupManagementType = props.backupManagementType || "—";
                items.push({
                    subscriptionId: vault.subscriptionId,
                    subscriptionName: subscriptionsById.get(String(vault.subscriptionId)) || String(vault.subscriptionId),
                    region: vault.location || "global",
                    vaultName: vault.name,
                    resourceGroup: vault.resourceGroup,
                    itemName: props.friendlyName || props.virtualMachineId?.split("/").pop() || String(item.name || "—"),
                    sourceResourceId,
                    backupManagementType,
                    protectionState: props.protectionState || "—",
                    estimatedMonthlyCost: MONTHLY_COST_BY_TYPE[backupManagementType] ?? DEFAULT_MONTHLY_COST,
                });
            }
        } catch (e: unknown) {
            console.warn(`[Backup Orphan] Error leyendo vault ${vault.name}:`, e instanceof Error ? e.message : e);
        }
    }

    return { items, totalEstimatedMonthlyCost: Number(items.reduce((s, i) => s + i.estimatedMonthlyCost, 0).toFixed(2)), dataAvailable: true };
};
