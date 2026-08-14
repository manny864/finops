# Capa de negocio: services y modules (generado)

> Generado por `scripts/generate-lld.mjs`. No editar a mano.

Ordenado por tamaño descendente: los archivos más largos son los candidatos
naturales a revisar primero cuando algo del dominio no cierra.

## src/services/

Un archivo por dominio funcional. Los llaman los route handlers, nunca la UI directamente.

26 archivos.

| Archivo | Líneas | Exports principales |
|---|---|---|
| `src/services/anomalyDetectionService.ts` | 374 | `DETECTION_WINDOW_DAYS`, `SENSITIVITY_Z_SCORE`, `DailyCost`, `DetectedAnomaly`, `AnomalyContributor`, `computeStats`, … |
| `src/services/reservationService.ts` | 348 | `ActiveReservationDetail`, `ReservationUtilizationTrend`, `parseReservationResourceId`, `getActiveReservations`, `getReservationUtilizationTrend`, `setReservationRenew`, … |
| `src/services/powerScheduleService.ts` | 321 | `PowerScheduleAction`, `PowerScheduleInput`, `PowerScheduleRow`, `upsertPowerSchedule`, `listPowerSchedules`, `deletePowerSchedule`, … |
| `src/services/haService.ts` | 259 | `HASeverity`, `HAItem`, `HAEvalResult`, `evaluateHALive` |
| `src/services/budgetService.ts` | 252 | `getNativeBudgets`, `getBudgetConsumption`, `getBudgetCostCenterMonthlyHistory`, `createSubscriptionBudget`, `deleteSubscriptionBudget` |
| `src/services/aiService.ts` | 208 | `isAiGloballyEnabled`, `getAIConfig`, `generateFinOpsReport` |
| `src/services/tagInheritanceService.ts` | 186 | `MissingTagsRow`, `ApplyOp`, `ApplyResult`, `analyzeMissingTags`, `applyTagInheritance` |
| `src/services/governanceReportingService.ts` | 184 | `PolicyComplianceDetail`, `GovernanceReport`, `getGovernanceReport` |
| `src/services/remediationService.ts` | 179 | `deleteResource`, `deallocateVirtualMachine`, `startVirtualMachine`, `restartVirtualMachine`, `downgradeVirtualMachine` |
| `src/services/costGroupDetailMetricsService.ts` | 168 | `getCurrentFY`, `getMonthlyCostTrend`, `getAnomalyCount`, `getPeriodComparison`, `getTopBreakdown` |
| `src/services/snapshotService.ts` | 167 | `SNAPSHOT_RETENTION_DAYS`, `SNAPSHOT_DOMAINS`, `SnapshotDomain`, `SnapshotPoint`, `recordDailySnapshot`, `recordDailySnapshotAsync`, … |
| `src/services/credentialExpiryService.ts` | 159 | `CredItem`, `severityFor`, `getGraphTokenForTenant`, `fetchAllApplications`, `extractExpiringCreds`, `getExpiringCredentials`, … |
| `src/services/licenseService.ts` | 154 | `LicenseSku`, `InactiveUser`, `getTenantLicensesAndInactiveUsers` |
| `src/services/invoicingAggregationService.ts` | 150 | `buildInvoicingPayload` |
| `src/services/auditService.ts` | 148 | `runGraphAudits`, `runMonitorAudits`, `runM365Audits` |
| `src/services/ttlService.ts` | 137 | `TTL_RESOURCE_TYPES`, `TtlResourceType`, `findExpiredResources`, `getUnlabeledResources` |
| `src/services/commitmentSimulatorService.ts` | 130 | `CommitmentSimulation`, `getCommitmentSimulation` |
| `src/services/rateService.ts` | 126 | `calculateReservationSavings` |
| `src/services/carbonService.ts` | 111 | `regionIntensity`, `calculateEmissions`, `calculateDiskEmissions`, `calculateStorageEmissions`, `emissionsEquivalencies`, `MigrationRecommendation`, … |
| `src/services/workbookService.ts` | 107 | `deployFinOpsWorkbook` |
| `src/services/pricingService.ts` | 104 | `getMonthlyCostEstimate`, `getRetailPricing` |
| `src/services/providerLifecycleService.ts` | 90 | `TenantProviderState`, `getTenantProviderState`, `TierChangeResult`, `applyTierChange`, `ProviderDisabledError`, `assertProviderIngestable` |
| `src/services/tenantHealthService.ts` | 82 | `verifyTenantCredentials` |
| `src/services/networkCostService.ts` | 62 | `getNetworkEgressCosts` |
| `src/services/tenantTeardownService.ts` | 47 | `teardownTenant` |
| `src/services/allocationService.ts` | 42 | `CostEntry`, `AllocationRule`, `calculateChargeback` |

## src/modules/

Integración con SDKs de Azure (`collectors/`), motores agnósticos (`core/`) y persistencia (`storage/`).

41 archivos.

| Archivo | Líneas | Exports principales |
|---|---|---|
| `src/modules/collectors/azure/containerAppsCostService.ts` | 478 | `ContainerAppCostRow`, `ContainerRegistryCostRow`, `ContainerEnvironmentCostRow`, `ContainerAppsCostResult`, `getContainerAppsCost` |
| `src/modules/core/aiProvider.ts` | 418 | `invalidateAIConfigCache`, `redactForDataSharing`, `AIProviderFactory`, `getAssessment`, `generateExecutiveReportEmailIntro`, `focusCostEntrySchema`, … |
| `src/modules/collectors/azure/logAnalyticsCostService.ts` | 371 | `LogAnalyticsRecommendation`, `LogAnalyticsWorkspaceRow`, `LogAnalyticsCostResult`, `getLogAnalyticsCost` |
| `src/modules/collectors/azure/resourceInventoryService.ts` | 368 | `InventoryResourceRow`, `SearchResourcesFilters`, `searchResources`, `getResourceCostsById`, `getInventoryDistribution`, `getCreatedByAggregation`, … |
| `src/modules/collectors/azure/billing/historicalBillingService.ts` | 353 | `getHistoricalDailyCosts`, `getHistoricalDetailedCosts` |
| `src/modules/collectors/azure/billing/mtdBillingService.ts` | 289 | `getCurrentMonthAmortizedCostsWithDiagnostics`, `getCurrentMonthAmortizedCosts` |
| `src/modules/collectors/azure/m365UsersService.ts` | 281 | `getUsersDetail`, `summarizeLicenses`, `getMfaAndAuthMethods`, `getGroups`, `getM365Overview`, `getUserActivity` |
| `src/modules/collectors/azure/aiServiceCollectors.ts` | 269 | `syncSpeechLanguageSnapshots`, `syncVisionVideoSnapshots`, `syncContentSafetySnapshots`, `syncAMLSnapshots`, `syncDatabricksSnapshots` |
| `src/modules/collectors/azure/billing/yesterdayBillingService.ts` | 266 | `getYesterdaysCost`, `getYesterdaysDetailedCosts` |
| `src/modules/storage/db.ts` | 260 | `initializeDatabase`, `insertCostSnapshot`, `insertCostSnapshotRow`, `insertAICostSnapshotRow`, `insertPlatformAiUsage`, `insertCostMeterSnapshotRow`, … |
| `src/modules/collectors/azure/cosmosDbCostService.ts` | 223 | `CosmosDbAccountRow`, `CosmosDbCostResult`, `getCosmosDbCost` |
| `src/modules/collectors/azure/aiUsageCollector.ts` | 216 | `AIUsageRow`, `getYesterdaysAIUsage` |
| `src/modules/collectors/azure/azureSearchCollector.ts` | 212 | `getAzureSearchResources`, `getAzureSearchMetrics`, `syncAzureSearchSnapshots` |
| `src/modules/collectors/azure/vmssRightsizingService.ts` | 185 | `VmssRightsizingRow`, `VmssRightsizingResult`, `getVmssRightsizingRecommendations` |
| `src/modules/collectors/azure/advisorCollector.ts` | 179 | `collectAdvisorData` |
| `src/modules/collectors/azure/foundryCollector.ts` | 173 | `syncFoundrySnapshots` |
| `src/modules/collectors/azure/sqlDbRightsizingService.ts` | 171 | `SqlDbRightsizingRow`, `SqlDbRightsizingResult`, `getSqlDbRightsizingRecommendations` |
| `src/modules/collectors/azure/billing/forecastBillingService.ts` | 170 | `getCostForecast` |
| `src/modules/collectors/azure/docIntelCollector.ts` | 170 | `getDocIntelResources`, `getDocIntelMetrics`, `syncDocIntelSnapshots` |
| `src/modules/storage/migrations.ts` | 165 | `MigrationResult`, `runMigrations`, `getMigrationsStatus` |
| `src/modules/collectors/azure/storageTieringService.ts` | 162 | `StorageTieringRow`, `StorageTieringResult`, `getStorageTieringRecommendations` |
| `src/modules/storage/recommendationExemptions.ts` | 152 | `RecommendationExemption`, `getExemptionsForTenant`, `upsertExemption`, `deleteExemption` |
| `src/modules/collectors/azure/aksCostService.ts` | 150 | `vmSizeToCores`, `getAksChargebackCost` |
| `src/modules/collectors/azure/backupOrphanService.ts` | 145 | `OrphanedBackupItemRow`, `BackupOrphanResult`, `getOrphanedBackupItems` |
| `src/modules/collectors/azure/defenderCostService.ts` | 143 | `DefenderPlanRow`, `DefenderCostResult`, `getDefenderCost`, `setDefenderPlanTier` |
| `src/modules/collectors/azure/appInsightsCostService.ts` | 135 | `AppInsightsCostRow`, `AppInsightsCostResult`, `getAppInsightsCost` |
| `src/modules/collectors/azure/perimeterNetworkCostService.ts` | 121 | `PerimeterCostRow`, `PerimeterCostResult`, `getPerimeterNetworkCost` |
| `src/modules/collectors/azure/miscServicesCostService.ts` | 116 | `MISC_SERVICE_TYPES`, `MiscServiceCostRow`, `MiscServicesCostResult`, `getMiscServicesCost` |
| `src/modules/collectors/azure/billing/billingHelpers.ts` | 104 | `throwIfAborted`, `sleep`, `extractRetryAfterMs`, `is429`, `CacheEntry`, `COST_CACHE`, … |
| `src/modules/core/kqlCatalog.ts` | 100 | `kqlCatalog` |
| `src/modules/core/focusMapper.ts` | 83 | `FocusCostEntry`, `mapAzureToFocus`, `mapCsvToFocus` |
| `src/modules/core/rightsizingEngine.ts` | 80 | `analyzeVmEfficiency` |
| `src/modules/collectors/azure/metricsService.ts` | 68 | `getVmUtilization` |
| `src/modules/storage/regionPool.ts` | 60 | `getTenantPool`, `resolveTenantPool` |
| `src/modules/storage/tenantBudget.service.ts` | 55 | `TenantBudget`, `upsertTenantBudget`, `getTenantBudgetByPeriod` |
| `src/modules/collectors/azureProvider.ts` | 52 | `AzureProvider` |
| `src/modules/collectors/azure/billing/billingTypes.ts` | 38 | `CostQueryDiagnostics`, `DetailedCostRow`, `HistoricalDetailedCostRow`, `AZURE_COST_HISTORY_MAX_MONTHS` |
| `src/modules/collectors/providerFactory.ts` | 16 | `getCloudProvider` |
| `src/modules/collectors/types.ts` | 11 | `DateRange`, `CloudProvider` |
| `src/modules/collectors/azure/billing/index.ts` | 7 | — |
| `src/modules/collectors/azure/billingService.ts` | 7 | — |
