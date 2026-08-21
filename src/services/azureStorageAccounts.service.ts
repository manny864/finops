import {
    StorageAccountDetail,
    StorageRemediationAction,
} from "@/types/storage.types";

export const TIER_RATES: Record<string, number> = {
    hot: 0.0184,
    cool: 0.0100,
    cold: 0.0036,
    archive: 0.00099,
};

export const BENCHMARK_LRS_RATE = 0.0184;

export function detectRedundancyType(skuName?: string): string {
    const sku = String(skuName || "").toUpperCase();
    if (sku.includes("RA-GZRS") || sku.includes("RAGZRS")) return "RA-GZRS";
    if (sku.includes("GZRS")) return "GZRS";
    if (sku.includes("RA-GRS") || sku.includes("RAGRS")) return "RA-GRS";
    if (sku.includes("GRS")) return "GRS";
    if (sku.includes("ZRS")) return "ZRS";
    if (sku.includes("LRS")) return "LRS";
    return "LRS";
}

export function detectEnvironment(tags?: Record<string, string>, name?: string, rg?: string): string {
    const checkStr = `${JSON.stringify(tags || {})} ${name || ""} ${rg || ""}`.toLowerCase();
    if (checkStr.includes("prod") || checkStr.includes("production")) return "prod";
    if (checkStr.includes("stg") || checkStr.includes("staging")) return "staging";
    if (checkStr.includes("dev") || checkStr.includes("development")) return "dev";
    if (checkStr.includes("test") || checkStr.includes("testing")) return "test";
    if (checkStr.includes("qa") || checkStr.includes("uat")) return "qa";
    return "prod";
}

export function generateLifecyclePolicyJson(accountName: string, moveDaysToCool = 60, deleteDays = 365): string {
    const policy = {
        rules: [
            {
                enabled: true,
                name: `FinOps-Lifecycle-Optimization-${accountName}`,
                type: "Lifecycle",
                definition: {
                    actions: {
                        baseBlob: {
                            tierToCool: {
                                daysAfterModificationGreaterThan: moveDaysToCool,
                            },
                            tierToArchive: {
                                daysAfterModificationGreaterThan: 180,
                            },
                            delete: {
                                daysAfterModificationGreaterThan: deleteDays,
                            },
                        },
                        snapshot: {
                            delete: {
                                daysAfterCreationGreaterThan: 90,
                            },
                        },
                        version: {
                            delete: {
                                daysAfterCreationGreaterThan: 90,
                            },
                        },
                    },
                    filters: {
                        blobTypes: ["blockBlob"],
                        prefixMatch: [],
                    },
                },
            },
        ],
    };
    return JSON.stringify(policy, null, 2);
}

export function buildStorageRemediations(accounts: StorageAccountDetail[]): StorageRemediationAction[] {
    const remediations: StorageRemediationAction[] = [];

    for (const acc of accounts) {
        const env = acc.environmentTag || detectEnvironment(acc.tags, acc.name, acc.resourceGroup);
        const usedGb = acc.usedGb ?? 0;
        const monthlyCost = acc.monthlyCost || 0;
        const redundancy = detectRedundancyType(acc.skuName);

        // 1. Lifecycle Policy Generator
        if (!acc.hasLifecyclePolicy && (acc.tier === "Hot" || acc.tier === "Standard") && usedGb > 0.1) {
            const estimatedSavings = parseFloat((monthlyCost * 0.42).toFixed(2));
            const jsonPayload = generateLifecyclePolicyJson(acc.name, 60, 365);
            const cliCommand = `az storage account management-policy create \\\n  --account-name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --policy '${jsonPayload.replace(/\n/g, "")}'`;
            const powershellCommand = `Set-AzStorageAccountManagementPolicy -ResourceGroupName "${acc.resourceGroup}" -StorageAccountName "${acc.name}" -Policy (ConvertFrom-Json @'\n${jsonPayload}\n'@)`;

            remediations.push({
                id: `remediation-lifecycle-${acc.name}`,
                title: `Implementación de Lifecycle Management Policy`,
                description: `La cuenta '${acc.name}' está en capa Hot sin reglas de ciclo de vida automáticas. Mover blobs con antigüedad > 60 días a Cool optimiza el costo de almacenamiento en hasta un 45%.`,
                impactDescription: `Ahorro potencial mensual de ~$${estimatedSavings} USD sin pérdida de disponibilidad ni disrupción de aplicaciones.`,
                category: "Cost",
                actionType: "LIFECYCLE_POLICY_CREATE",
                severity: "HIGH",
                confidence: "HIGH",
                estimatedSavingsUSD: Math.max(estimatedSavings, 0.5),
                estimatedSavingsPct: 45,
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                jsonPayload,
                cliCommand,
                powershellCommand,
                implementationSteps: [
                    `Crear la regla de ciclo de vida (Management Policy) en Azure Storage.`,
                    `Configurar transición automática de blobs a nivel 'Cool' a los 60 días.`,
                    `Configurar transición a nivel 'Archive' a los 180 días si aplica para registros históricos.`,
                    `Verificar que las transacciones de lectura sean bajas para maximizar el ROI.`,
                ],
            });
        }

        // 2. Redundancy Arbitrage in Non-Prod (ZRS/GRS -> LRS)
        if ((env === "dev" || env === "staging" || env === "test" || env === "qa") && (redundancy === "ZRS" || redundancy === "GRS" || redundancy === "RA-GRS")) {
            const savingsPct = redundancy === "GRS" || redundancy === "RA-GRS" ? 50 : 33;
            const estimatedSavings = parseFloat((monthlyCost * (savingsPct / 100)).toFixed(2));
            const cliCommand = `az storage account update \\\n  --name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --sku Standard_LRS`;
            const powershellCommand = `Set-AzStorageAccount -ResourceGroupName "${acc.resourceGroup}" -Name "${acc.name}" -SkuName "Standard_LRS"`;

            remediations.push({
                id: `remediation-redundancy-${acc.name}`,
                title: `Optimización de Redundancia en ${env.toUpperCase()} (${redundancy} → Standard_LRS)`,
                description: `La cuenta de no-producción '${acc.name}' está configurada con redundancia ${redundancy}, generando un sobrecosto del ${savingsPct}% en capacidad que no es necesario para entornos de desarrollo o pruebas.`,
                impactDescription: `Ahorro inmediato de ~$${estimatedSavings} USD/mes al migrar a Standard_LRS.`,
                category: "Cost",
                actionType: "REDUNDANCY_OPTIMIZE_LRS",
                severity: "MEDIUM",
                confidence: "HIGH",
                estimatedSavingsUSD: Math.max(estimatedSavings, 1.2),
                estimatedSavingsPct: savingsPct,
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                cliCommand,
                powershellCommand,
                implementationSteps: [
                    `Verificar que la cuenta pertenezca a un entorno de desarrollo o preproducción.`,
                    `Ejecutar el cambio de SKU a Standard_LRS de forma no disruptiva en Azure.`,
                    `Monitorear la facturación en el próximo ciclo para confirmar la reducción de costo.`,
                ],
            });
        }

        // 3. Zombie / Empty Account Detection
        if ((acc.isZombieCandidate || (usedGb <= 0.001 && (acc.metrics?.transactionsCount ?? 0) < 10)) && monthlyCost <= 0.5) {
            const cliCommand = `az storage account delete \\\n  --name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --yes`;
            const powershellCommand = `Remove-AzStorageAccount -ResourceGroupName "${acc.resourceGroup}" -Name "${acc.name}" -Force`;

            remediations.push({
                id: `remediation-zombie-${acc.name}`,
                title: `Detección de Cuenta Zombie / Vacía (0 GB)`,
                description: `La cuenta '${acc.name}' no registra datos almacenados (0 MB) ni tráfico/transacciones activas en los últimos 30 días, representando un recurso huérfano.`,
                impactDescription: `Limpieza de inventario y reducción de superficie de ataque y costos residuales.`,
                category: "Governance",
                actionType: "ZOMBIE_ACCOUNT_PURGE",
                severity: "LOW",
                confidence: "HIGH",
                estimatedSavingsUSD: Math.max(monthlyCost, 0.1),
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                cliCommand,
                powershellCommand,
                implementationSteps: [
                    `Auditar si la cuenta es requerida por alguna infraestructura como código (Terraform/Bicep).`,
                    `Confirmar con los propietarios del recurso antes de proceder con la eliminación.`,
                    `Eliminar la cuenta huérfana de forma segura.`,
                ],
            });
        }

        // 4. Soft Delete Retention Adjustment
        if (acc.deleteRetentionEnabled && acc.deleteRetentionDays > 14) {
            const estimatedSavings = parseFloat((monthlyCost * 0.18).toFixed(2));
            const cliCommand = `az storage account blob-service-properties update \\\n  --account-name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --enable-delete-retention true \\\n  --delete-retention-days 7`;
            const powershellCommand = `Enable-AzStorageBlobDeleteRetentionPolicy -ResourceGroupName "${acc.resourceGroup}" -StorageAccountName "${acc.name}" -RetentionDays 7`;

            remediations.push({
                id: `remediation-softdelete-${acc.name}`,
                title: `Ajuste de Retención de Soft Delete (${acc.deleteRetentionDays}d → 7 días)`,
                description: `La retención de blobs eliminados (Soft Delete) está configurada en ${acc.deleteRetentionDays} días. Los datos borrados continúan facturando almacenamiento durante todo el periodo.`,
                impactDescription: `Reduce la acumulación de datos fantasma y ahorra hasta un 18% en costos de capacidad innecesaria.`,
                category: "Cost",
                actionType: "SOFT_DELETE_RETENTION_ADJUST",
                severity: "MEDIUM",
                confidence: "MEDIUM",
                estimatedSavingsUSD: Math.max(estimatedSavings, 0.5),
                estimatedSavingsPct: 18,
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                cliCommand,
                powershellCommand,
                implementationSteps: [
                    `Evaluar la política de cumplimiento y recuperación de desastres interna.`,
                    `Reducir el periodo de retención de Soft Delete a 7 días recomendados por FinOps.`,
                    `Aplicar la actualización en las propiedades del servicio de blobs.`,
                ],
            });
        }

        // 5. Security Hardening (Public Access & TLS)
        if (acc.publicAccessAllowed || acc.minimumTlsVersion !== "TLS1_2") {
            const cliCommand = `az storage account update \\\n  --name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --allow-blob-public-access false \\\n  --min-tls-version TLS1_2`;
            const powershellCommand = `Set-AzStorageAccount -ResourceGroupName "${acc.resourceGroup}" -Name "${acc.name}" -AllowBlobPublicAccess $false -MinimumTlsVersion "TLS1_2"`;

            remediations.push({
                id: `remediation-security-${acc.name}`,
                title: `Hardening de Seguridad (Public Access & TLS 1.2)`,
                description: `La cuenta '${acc.name}' tiene ${acc.publicAccessAllowed ? "acceso público anónimo habilitado" : "versión TLS desactualizada"}. Es imperativo cerrar el acceso anónimo y forzar TLS 1.2.`,
                impactDescription: `Asegura el cumplimiento de normativas de seguridad cloud y gobernanza corporativa.`,
                category: "Security",
                actionType: "SECURITY_HARDENING_PUBLIC_ACCESS",
                severity: "HIGH",
                confidence: "HIGH",
                estimatedSavingsUSD: 0,
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                cliCommand,
                powershellCommand,
                implementationSteps: [
                    `Verificar que ningún servicio legítimo requiera lectura pública sin autenticación.`,
                    `Deshabilitar allowBlobPublicAccess a nivel de cuenta de almacenamiento.`,
                    `Establecer el protocolo mínimo a TLS 1.2.`,
                ],
            });
        }
    }

    // Sort: Cost savings highest first, then severity
    return remediations.sort((a, b) => (b.estimatedSavingsUSD || 0) - (a.estimatedSavingsUSD || 0));
}
