# Capa de negocio: services y modules (generado)

> Generado por `scripts/generate-lld.mjs`. No editar a mano.

Ordenado por tamaño descendente: los archivos más largos son los candidatos
naturales a revisar primero cuando algo del dominio no cierra.

## src/services/

Un archivo por dominio funcional. Los llaman los route handlers, nunca la UI directamente.

59 archivos.

| Archivo | Líneas | Exports principales |
|---|---|---|
| `src/services/azureBasicNetworking.service.ts` | 1182 | `detectBasicNetworkEnvironment`, `fetchLiveBasicNetworkInventory`, `fetchBasicNetworkCosts`, `getMockBasicNetworkingResponse`, `computeLiveBasicNetworking` |
| `src/services/azureAiSummary.service.ts` | 1116 | `getAzureAiSummary` |
| `src/services/realConsumptionService.ts` | 1074 | `getServiceRemediationRule`, `getServiceIconName`, `getMockRealConsumptionOverview`, `DiscoveredTenantResource`, `TenantInventoryContext`, `mapResourceTypeToServiceName`, … |
| `src/services/categoryConsumptionService.ts` | 909 | `getCategoryColor`, `getCategoryIconName`, `mapServiceToCategory`, `getCategoryRemediationRule`, `getRealCategoryOverview`, `getMockCategoryOverview` |
| `src/services/azureHybridConnectivity.service.ts` | 891 | `getAzureHybridConnectivity`, `getMockHybridConnectivityData` |
| `src/services/azureDdosProtection.service.ts` | 889 | `getAzureDdosProtection` |
| `src/services/azureAiFoundry.service.ts` | 868 | `getFoundryDetail` |
| `src/services/azureLoadBalancing.service.ts` | 797 | `getAzureLoadBalancing`, `getMockLoadBalancingData` |
| `src/services/azureInternetAccess.service.ts` | 774 | `getAzureInternetAccess`, `getMockInternetAccessData` |
| `src/services/azureAdvisor.service.ts` | 751 | `generateMockAdvisorData`, `deduplicateAndProcessRecommendations`, `getAdvisorExecutiveData` |
| `src/services/azureResourcesInventory.service.ts` | 729 | `generateMockResourcesSearch`, `generateMockResourcesInventory`, `generateMockResourcesCreatedBy`, `generateMockResourcesCostsByTag`, `getResourceCostsById`, `searchLiveResources`, … |
| `src/services/azureAiSearch.service.ts` | 624 | `getAiSearchPayload` |
| `src/services/azureHistoricalProgress.service.ts` | 579 | `getDaysForRange`, `estimateMonthlySavings`, `generateMockHistoricalProgress`, `getLiveHistoricalProgress` |
| `src/services/azureZombieHunting.service.ts` | 502 | `AzureZombieHuntingService` |
| `src/services/azureNetworkAnalytics.service.ts` | 472 | `fetchLiveNetworkInventory`, `fetchLiveNetworkCosts`, `computeLiveNetworkAnalytics` |
| `src/services/azureDatabricks.service.ts` | 451 | `generateMockDatabricksData`, `calculateDatabricksSummary`, `generateDatabricksRecommendations`, `buildDatabricksRemediationCommand`, `getLiveDatabricksData` |
| `src/services/azureDocumentIntelligence.service.ts` | 447 | `getDocumentIntelligencePayload` |
| `src/services/azureVisionVideo.service.ts` | 434 | `generateMockVisionVideoData`, `calculateVisionVideoSummary`, `generateVisionVideoRecommendations`, `buildVisionRemediationCommand`, `getLiveVisionVideoData` |
| `src/services/budgetService.ts` | 434 | `calculateBudgetProjection`, `getDiscoveredCostCenterTags`, `getNativeBudgets`, `getBudgetConsumption`, `getBudgetCostCenterMonthlyHistory`, `createSubscriptionBudget`, … |
| `src/services/azureMachineLearning.service.ts` | 415 | `generateMockAmlData`, `calculateAmlSummary`, `generateAmlRecommendations`, `buildAmlRemediationCommand`, `getLiveAmlData` |
| `src/services/managedDisks.service.ts` | 405 | `DISK_TIER_RATES`, `extractVmNameFromManagedBy`, `detectDiskRedundancy`, `detectDiskEnvironment`, `resolveDiskTierCode`, `estimateMonthlyDiskCost`, … |
| `src/services/azureContentSafety.service.ts` | 398 | `generateMockContentSafetyData`, `calculateContentSafetySummary`, `generateContentSafetyRecommendations`, `buildContentSafetyRemediationCommand`, `getLiveContentSafetyData` |
| `src/services/azureMaturity.service.ts` | 388 | `generateMockMaturityData`, `getLiveMaturityData`, `getFinOpsMaturityAssessment`, `recalculateMaturityWithAssessment` |
| `src/services/anomalyDetectionService.ts` | 374 | `DETECTION_WINDOW_DAYS`, `SENSITIVITY_Z_SCORE`, `DailyCost`, `DetectedAnomaly`, `AnomalyContributor`, `computeStats`, … |
| `src/services/azureBackups.service.ts` | 354 | `BACKUP_RATES`, `detectVaultEnvironment`, `normalizeRedundancy`, `estimateMonthlyVaultCost`, `buildBackupRemediations`, `computeBackupsKpis`, … |
| `src/services/coinIndexService.ts` | 348 | `getCoinIndexSummary` |
| `src/services/reservationService.ts` | 348 | `ActiveReservationDetail`, `ReservationUtilizationTrend`, `parseReservationResourceId`, `getActiveReservations`, `getReservationUtilizationTrend`, `setReservationRenew`, … |
| `src/services/whiteboard.service.ts` | 337 | `CurrentMonthCostAggregation`, `readCostCenter`, `getCurrentMonthCostAggregation`, `extractReadableResourceName`, `extractSavings`, `buildQuickWinCliCommand`, … |
| `src/services/powerScheduleService.ts` | 321 | `PowerScheduleAction`, `PowerScheduleInput`, `PowerScheduleRow`, `upsertPowerSchedule`, `listPowerSchedules`, `deletePowerSchedule`, … |
| `src/services/azureDataLakeGen2.service.ts` | 299 | `ADLS_RATES`, `detectDataLakeRedundancy`, `detectDataLakeEnvironment`, `buildDataLakeRemediations`, `computeDataLakeKpis`, `aggregateDataLakeStorage`, … |
| `src/services/azureSustainability.service.ts` | 293 | `AzureSustainabilityService` |
| `src/services/m365UserActivity.service.ts` | 276 | `getEnrichedUserActivity`, `getUserSignInHistory` |
| `src/services/azureLicenseOptimization.service.ts` | 265 | `getLicenseOptimizationData` |
| `src/services/azureTopSpend.service.ts` | 260 | `TopSpendTimeframe`, `generateMockTopSpend`, `getLiveTopSpend` |
| `src/services/haService.ts` | 259 | `HASeverity`, `HAItem`, `HAEvalResult`, `evaluateHALive` |
| `src/services/azureStorageAccounts.service.ts` | 246 | `TIER_RATES`, `BENCHMARK_LRS_RATE`, `detectRedundancyType`, `detectEnvironment`, `generateLifecyclePolicyJson`, `buildStorageRemediations` |
| `src/services/azureCapturedSavings.service.ts` | 242 | `AzureCapturedSavingsService` |
| `src/services/aiService.ts` | 204 | `isAiGloballyEnabled`, `getAIConfig`, `generateFinOpsReport` |
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
| `src/services/costExportIngestionService.ts` | 119 | `IngestionResult`, `ingestCostExportsForTenant` |
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

42 archivos.

| Archivo | Líneas | Exports principales |
|---|---|---|
| `src/modules/core/aiProvider.ts` | 527 | `invalidateAIConfigCache`, `redactForDataSharing`, `extractAiErrorMessage`, `resolveAzureAiModel`, `AIProviderFactory`, `getAssessment`, … |
| `src/modules/collectors/azure/containerAppsCostService.ts` | 478 | `ContainerAppCostRow`, `ContainerRegistryCostRow`, `ContainerEnvironmentCostRow`, `ContainerAppsCostResult`, `getContainerAppsCost` |
| `src/modules/collectors/azure/aiServiceCollectors.ts` | 397 | `getAiServiceRealCost`, `getSpeechLanguageResources`, `syncSpeechLanguageSnapshots`, `getVisionVideoResources`, `syncVisionVideoSnapshots`, `getContentSafetyResources`, … |
| `src/modules/collectors/azure/aksCostService.ts` | 390 | `vmSizeToCores`, `vmSizeToMemoryGB`, `VmArchitecture`, `detectVmArchitecture`, `extractVmGeneration`, `getAksChargebackCost` |
| `src/modules/collectors/azure/logAnalyticsCostService.ts` | 381 | `LogAnalyticsRecommendation`, `LogAnalyticsWorkspaceRow`, `LogAnalyticsCostResult`, `getLogAnalyticsCost` |
| `src/modules/collectors/azure/resourceInventoryService.ts` | 368 | `InventoryResourceRow`, `SearchResourcesFilters`, `searchResources`, `getResourceCostsById`, `getInventoryDistribution`, `getCreatedByAggregation`, … |
| `src/modules/collectors/azure/billing/historicalBillingService.ts` | 353 | `getHistoricalDailyCosts`, `getHistoricalDetailedCosts` |
| `src/modules/collectors/azure/azureSearchCollector.ts` | 295 | `getAzureSearchResources`, `getAzureSearchRealCost`, `getAzureSearchMetrics`, `syncAzureSearchSnapshots` |
| `src/modules/collectors/azure/billing/mtdBillingService.ts` | 294 | `getCurrentMonthAmortizedCostsWithDiagnostics`, `getCurrentMonthAmortizedCosts` |
| `src/modules/collectors/azure/m365UsersService.ts` | 281 | `getUsersDetail`, `summarizeLicenses`, `getMfaAndAuthMethods`, `getGroups`, `getM365Overview`, `getUserActivity` |
| `src/modules/collectors/azure/billing/yesterdayBillingService.ts` | 266 | `getYesterdaysCost`, `getYesterdaysDetailedCosts` |
| `src/modules/storage/db.ts` | 260 | `initializeDatabase`, `insertCostSnapshot`, `insertCostSnapshotRow`, `insertAICostSnapshotRow`, `insertPlatformAiUsage`, `insertCostMeterSnapshotRow`, … |
| `src/modules/collectors/azure/docIntelCollector.ts` | 224 | `DocIntelResource`, `getDocIntelResources`, `getDocIntelRealCost`, `getDocIntelMetrics`, `syncDocIntelSnapshots` |
| `src/modules/collectors/azure/cosmosDbCostService.ts` | 223 | `CosmosDbAccountRow`, `CosmosDbCostResult`, `getCosmosDbCost` |
| `src/modules/collectors/azure/aroClusterService.ts` | 218 | `AroClusterDetail`, `calculateAroCostBreakdown`, `evaluateAroRemediations` |
| `src/modules/collectors/azure/aiUsageCollector.ts` | 211 | `PRICE_PER_1K`, `estimateCost`, `AIUsageRow`, `getHistoricalAIUsage`, `getYesterdaysAIUsage` |
| `src/modules/collectors/azure/foundryCollector.ts` | 188 | `getFoundryResourceCost`, `syncFoundrySnapshots` |
| `src/modules/collectors/azure/vmssRightsizingService.ts` | 185 | `VmssRightsizingRow`, `VmssRightsizingResult`, `getVmssRightsizingRecommendations` |
| `src/modules/collectors/azure/advisorCollector.ts` | 179 | `collectAdvisorData` |
| `src/modules/collectors/azure/sqlDbRightsizingService.ts` | 171 | `SqlDbRightsizingRow`, `SqlDbRightsizingResult`, `getSqlDbRightsizingRecommendations` |
| `src/modules/collectors/azure/billing/forecastBillingService.ts` | 170 | `getCostForecast` |
| `src/modules/storage/migrations.ts` | 165 | `MigrationResult`, `runMigrations`, `getMigrationsStatus` |
| `src/modules/collectors/azure/storageTieringService.ts` | 162 | `StorageTieringRow`, `StorageTieringResult`, `getStorageTieringRecommendations` |
| `src/modules/storage/recommendationExemptions.ts` | 152 | `RecommendationExemption`, `getExemptionsForTenant`, `upsertExemption`, `deleteExemption` |
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
