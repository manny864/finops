# Capa de negocio: services y modules (generado)

> Generado por `scripts/generate-lld.mjs`. No editar a mano.

Ordenado por tamaño descendente: los archivos más largos son los candidatos
naturales a revisar primero cuando algo del dominio no cierra.

## src/services/

Un archivo por dominio funcional. Los llaman los route handlers, nunca la UI directamente.

118 archivos.

| Archivo | Líneas | Exports principales |
|---|---|---|
| `src/services/azureBasicNetworking.service.ts` | 1181 | `detectBasicNetworkEnvironment`, `fetchLiveBasicNetworkInventory`, `fetchBasicNetworkCosts`, `getMockBasicNetworkingResponse`, `computeLiveBasicNetworking` |
| `src/services/azureAiSummary.service.ts` | 1116 | `getAzureAiSummary` |
| `src/services/realConsumptionService.ts` | 1075 | `getServiceRemediationRule`, `getServiceIconName`, `getMockRealConsumptionOverview`, `DiscoveredTenantResource`, `TenantInventoryContext`, `mapResourceTypeToServiceName`, … |
| `src/services/azureKeyVault.service.ts` | 997 | `normalizeSku`, `deriveAuthModel`, `isDevOrTestScope`, `deriveAccessMethod`, `calcTransactionCost`, `calcHsmKeyCost`, … |
| `src/services/categoryConsumptionService.ts` | 910 | `getCategoryColor`, `getCategoryIconName`, `mapServiceToCategory`, `getCategoryRemediationRule`, `getRealCategoryOverview`, `getMockCategoryOverview` |
| `src/services/azureHybridConnectivity.service.ts` | 889 | `getAzureHybridConnectivity`, `getMockHybridConnectivityData` |
| `src/services/azureDdosProtection.service.ts` | 885 | `getAzureDdosProtection` |
| `src/services/azureAiFoundry.service.ts` | 868 | `getFoundryDetail` |
| `src/services/azureWorkbooks.service.ts` | 844 | `parseAutoRefreshSeconds`, `formatRefreshLabel`, `extractKqlTables`, `estimateQueryScanGB`, `derivePrimaryDataSource`, `ParsedWorkbookDefinition`, … |
| `src/services/azureActionGroups.service.ts` | 815 | `ACTION_TYPE_COLORS`, `redactReceiverUri`, `deriveActionType`, `calculateActionGroupsSummary`, `generateActionGroupsRecommendations`, `getMockActionGroupsPayload`, … |
| `src/services/azureEntraId.service.ts` | 808 | `daysSince`, `deriveActivityStatus`, `normalizeEdsSku`, `isDevOrTestScope`, `licenseUnitPrice`, `isAuditedEntraSku`, … |
| `src/services/azureResourcesInventory.service.ts` | 806 | `generateMockResourcesSearch`, `generateMockResourcesInventory`, `generateMockResourcesCreatedBy`, `generateMockResourcesCostsByTag`, `getResourceCostsById`, `searchLiveResources`, … |
| `src/services/azureLoadBalancing.service.ts` | 797 | `getAzureLoadBalancing`, `getMockLoadBalancingData` |
| `src/services/azureAlertsRules.service.ts` | 787 | `METRIC_ALERT_BASE_RATE`, `SCHEDULED_QUERY_RATE_1M`, `SCHEDULED_QUERY_RATE_5M`, `SCHEDULED_QUERY_RATE_1H`, `WEB_TEST_BASE_RATE`, `ACTIVITY_LOG_BASE_RATE`, … |
| `src/services/azureInternetAccess.service.ts` | 774 | `getAzureInternetAccess`, `getMockInternetAccessData` |
| `src/services/azureAdvisor.service.ts` | 751 | `generateMockAdvisorData`, `deduplicateAndProcessRecommendations`, `getAdvisorExecutiveData` |
| `src/services/azureNetworkWatcher.service.ts` | 742 | `isDevOrTestScope`, `normalizeTrafficAnalyticsInterval`, `deriveFlowLogTargetKind`, `calcTrafficAnalyticsCost`, `processedGBAtInterval`, `calcConnectionMonitorCost`, … |
| `src/services/azureWaf.service.ts` | 718 | `normalizeHostPlatform`, `normalizeMode`, `isPublicIp`, `isGeoFilterRule`, `isRateLimitRule`, `looksProduction`, … |
| `src/services/azureMonitor.service.ts` | 711 | `LOG_SEARCH_DATA_RATE_PER_GB`, `METRIC_ALERT_BASE_RATE`, `LOG_SEARCH_EVAL_RATE_1M`, `LOG_SEARCH_EVAL_RATE_5M`, `WEB_TEST_BASE_RATE`, `ALERT_TYPE_COLORS`, … |
| `src/services/azureCostAllocation.service.ts` | 699 | `normalizeStrategy`, `deriveSharedResourceType`, `isValidResourceType`, `deriveAllocationStatus`, `validateTargets`, `calculateAllocation`, … |
| `src/services/azureUnitEconomics.service.ts` | 698 | `isValidMetricType`, `normalizeMetricType`, `normalizeIngestionMode`, `calcUnitCost`, `percentDelta`, `pearsonCorrelation`, … |
| `src/services/azureLogAnalytics.service.ts` | 648 | `LAW_PAYG_RATE_PER_GB`, `LAW_FREE_RETENTION_DAYS`, `LAW_EXTENDED_RETENTION_RATE_PER_GB_MONTH`, `LAW_COMMITMENT_TIERS`, `LAW_TIER_COLORS`, `calculateLogAnalyticsSummary`, … |
| `src/services/azureDefender.service.ts` | 643 | `normalizePlanName`, `normalizeSubPlan`, `classifyEnvironment`, `dominantEnvironment`, `unitPriceFor`, `calcPlanMonthlyCost`, … |
| `src/services/azureScorecard.service.ts` | 633 | `sanitizeTeamTag`, `toDisplayCase`, `normalizeTeamName`, `groupByCanonicalTeam`, `calcTagHygieneScore`, `calcWasteScore`, … |
| `src/services/azureAiSearch.service.ts` | 624 | `getAiSearchPayload` |
| `src/services/azureRemediationApprovals.service.ts` | 612 | `normalizeActionType`, `statusFromDb`, `statusToDb`, `toResourceTypeDisplay`, `isDestructive`, `requiresReboot`, … |
| `src/services/azureSentinelFinops.service.ts` | 611 | `SENTINEL_INGESTION_RATE_PER_GB`, `LAW_BASE_RATE_PER_GB`, `SENTINEL_CONSOLIDATED_RATE_PER_GB`, `DATA_ARCHIVE_RATE_PER_GB_MONTH`, `INTERACTIVE_RETENTION_RATE_PER_GB_MONTH`, `SENTINEL_COMMITMENT_TIERS`, … |
| `src/services/azureServiceBus.service.ts` | 582 | `SERVICEBUS_SKU_BASE_COST`, `SERVICEBUS_SKU_COLORS`, `calculateServiceBusSummary`, `generateServiceBusRecommendations`, `buildServiceBusRemediationCommand`, `generateMockServiceBusData`, … |
| `src/services/azureHistoricalProgress.service.ts` | 580 | `getDaysForRange`, `estimateMonthlySavings`, `generateMockHistoricalProgress`, `getLiveHistoricalProgress` |
| `src/services/executiveReportJob.service.ts` | 579 | `startExecutiveReportJob`, `getExecutiveReportJobStatus`, `getActiveExecutiveReportJob`, `getLatestCompletedReport` |
| `src/services/azureApim.service.ts` | 558 | `SKU_BASE_COST_MONTHLY`, `SKU_COLORS`, `calculateApimSummary`, `generateApimRecommendations`, `buildApimRemediationCommand`, `generateMockApimData`, … |
| `src/services/azureEventHubs.service.ts` | 546 | `EVENTHUBS_SKU_BASE_COST`, `EVENTHUBS_SKU_COLORS`, `calculateEventHubsSummary`, `generateEventHubsRecommendations`, `generateMockEventHubsData`, `fetchEventHubsData`, … |
| `src/services/azureVmPowerManagement.service.ts` | 543 | `RawScheduleRow`, `toDbAction`, `fromDbAction`, `fromDbStatus`, `parseDaysOfWeek`, `serializeDaysOfWeek`, … |
| `src/services/azureAutoBlockPolicies.service.ts` | 532 | `normalizeEffect`, `deriveScopeType`, `deriveScopeName`, `toCategoryDisplayName`, `calcCompliancePercentage`, `deriveInitiativeStatus`, … |
| `src/services/azureGovernanceReporting.service.ts` | 529 | `toResourceTypeLabel`, `normalizePrincipalType`, `isOrphanedPrincipal`, `isPrivilegedRole`, `calcPercentage`, `buildResourceTypeBreakdown`, … |
| `src/services/billingReport.service.ts` | 527 | `MOCK_BILLING_LINES`, `MOCK_BILLING_DATA`, `getBillingReportData`, `generatePbidsConnector`, `serializeBillingCsv`, `generateBillingZipPackage`, … |
| `src/services/azureTagGovernance.service.ts` | 522 | `DEFAULT_MANDATORY_TAG_POLICIES`, `formatResourceTypeDisplay`, `evaluateResourceMissingTags`, `getLocalCachedTags`, `saveLocalCachedTags`, `scanTagGovernanceLive`, … |
| `src/services/azureZombieHunting.service.ts` | 503 | `AzureZombieHuntingService` |
| `src/services/azureAppInsights.service.ts` | 496 | `APP_INSIGHTS_RATE_PER_GB`, `TELEMETRY_TYPE_COLORS`, `calculateAppInsightsSummary`, `generateAppInsightsRecommendations`, `generateMockAppInsightsData`, `fetchAppInsightsData`, … |
| `src/services/azureEventGrid.service.ts` | 490 | `EVENTGRID_SKU_COLORS`, `calculateEventGridSummary`, `generateEventGridRecommendations`, `buildEventGridRemediationCommand`, `generateMockEventGridData`, `getLiveEventGridData` |
| `src/services/executiveReportHistory.service.ts` | 490 | `BLOB_CONTAINER_REPORTS`, `getTierRetentionDays`, `getTenantPlanTier`, `getExecutiveReportHistory`, `generateDownloadSas`, `rehydrateReportData`, … |
| `src/services/azureNetworkAnalytics.service.ts` | 473 | `fetchLiveNetworkInventory`, `fetchLiveNetworkCosts`, `computeLiveNetworkAnalytics` |
| `src/services/azureCredentialsExpiry.service.ts` | 464 | `toCredentialType`, `calcDaysRemaining`, `deriveStatus`, `formatExpiryDate`, `RawCredential`, `mapCredential`, … |
| `src/services/azureTenantHealth.service.ts` | 458 | `scoreToGrade`, `calcBudgetComplianceScore`, `calcCredentialExpiryScore`, `calcCoinOptimizationScore`, `calcMfaSecurityScore`, `generateTenantHealthActionPlan`, … |
| `src/services/azureLogicApps.service.ts` | 455 | `generateMockLogicAppsData`, `calculateLogicAppsSummary`, `generateLogicAppsRecommendations`, `buildLogicAppsRemediationCommand`, `getLiveLogicAppsData` |
| `src/services/azureZombieAudit.service.ts` | 452 | `formatResourceType`, `computeZombieSummaryMetrics`, `getMockZombieAuditPayload`, `getZombieExemptions`, `getLocalTagsCache`, `saveZombieExemption`, … |
| `src/services/azureDatabricks.service.ts` | 451 | `generateMockDatabricksData`, `calculateDatabricksSummary`, `generateDatabricksRecommendations`, `buildDatabricksRemediationCommand`, `getLiveDatabricksData` |
| `src/services/azureDocumentIntelligence.service.ts` | 447 | `getDocumentIntelligencePayload` |
| `src/services/executiveReportGenerator.service.ts` | 447 | `EXECUTIVE_HISTORY_MONTHS`, `HARD_WASTE_CONFIG`, `aggregateExecutiveTelemetry`, `EXECUTIVE_REPORT_SYSTEM_PROMPT`, `generateExecutiveReportAiMarkdown`, `buildExecutiveReportHtmlDocument`, … |
| `src/services/budgetService.ts` | 435 | `calculateBudgetProjection`, `getDiscoveredCostCenterTags`, `getNativeBudgets`, `getBudgetConsumption`, `getBudgetCostCenterMonthlyHistory`, `createSubscriptionBudget`, … |
| `src/services/azureVisionVideo.service.ts` | 434 | `generateMockVisionVideoData`, `calculateVisionVideoSummary`, `generateVisionVideoRecommendations`, `buildVisionRemediationCommand`, `getLiveVisionVideoData` |
| `src/services/superAdminOperations.service.ts` | 432 | `getSaaSOperationsHealth`, `triggerCronJob`, `notifySuperAdmins` |
| `src/services/auditTrail.service.ts` | 430 | `getAuditTrailLogs`, `serializeAuditTrailCsv` |
| `src/services/azureNetworkingZombies.service.ts` | 423 | `formatNetworkZombieType`, `computeNetworkingZombiesSummary`, `getMockNetworkingZombiesPayload`, `assembleLiveNetworkingZombies` |
| `src/services/azureDataFactory.service.ts` | 422 | `ADF_CATEGORY_COLORS`, `calculateAdfSummary`, `generateAdfRecommendations`, `generateMockAdfData`, `fetchAdfData`, `buildAdfRemediationCommand` |
| `src/services/azureMachineLearning.service.ts` | 415 | `generateMockAmlData`, `calculateAmlSummary`, `generateAmlRecommendations`, `buildAmlRemediationCommand`, `getLiveAmlData` |
| `src/services/azureHighAvailability.service.ts` | 412 | `toIssueCategory`, `toSeverity`, `toResourceTypeDisplay`, `extractResourceGroup`, `extractSubscriptionId`, `extractLocation`, … |
| `src/services/managedDisks.service.ts` | 404 | `DISK_TIER_RATES`, `extractVmNameFromManagedBy`, `detectDiskRedundancy`, `detectDiskEnvironment`, `resolveDiskTierCode`, `estimateMonthlyDiskCost`, … |
| `src/services/azureContentSafety.service.ts` | 398 | `generateMockContentSafetyData`, `calculateContentSafetySummary`, `generateContentSafetyRecommendations`, `buildContentSafetyRemediationCommand`, `getLiveContentSafetyData` |
| `src/services/azureMaturity.service.ts` | 387 | `generateMockMaturityData`, `getLiveMaturityData`, `getFinOpsMaturityAssessment`, `recalculateMaturityWithAssessment` |
| `src/services/azureSelfServiceAlerts.service.ts` | 380 | `formatAlertThreshold`, `computeAlertsSummaryMetrics`, `generateAlertTestPayloadPreview`, `testAlertRuleDelivery`, `getMockSelfServiceAlertsPayload`, `assembleLiveSelfServiceAlerts` |
| `src/services/supportTickets.service.ts` | 379 | `toCategory`, `toPriority`, `toStatus`, `toSenderRole`, `categoryToDb`, `priorityToDb`, … |
| `src/services/anomalyDetectionService.ts` | 376 | `DETECTION_WINDOW_DAYS`, `SENSITIVITY_Z_SCORE`, `DailyCost`, `DetectedAnomaly`, `AnomalyContributor`, `computeStats`, … |
| `src/services/copilotM365Integration.service.ts` | 364 | `GraphPermissionError`, `getSettings`, `provisionConnection`, `reindex`, `revokeConnection`, `getIndexLogs` |
| `src/services/azureTtlEnforcement.service.ts` | 361 | `formatRelativeTime`, `formatDateIsoToLocal`, `computeTtlSummaryMetrics`, `getMockTtlSummaryMetrics`, `assembleLiveTtlSummary` |
| `src/services/azureBackups.service.ts` | 352 | `BACKUP_RATES`, `detectVaultEnvironment`, `normalizeRedundancy`, `estimateMonthlyVaultCost`, `buildBackupRemediations`, `computeBackupsKpis`, … |
| `src/services/reservationService.ts` | 349 | `ActiveReservationDetail`, `ReservationUtilizationTrend`, `parseReservationResourceId`, `getActiveReservations`, `getReservationUtilizationTrend`, `setReservationRenew`, … |
| `src/services/coinIndexService.ts` | 348 | `getCoinIndexSummary` |
| `src/services/superAdminTenants.service.ts` | 348 | `listAllTenantsForSuperAdmin`, `createManualTenant`, `updateTenantTierAndStatus`, `updateCommercialDeal`, `generatePaddleCheckoutLink` |
| `src/services/azureMaccTracking.service.ts` | 339 | `computeMaccStatus`, `generateMaccPacingTrend`, `simulateMaccRenegotiation`, `getMockMaccPayload`, `assembleLiveMaccTracking` |
| `src/services/whiteboard.service.ts` | 335 | `CurrentMonthCostAggregation`, `readCostCenter`, `getCurrentMonthCostAggregation`, `extractReadableResourceName`, `extractSavings`, `buildQuickWinCliCommand`, … |
| `src/services/powerScheduleService.ts` | 322 | `PowerScheduleAction`, `PowerScheduleInput`, `PowerScheduleRow`, `upsertPowerSchedule`, `listPowerSchedules`, `deletePowerSchedule`, … |
| `src/services/publicApiKey.service.ts` | 320 | `hashPublicApiKey`, `generatePublicApiKeyToken`, `maskPublicApiKey`, `listPublicApiKeys`, `createPublicApiKey`, `revokePublicApiKey`, … |
| `src/services/azureAnomalyDetection.service.ts` | 319 | `ANOMALY_Z_SCORE_THRESHOLD`, `DEFAULT_BASELINE_WINDOW_DAYS`, `computeZScoreStats`, `buildConfidenceTrend`, `buildAnomalySummary`, `getMockAnomalyPayload`, … |
| `src/services/azureOrphanBackups.service.ts` | 311 | `calculateBackupMonthlyCost`, `computeOrphanBackupsMetrics`, `getMockOrphanBackupsSummary`, `scanLiveOrphanBackups` |
| `src/services/superAdminFunnel.service.ts` | 311 | `getSignupFunnelAnalytics` |
| `src/services/azureDataLakeGen2.service.ts` | 297 | `ADLS_RATES`, `detectDataLakeRedundancy`, `detectDataLakeEnvironment`, `buildDataLakeRemediations`, `computeDataLakeKpis`, `aggregateDataLakeStorage`, … |
| `src/services/azureSustainability.service.ts` | 294 | `AzureSustainabilityService` |
| `src/services/azureWhatIfSimulator.service.ts` | 294 | `simulateScenario`, `getMockWhatIfPayload`, `assembleLiveWhatIf` |
| `src/services/m365UserActivity.service.ts` | 277 | `getEnrichedUserActivity`, `getUserSignInHistory` |
| `src/services/azureLicenseOptimization.service.ts` | 266 | `getLicenseOptimizationData` |
| `src/services/tenantUsers.service.ts` | 264 | `toRole`, `roleToDb`, `toAccountStatus`, `modulesToRoleTags`, `roleTagsToModules`, `parseModules`, … |
| `src/services/azureTopSpend.service.ts` | 261 | `TopSpendTimeframe`, `generateMockTopSpend`, `getLiveTopSpend` |
| `src/services/haService.ts` | 259 | `HASeverity`, `HAItem`, `HAEvalResult`, `evaluateHALive` |
| `src/services/mcpApiKey.service.ts` | 257 | `hashMcpKey`, `generateSecureMcpToken`, `maskMcpKey`, `listMcpKeys`, `createMcpKey`, `revokeMcpKey`, … |
| `src/services/saasBilling.service.ts` | 246 | `getTenantBillingDetails`, `getCustomerPortalUrl`, `cancelTenantSubscription` |
| `src/services/azureCapturedSavings.service.ts` | 243 | `AzureCapturedSavingsService` |
| `src/services/azureStorageAccounts.service.ts` | 241 | `TIER_RATES`, `BENCHMARK_LRS_RATE`, `detectRedundancyType`, `detectEnvironment`, `generateLifecyclePolicyJson`, `buildStorageRemediations` |
| `src/services/invoicingAggregationService.ts` | 215 | `MarkupOverride`, `buildInvoicingPayload` |
| `src/services/clientOnboarding.service.ts` | 213 | `RawTenantRow`, `parseSubscriptionIds`, `deriveOnboardingStatus`, `mapClientEnvironment`, `buildOnboardingSummary`, `RawSubReport`, … |
| `src/services/aiService.ts` | 208 | `isAiGloballyEnabled`, `getAIConfig`, `generateFinOpsReport` |
| `src/services/azureLighthouse.service.ts` | 204 | `LIGHTHOUSE_DELEGATIONS_KQL`, `toDelegationStatus`, `toDelegationStatusFromDb`, `roleNamesFromAuthorizations`, `RawArgDelegationRow`, `mapArgDelegation`, … |
| `src/services/user2fa.service.ts` | 198 | `toMethod`, `deviceLabelFromUserAgent`, `RawAuthAuditRow`, `mapAuditEvent`, `RawWebAuthnRow`, `mapSecurityKey`, … |
| `src/services/tagInheritanceService.ts` | 187 | `MissingTagsRow`, `ApplyOp`, `ApplyResult`, `analyzeMissingTags`, `applyTagInheritance` |
| `src/services/governanceReportingService.ts` | 185 | `PolicyComplianceDetail`, `GovernanceReport`, `getGovernanceReport` |
| `src/services/tenantConfiguration.service.ts` | 183 | `POWERBI_FEED_PATH`, `getPowerBiExportUrl`, `getTenantConfiguration`, `saveThemePreference`, `saveItsmConfiguration`, `getItsmCredentials` |
| `src/services/remediationService.ts` | 181 | `logAction`, `deleteResource`, `deallocateVirtualMachine`, `startVirtualMachine`, `restartVirtualMachine`, `downgradeVirtualMachine` |
| `src/services/tenantPartnerMarkup.service.ts` | 173 | `SIMULATION_BASE_COST`, `getMarkupSettings`, `saveMarkupSettings`, `listOverrideRules`, `getActiveOverrides`, `createOverrideRule`, … |
| `src/services/costGroupDetailMetricsService.ts` | 168 | `getCurrentFY`, `getMonthlyCostTrend`, `getAnomalyCount`, `getPeriodComparison`, `getTopBreakdown` |
| `src/services/snapshotService.ts` | 167 | `SNAPSHOT_RETENTION_DAYS`, `SNAPSHOT_DOMAINS`, `SnapshotDomain`, `SnapshotPoint`, `recordDailySnapshot`, `recordDailySnapshotAsync`, … |
| `src/services/credentialExpiryService.ts` | 159 | `CredItem`, `severityFor`, `getGraphTokenForTenant`, `fetchAllApplications`, `extractExpiringCreds`, `getExpiringCredentials`, … |
| `src/services/tenantSso.service.ts` | 158 | `isValidDomain`, `normalizeDomain`, `isValidWorkosOrgId`, `isValidWorkosConnectionId`, `toIdpProvider`, `toJitRole`, … |
| `src/services/licenseService.ts` | 154 | `LicenseSku`, `InactiveUser`, `getTenantLicensesAndInactiveUsers` |
| `src/services/pdfCompiler.service.ts` | 154 | `compileExecutiveReportPdfBuffer`, `compileHtmlToPdfBuffer` |
| `src/services/auditService.ts` | 147 | `runGraphAudits`, `runMonitorAudits`, `runM365Audits` |
| `src/services/ttlService.ts` | 137 | `TTL_RESOURCE_TYPES`, `TtlResourceType`, `findExpiredResources`, `getUnlabeledResources` |
| `src/services/commitmentSimulatorService.ts` | 131 | `CommitmentSimulation`, `getCommitmentSimulation` |
| `src/services/tenantAccountStatus.service.ts` | 131 | `getAccountStatus` |
| `src/services/rateService.ts` | 126 | `calculateReservationSavings` |
| `src/services/costExportIngestionService.ts` | 120 | `IngestionResult`, `ingestCostExportsForTenant` |
| `src/services/carbonService.ts` | 111 | `regionIntensity`, `calculateEmissions`, `calculateDiskEmissions`, `calculateStorageEmissions`, `emissionsEquivalencies`, `MigrationRecommendation`, … |
| `src/services/workbookService.ts` | 107 | `deployFinOpsWorkbook` |
| `src/services/pricingService.ts` | 104 | `getMonthlyCostEstimate`, `getRetailPricing` |
| `src/services/providerLifecycleService.ts` | 90 | `TenantProviderState`, `getTenantProviderState`, `TierChangeResult`, `applyTierChange`, `ProviderDisabledError`, `assertProviderIngestable` |
| `src/services/tenantHealthService.ts` | 83 | `verifyTenantCredentials` |
| `src/services/tenantTeardownService.ts` | 70 | `teardownTenant` |
| `src/services/networkCostService.ts` | 62 | `getNetworkEgressCosts` |
| `src/services/allocationService.ts` | 42 | `CostEntry`, `AllocationRule`, `calculateChargeback` |

## src/modules/

Integración con SDKs de Azure (`collectors/`), motores agnósticos (`core/`) y persistencia (`storage/`).

42 archivos.

| Archivo | Líneas | Exports principales |
|---|---|---|
| `src/modules/core/aiProvider.ts` | 678 | `invalidateAIConfigCache`, `redactForDataSharing`, `getDataSharingPrefs`, `redactForTenant`, `redactSerializedForTenant`, `aiQueue`, … |
| `src/modules/collectors/azure/containerAppsCostService.ts` | 479 | `ContainerAppCostRow`, `ContainerRegistryCostRow`, `ContainerEnvironmentCostRow`, `ContainerAppsCostResult`, `getContainerAppsCost` |
| `src/modules/collectors/azure/aiServiceCollectors.ts` | 397 | `getAiServiceRealCost`, `getSpeechLanguageResources`, `syncSpeechLanguageSnapshots`, `getVisionVideoResources`, `syncVisionVideoSnapshots`, `getContentSafetyResources`, … |
| `src/modules/collectors/azure/aksCostService.ts` | 391 | `vmSizeToCores`, `vmSizeToMemoryGB`, `VmArchitecture`, `detectVmArchitecture`, `extractVmGeneration`, `getAksChargebackCost` |
| `src/modules/collectors/azure/logAnalyticsCostService.ts` | 382 | `LogAnalyticsRecommendation`, `LogAnalyticsWorkspaceRow`, `LogAnalyticsCostResult`, `getLogAnalyticsCost` |
| `src/modules/collectors/azure/billing/historicalBillingService.ts` | 372 | `getHistoricalDailyCosts`, `getHistoricalDetailedCosts` |
| `src/modules/collectors/azure/resourceInventoryService.ts` | 369 | `InventoryResourceRow`, `SearchResourcesFilters`, `searchResources`, `getResourceCostsById`, `getInventoryDistribution`, `getCreatedByAggregation`, … |
| `src/modules/collectors/azure/billing/mtdBillingService.ts` | 300 | `getCurrentMonthAmortizedCostsWithDiagnostics`, `getCurrentMonthAmortizedCosts` |
| `src/modules/collectors/azure/azureSearchCollector.ts` | 296 | `getAzureSearchResources`, `getAzureSearchRealCost`, `getAzureSearchMetrics`, `syncAzureSearchSnapshots` |
| `src/modules/collectors/azure/m365UsersService.ts` | 288 | `graphToken`, `graphGetAll`, `getUsersDetail`, `summarizeLicenses`, `getMfaAndAuthMethods`, `getGroups`, … |
| `src/modules/collectors/azure/billing/yesterdayBillingService.ts` | 282 | `getYesterdaysCost`, `getYesterdaysDetailedCosts` |
| `src/modules/storage/db.ts` | 260 | `initializeDatabase`, `insertCostSnapshot`, `insertCostSnapshotRow`, `insertAICostSnapshotRow`, `insertPlatformAiUsage`, `insertCostMeterSnapshotRow`, … |
| `src/modules/collectors/azure/docIntelCollector.ts` | 224 | `DocIntelResource`, `getDocIntelResources`, `getDocIntelRealCost`, `getDocIntelMetrics`, `syncDocIntelSnapshots` |
| `src/modules/collectors/azure/cosmosDbCostService.ts` | 223 | `CosmosDbAccountRow`, `CosmosDbCostResult`, `getCosmosDbCost` |
| `src/modules/collectors/azure/aroClusterService.ts` | 217 | `AroClusterDetail`, `calculateAroCostBreakdown`, `evaluateAroRemediations` |
| `src/modules/collectors/azure/aiUsageCollector.ts` | 212 | `PRICE_PER_1K`, `estimateCost`, `AIUsageRow`, `getHistoricalAIUsage`, `getYesterdaysAIUsage` |
| `src/modules/collectors/azure/foundryCollector.ts` | 188 | `getFoundryResourceCost`, `syncFoundrySnapshots` |
| `src/modules/collectors/azure/vmssRightsizingService.ts` | 185 | `VmssRightsizingRow`, `VmssRightsizingResult`, `getVmssRightsizingRecommendations` |
| `src/modules/collectors/azure/advisorCollector.ts` | 179 | `collectAdvisorData` |
| `src/modules/collectors/azure/billing/forecastBillingService.ts` | 174 | `getCostForecast` |
| `src/modules/collectors/azure/billing/billingHelpers.ts` | 173 | `throwIfAborted`, `sleep`, `extractRetryAfterMs`, `is429`, `CacheEntry`, `COST_CACHE`, … |
| `src/modules/collectors/azure/sqlDbRightsizingService.ts` | 171 | `SqlDbRightsizingRow`, `SqlDbRightsizingResult`, `getSqlDbRightsizingRecommendations` |
| `src/modules/storage/migrations.ts` | 165 | `MigrationResult`, `runMigrations`, `getMigrationsStatus` |
| `src/modules/collectors/azure/storageTieringService.ts` | 162 | `StorageTieringRow`, `StorageTieringResult`, `getStorageTieringRecommendations` |
| `src/modules/storage/recommendationExemptions.ts` | 152 | `RecommendationExemption`, `getExemptionsForTenant`, `upsertExemption`, `deleteExemption` |
| `src/modules/collectors/azure/backupOrphanService.ts` | 145 | `OrphanedBackupItemRow`, `BackupOrphanResult`, `getOrphanedBackupItems` |
| `src/modules/collectors/azure/defenderCostService.ts` | 143 | `DefenderPlanRow`, `DefenderCostResult`, `getDefenderCost`, `setDefenderPlanTier` |
| `src/modules/collectors/azure/appInsightsCostService.ts` | 135 | `AppInsightsCostRow`, `AppInsightsCostResult`, `getAppInsightsCost` |
| `src/modules/collectors/azure/perimeterNetworkCostService.ts` | 121 | `PerimeterCostRow`, `PerimeterCostResult`, `getPerimeterNetworkCost` |
| `src/modules/collectors/azure/miscServicesCostService.ts` | 116 | `MISC_SERVICE_TYPES`, `MiscServiceCostRow`, `MiscServicesCostResult`, `getMiscServicesCost` |
| `src/modules/core/kqlCatalog.ts` | 100 | `kqlCatalog` |
| `src/modules/core/focusMapper.ts` | 83 | `FocusCostEntry`, `mapAzureToFocus`, `mapCsvToFocus` |
| `src/modules/core/rightsizingEngine.ts` | 80 | `analyzeVmEfficiency` |
| `src/modules/collectors/azure/metricsService.ts` | 68 | `getVmUtilization` |
| `src/modules/storage/regionPool.ts` | 60 | `getTenantPool`, `resolveTenantPool` |
| `src/modules/storage/tenantBudget.service.ts` | 55 | `TenantBudget`, `upsertTenantBudget`, `getTenantBudgetByPeriod` |
| `src/modules/collectors/azureProvider.ts` | 51 | `AzureProvider` |
| `src/modules/collectors/azure/billing/billingTypes.ts` | 36 | `CostQueryDiagnostics`, `DetailedCostRow`, `HistoricalDetailedCostRow`, `AZURE_COST_HISTORY_MAX_MONTHS` |
| `src/modules/collectors/providerFactory.ts` | 16 | `getCloudProvider` |
| `src/modules/collectors/types.ts` | 11 | `DateRange`, `CloudProvider` |
| `src/modules/collectors/azure/billing/index.ts` | 7 | — |
| `src/modules/collectors/azure/billingService.ts` | 7 | — |
