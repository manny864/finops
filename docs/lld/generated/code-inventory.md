# Capa de negocio: services y modules (generado)

> Generado por `scripts/generate-lld.mjs`. No editar a mano.

Ordenado por tamaño descendente: los archivos más largos son los candidatos
naturales a revisar primero cuando algo del dominio no cierra.

## src/services/

Un archivo por dominio funcional. Los llaman los route handlers, nunca la UI directamente.

160 archivos.

| Archivo | Líneas | Exports principales |
|---|---|---|
| `src/services/azureAiFoundry.service.ts` | 1270 | `getFoundryDetail` |
| `src/services/azureBasicNetworking.service.ts` | 1170 | `detectBasicNetworkEnvironment`, `fetchLiveBasicNetworkInventory`, `fetchBasicNetworkCosts`, `getMockBasicNetworkingResponse`, `computeLiveBasicNetworking` |
| `src/services/realConsumptionService.ts` | 1167 | `getServiceRemediationRule`, `getServiceIconName`, `getMockRealConsumptionOverview`, `DiscoveredTenantResource`, `TenantInventoryContext`, `mapResourceTypeToServiceName`, … |
| `src/services/azureAiSummary.service.ts` | 1138 | `getAzureAiSummary` |
| `src/services/azureKeyVault.service.ts` | 997 | `normalizeSku`, `deriveAuthModel`, `isDevOrTestScope`, `deriveAccessMethod`, `calcTransactionCost`, `calcHsmKeyCost`, … |
| `src/services/azureLogicApps.service.ts` | 899 | `generateMockLogicAppsData`, `calculateLogicAppsSummary`, `generateLogicAppsRecommendations`, `buildLogicAppsRemediationCommand`, `getLiveLogicAppsData` |
| `src/services/azureDdosProtection.service.ts` | 898 | `getAzureDdosProtection` |
| `src/services/categoryConsumptionService.ts` | 894 | `getCategoryColor`, `getCategoryIconName`, `mapServiceToCategory`, `getCategoryRemediationRule`, `getRealCategoryOverview`, `getMockCategoryOverview` |
| `src/services/azureResourcesInventory.service.ts` | 892 | `generateMockResourcesSearch`, `generateMockResourcesInventory`, `generateMockResourcesCreatedBy`, `generateMockResourcesCostsByTag`, `getResourceCostsById`, `attributeResourceCost`, … |
| `src/services/azureHybridConnectivity.service.ts` | 880 | `getAzureHybridConnectivity`, `getMockHybridConnectivityData` |
| `src/services/azureAlertsRules.service.ts` | 870 | `METRIC_ALERT_BASE_RATE`, `SCHEDULED_QUERY_RATE_1M`, `SCHEDULED_QUERY_RATE_5M`, `SCHEDULED_QUERY_RATE_1H`, `WEB_TEST_BASE_RATE`, `ACTIVITY_LOG_BASE_RATE`, … |
| `src/services/azureWorkbooks.service.ts` | 843 | `parseAutoRefreshSeconds`, `formatRefreshLabel`, `extractKqlTables`, `estimateQueryScanGB`, `derivePrimaryDataSource`, `ParsedWorkbookDefinition`, … |
| `src/services/azureAdvisor.service.ts` | 837 | `generateMockAdvisorData`, `deduplicateAndProcessRecommendations`, `getAdvisorExecutiveData` |
| `src/services/coinIndexService.ts` | 837 | `getCoinIndexSummary` |
| `src/services/azureEntraId.service.ts` | 821 | `daysSince`, `deriveActivityStatus`, `normalizeEdsSku`, `isDevOrTestScope`, `licenseUnitPrice`, `isAuditedEntraSku`, … |
| `src/services/azureActionGroups.service.ts` | 811 | `ACTION_TYPE_COLORS`, `redactReceiverUri`, `deriveActionType`, `calculateActionGroupsSummary`, `generateActionGroupsRecommendations`, `getMockActionGroupsPayload`, … |
| `src/services/azureLoadBalancing.service.ts` | 783 | `getAzureLoadBalancing`, `getMockLoadBalancingData` |
| `src/services/azureInternetAccess.service.ts` | 758 | `getAzureInternetAccess`, `getMockInternetAccessData` |
| `src/services/azureNetworkWatcher.service.ts` | 738 | `isDevOrTestScope`, `normalizeTrafficAnalyticsInterval`, `deriveFlowLogTargetKind`, `calcTrafficAnalyticsCost`, `processedGBAtInterval`, `calcConnectionMonitorCost`, … |
| `src/services/azureWaf.service.ts` | 715 | `normalizeHostPlatform`, `normalizeMode`, `isPublicIp`, `isGeoFilterRule`, `isRateLimitRule`, `looksProduction`, … |
| `src/services/azureHistoricalProgress.service.ts` | 709 | `getDaysForRange`, `estimateMonthlySavings`, `resolveRealizedCostDelta`, `generateMockHistoricalProgress`, `getLiveHistoricalProgress` |
| `src/services/azureMonitor.service.ts` | 702 | `LOG_SEARCH_DATA_RATE_PER_GB`, `METRIC_ALERT_BASE_RATE`, `LOG_SEARCH_EVAL_RATE_1M`, `LOG_SEARCH_EVAL_RATE_5M`, `WEB_TEST_BASE_RATE`, `ALERT_TYPE_COLORS`, … |
| `src/services/azureCostAllocation.service.ts` | 695 | `normalizeStrategy`, `deriveSharedResourceType`, `isValidResourceType`, `deriveAllocationStatus`, `validateTargets`, `calculateAllocation`, … |
| `src/services/executiveReportGenerator.service.ts` | 694 | `EXECUTIVE_HISTORY_MONTHS`, `HARD_WASTE_CONFIG`, `aggregateExecutiveTelemetry`, `EXECUTIVE_REPORT_SYSTEM_PROMPT`, `generateExecutiveReportAiMarkdown`, `buildExecutiveReportHtmlDocument`, … |
| `src/services/azureUnitEconomics.service.ts` | 691 | `isValidMetricType`, `normalizeMetricType`, `normalizeIngestionMode`, `calcUnitCost`, `percentDelta`, `pearsonCorrelation`, … |
| `src/services/billingReport.service.ts` | 656 | `MOCK_BILLING_LINES`, `MOCK_BILLING_DATA`, `getBillingReportData`, `generatePbidsConnector`, `serializeBillingCsv`, `generateBillingZipPackage`, … |
| `src/services/azureScorecard.service.ts` | 653 | `sanitizeTeamTag`, `toDisplayCase`, `normalizeTeamName`, `groupByCanonicalTeam`, `calcTagHygieneScore`, `calcWasteScore`, … |
| `src/services/affiliates.service.ts` | 652 | `EstadoComision`, `AfiliadoResuelto`, `ResultadoAtribucion`, `normalizarCodigo`, `calcularComision`, `buscarAfiliadoPorCodigo`, … |
| `src/services/azureDefender.service.ts` | 643 | `normalizePlanName`, `normalizeSubPlan`, `classifyEnvironment`, `dominantEnvironment`, `unitPriceFor`, `calcPlanMonthlyCost`, … |
| `src/services/azureLogAnalytics.service.ts` | 639 | `LAW_PAYG_RATE_PER_GB`, `LAW_FREE_RETENTION_DAYS`, `LAW_EXTENDED_RETENTION_RATE_PER_GB_MONTH`, `LAW_COMMITMENT_TIERS`, `LAW_TIER_COLORS`, `calculateLogAnalyticsSummary`, … |
| `src/services/azureSelfServiceAlerts.service.ts` | 620 | `formatAlertThreshold`, `getAlertPayloadI18n`, `computeAlertsSummaryMetrics`, `generateAlertTestPayloadPreview`, `testAlertRuleDelivery`, `getMockSelfServiceAlertsPayload`, … |
| `src/services/azureRemediationApprovals.service.ts` | 615 | `normalizeActionType`, `statusFromDb`, `statusToDb`, `toResourceTypeDisplay`, `isDestructive`, `requiresReboot`, … |
| `src/services/azureSentinelFinops.service.ts` | 604 | `SENTINEL_INGESTION_RATE_PER_GB`, `LAW_BASE_RATE_PER_GB`, `SENTINEL_CONSOLIDATED_RATE_PER_GB`, `DATA_ARCHIVE_RATE_PER_GB_MONTH`, `INTERACTIVE_RETENTION_RATE_PER_GB_MONTH`, `SENTINEL_COMMITMENT_TIERS`, … |
| `src/services/azureAiSearch.service.ts` | 596 | `getAiSearchPayload` |
| `src/services/executiveReportJob.service.ts` | 583 | `startExecutiveReportJob`, `getExecutiveReportJobStatus`, `getActiveExecutiveReportJob`, `getLatestCompletedReport` |
| `src/services/azureCredentialsExpiry.service.ts` | 582 | `toCredentialType`, `calcDaysRemaining`, `deriveStatus`, `formatExpiryDate`, `RawCredential`, `mapCredential`, … |
| `src/services/azureMaturity.service.ts` | 582 | `generateMockMaturityData`, `getLatestSelfAssessment`, `getMaturityScorePolicy`, `applySelfAssessment`, `getLiveMaturityData`, `getFinOpsMaturityAssessment`, … |
| `src/services/azureServiceBus.service.ts` | 574 | `SERVICEBUS_SKU_BASE_COST`, `SERVICEBUS_SKU_COLORS`, `calculateServiceBusSummary`, `generateServiceBusRecommendations`, `buildServiceBusRemediationCommand`, `generateMockServiceBusData`, … |
| `src/services/azureCapturedSavings.service.ts` | 567 | `AzureCapturedSavingsService` |
| `src/services/azureApim.service.ts` | 561 | `SKU_BASE_COST_MONTHLY`, `SKU_COLORS`, `calculateApimSummary`, `generateApimRecommendations`, `buildApimRemediationCommand`, `generateMockApimData`, … |
| `src/services/superAdminTenants.service.ts` | 549 | `ContractTerm`, `normalizeSoldAt`, `listAllTenantsForSuperAdmin`, `createManualTenant`, `updateTenantTierAndStatus`, `updateCommercialDeal`, … |
| `src/services/azureAutoBlockPolicies.service.ts` | 546 | `normalizeEffect`, `deriveScopeType`, `deriveScopeName`, `toCategoryDisplayName`, `calcCompliancePercentage`, `deriveInitiativeStatus`, … |
| `src/services/azureEventHubs.service.ts` | 544 | `EVENTHUBS_SKU_BASE_COST`, `EVENTHUBS_SKU_COLORS`, `calculateEventHubsSummary`, `generateEventHubsRecommendations`, `generateMockEventHubsData`, `fetchEventHubsData`, … |
| `src/services/azureVmPowerManagement.service.ts` | 543 | `RawScheduleRow`, `toDbAction`, `fromDbAction`, `fromDbStatus`, `parseDaysOfWeek`, `serializeDaysOfWeek`, … |
| `src/services/anomalyDetectionService.ts` | 530 | `DETECTION_WINDOW_DAYS`, `SENSITIVITY_Z_SCORE`, `DailyCost`, `DetectedAnomaly`, `AnomalyContributor`, `computeStats`, … |
| `src/services/azureGovernanceReporting.service.ts` | 528 | `toResourceTypeLabel`, `normalizePrincipalType`, `isOrphanedPrincipal`, `isPrivilegedRole`, `calcPercentage`, `buildResourceTypeBreakdown`, … |
| `src/services/azureTagGovernance.service.ts` | 522 | `DEFAULT_MANDATORY_TAG_POLICIES`, `formatResourceTypeDisplay`, `evaluateResourceMissingTags`, `getLocalCachedTags`, `saveLocalCachedTags`, `scanTagGovernanceLive`, … |
| `src/services/azureZombieHunting.service.ts` | 502 | `AzureZombieHuntingService` |
| `src/services/costExportIngestionService.ts` | 502 | `IngestionResult`, `splitCsvLine`, `parseExportTags`, `importeDeColumna`, `agruparPorEjecucion`, `ingestCostExportsForTenant` |
| `src/services/azureAppInsights.service.ts` | 496 | `APP_INSIGHTS_RATE_PER_GB`, `TELEMETRY_TYPE_COLORS`, `calculateAppInsightsSummary`, `generateAppInsightsRecommendations`, `generateMockAppInsightsData`, `fetchAppInsightsData`, … |
| `src/services/executiveReportHistory.service.ts` | 490 | `BLOB_CONTAINER_REPORTS`, `getTierRetentionDays`, `getTenantPlanTier`, `getExecutiveReportHistory`, `generateDownloadSas`, `rehydrateReportData`, … |
| `src/services/azureEventGrid.service.ts` | 486 | `EVENTGRID_SKU_COLORS`, `calculateEventGridSummary`, `generateEventGridRecommendations`, `buildEventGridRemediationCommand`, `generateMockEventGridData`, `getLiveEventGridData` |
| `src/services/azureTenantHealth.service.ts` | 485 | `scoreToGrade`, `calcBudgetComplianceScore`, `calcCredentialExpiryScore`, `calcCoinOptimizationScore`, `calcMfaSecurityScore`, `generateTenantHealthActionPlan`, … |
| `src/services/commissions.service.ts` | 471 | `TipoBeneficiario`, `EstadoComision`, `CUOTAS_MENSUALES`, `MESES_DE_RETENCION`, `sqlPrimerPagoDelTenant`, `sqlFechaDeVentaDelTenant`, … |
| `src/services/azureNetworkAnalytics.service.ts` | 470 | `fetchLiveNetworkInventory`, `fetchLiveNetworkCosts`, `computeLiveNetworkAnalytics` |
| `src/services/perspectivesData.service.ts` | 468 | `Perspectiva`, `etiquetasDeColumna`, `DIMENSIONES_DE_ALCANCE`, `FilaConDimensiones`, `comoFilaDeCosto`, `filasDeCosto`, … |
| `src/services/auditTrail.service.ts` | 464 | `getAuditTrailLogs`, `serializeAuditTrailCsv` |
| `src/services/azureZombieAudit.service.ts` | 452 | `formatResourceType`, `computeZombieSummaryMetrics`, `getMockZombieAuditPayload`, `getZombieExemptions`, `getLocalTagsCache`, `saveZombieExemption`, … |
| `src/services/azureDatabricks.service.ts` | 449 | `generateMockDatabricksData`, `calculateDatabricksSummary`, `generateDatabricksRecommendations`, `buildDatabricksRemediationCommand`, `getLiveDatabricksData` |
| `src/services/azureDocumentIntelligence.service.ts` | 446 | `getDocumentIntelligencePayload` |
| `src/services/budgetService.ts` | 445 | `calculateBudgetProjection`, `getDiscoveredCostCenterTags`, `fetchMtdCostForSub`, `getNativeBudgets`, `getBudgetConsumption`, `getBudgetCostCenterMonthlyHistory`, … |
| `src/services/azureNetworkingZombies.service.ts` | 437 | `formatNetworkZombieType`, `computeNetworkingZombiesSummary`, `getMockNetworkingZombiesPayload`, `assembleLiveNetworkingZombies` |
| `src/services/azureVisionVideo.service.ts` | 429 | `generateMockVisionVideoData`, `calculateVisionVideoSummary`, `generateVisionVideoRecommendations`, `buildVisionRemediationCommand`, `getLiveVisionVideoData` |
| `src/services/azureDataFactory.service.ts` | 418 | `ADF_CATEGORY_COLORS`, `calculateAdfSummary`, `generateAdfRecommendations`, `generateMockAdfData`, `fetchAdfData`, `buildAdfRemediationCommand` |
| `src/services/superAdminOperations.service.ts` | 416 | `getSaaSOperationsHealth`, `triggerCronJob`, `notifySuperAdmins` |
| `src/services/azureHighAvailability.service.ts` | 415 | `toIssueCategory`, `toSeverity`, `toResourceTypeDisplay`, `extractResourceGroup`, `extractSubscriptionId`, `extractLocation`, … |
| `src/services/azureMachineLearning.service.ts` | 410 | `generateMockAmlData`, `calculateAmlSummary`, `generateAmlRecommendations`, `buildAmlRemediationCommand`, `getLiveAmlData` |
| `src/services/managedDisks.service.ts` | 407 | `DISK_TIER_RATES`, `extractVmNameFromManagedBy`, `detectDiskRedundancy`, `detectDiskEnvironment`, `resolveDiskTierCode`, `estimateMonthlyDiskCost`, … |
| `src/services/azureContentSafety.service.ts` | 398 | `generateMockContentSafetyData`, `calculateContentSafetySummary`, `generateContentSafetyRecommendations`, `buildContentSafetyRemediationCommand`, `getLiveContentSafetyData` |
| `src/services/whiteboard.service.ts` | 396 | `CurrentMonthCostAggregation`, `readCostCenter`, `getCurrentMonthCostAggregation`, `extractReadableResourceName`, `extractSavings`, `buildQuickWinCliCommand`, … |
| `src/services/azureAnomalyDetection.service.ts` | 392 | `ANOMALY_Z_SCORE_THRESHOLD`, `DEFAULT_BASELINE_WINDOW_DAYS`, `computeZScoreStats`, `buildConfidenceTrend`, `buildAnomalySummary`, `getMockAnomalyPayload`, … |
| `src/services/supportTickets.service.ts` | 379 | `toCategory`, `toPriority`, `toStatus`, `toSenderRole`, `categoryToDb`, `priorityToDb`, … |
| `src/services/azureTtlEnforcement.service.ts` | 376 | `formatRelativeTime`, `formatDateIsoToLocal`, `computeTtlSummaryMetrics`, `getMockTtlSummaryMetrics`, `assembleLiveTtlSummary` |
| `src/services/affiliatePortal.service.ts` | 369 | `hashTokenDePanel`, `generarTokenDePanel`, `pareceTokenDePanel`, `urlDelPanel`, `emitirEnlaceDePanel`, `revocarEnlaceDePanel`, … |
| `src/services/reservationService.ts` | 367 | `ActiveReservationDetail`, `ReservationUtilizationTrend`, `parseReservationResourceId`, `getActiveReservations`, `getReservationUtilizationTrend`, `setReservationRenew`, … |
| `src/services/copilotM365Integration.service.ts` | 364 | `GraphPermissionError`, `getSettings`, `provisionConnection`, `reindex`, `revokeConnection`, `getIndexLogs` |
| `src/services/commitmentRecommendations.service.ts` | 362 | `CommitmentSimulationResponse`, `getSavingsPlanVsReservationComparison` |
| `src/services/azureBackups.service.ts` | 356 | `BACKUP_RATES`, `detectVaultEnvironment`, `normalizeRedundancy`, `estimateMonthlyVaultCost`, `buildBackupRemediations`, `computeBackupsKpis`, … |
| `src/services/powerScheduleService.ts` | 347 | `PowerScheduleAction`, `PowerScheduleInput`, `PowerScheduleRow`, `upsertPowerSchedule`, `listPowerSchedules`, `deletePowerSchedule`, … |
| `src/services/azureMaccTracking.service.ts` | 339 | `computeMaccStatus`, `generateMaccPacingTrend`, `simulateMaccRenegotiation`, `getMockMaccPayload`, `assembleLiveMaccTracking` |
| `src/services/tenantNotifications.service.ts` | 331 | `getTenantNotifications`, `markNotificationAsRead`, `deleteNotification` |
| `src/services/aiService.ts` | 327 | `isAiGloballyEnabled`, `AI_FEATURE_SETTING_PREFIX`, `getAiFeatureSwitch`, `getAIConfig`, `generateFinOpsReport` |
| `src/services/perspectives.service.ts` | 323 | `TipoRegla`, `ReglaPerspectiva`, `FilaDeCosto`, `MotivoSinGrupo`, `GrupoDelReparto`, `RepartoPerspectiva`, … |
| `src/services/publicApiKey.service.ts` | 320 | `hashPublicApiKey`, `generatePublicApiKeyToken`, `maskPublicApiKey`, `listPublicApiKeys`, `createPublicApiKey`, `revokePublicApiKey`, … |
| `src/services/superAdminPartnerCenter.service.ts` | 317 | `getPartnerCenterStatus`, `relinkPartner`, `configurePartnerMpn` |
| `src/services/payoutRuns.service.ts` | 315 | `EstadoCorrida`, `LineaDeCorrida`, `Corrida`, `referenciaDeLinea`, `previsualizarCorrida`, `crearCorrida`, … |
| `src/services/loadTesting.service.ts` | 314 | `getLoadTestHistory`, `getSystemPerformanceAlerts`, `executeLoadTest`, `acknowledgePerformanceAlert`, `resolvePerformanceAlert` |
| `src/services/superAdminFunnel.service.ts` | 311 | `getSignupFunnelAnalytics` |
| `src/services/paddlePrices.service.ts` | 307 | `PlanPrices`, `PlanPricesResult`, `ModulePrices`, `ModulePricesResult`, `parsePaddleUnitPrice`, `clearPaddlePriceCache`, … |
| `src/services/azureOrphanBackups.service.ts` | 305 | `calculateBackupMonthlyCost`, `computeOrphanBackupsMetrics`, `getMockOrphanBackupsSummary`, `scanLiveOrphanBackups` |
| `src/services/saasBilling.service.ts` | 303 | `getTenantBillingDetails`, `getCustomerPortalUrl`, `cancelTenantSubscription` |
| `src/services/azureDataLakeGen2.service.ts` | 301 | `ADLS_RATES`, `detectDataLakeRedundancy`, `detectDataLakeEnvironment`, `buildDataLakeRemediations`, `computeDataLakeKpis`, `aggregateDataLakeStorage`, … |
| `src/services/m365UserActivity.service.ts` | 301 | `getEnrichedUserActivity`, `getUserSignInHistory` |
| `src/services/anomalyExplanation.service.ts` | 298 | `ExplanationLocale`, `normalizeExplanationLocale`, `ExplainableAnomaly`, `ExplanationContext`, `buildExplanationContext`, `explanationFactsHash`, … |
| `src/services/azureWhatIfSimulator.service.ts` | 297 | `simulateScenario`, `getMockWhatIfPayload`, `assembleLiveWhatIf` |
| `src/services/azureSustainability.service.ts` | 293 | `AzureSustainabilityService` |
| `src/services/cosmosMetrics.service.ts` | 288 | `MetricasCosmos`, `ParticionCosmos`, `VENTANA_DIAS`, `metricasVacias`, `percentil95`, `leerSeries`, … |
| `src/services/superAdminAiConfig.service.ts` | 276 | `getPlatformGlobalAiSettings`, `savePlatformGlobalAiSettings`, `deletePlatformAiApiKey`, `testPlatformAiConnection` |
| `src/services/iacCostEstimator.service.ts` | 270 | `AccionPlan`, `RecursoPlaneado`, `LineaEstimacion`, `Estimacion`, `skuDeDisco`, `accionDe`, … |
| `src/services/systemAnnouncements.service.ts` | 270 | `resolveAnnouncementContent`, `listAnnouncements`, `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `getActiveAnnouncementsForTenant`, … |
| `src/services/azureLicenseOptimization.service.ts` | 266 | `getLicenseOptimizationData` |
| `src/services/tenantUsers.service.ts` | 264 | `toRole`, `roleToDb`, `toAccountStatus`, `modulesToRoleTags`, `roleTagsToModules`, `parseModules`, … |
| `src/services/azureTopSpend.service.ts` | 261 | `TopSpendTimeframe`, `generateMockTopSpend`, `getLiveTopSpend` |
| `src/services/haService.ts` | 259 | `HASeverity`, `HAItem`, `HAEvalResult`, `evaluateHALive` |
| `src/services/mcpApiKey.service.ts` | 257 | `hashMcpKey`, `generateSecureMcpToken`, `maskMcpKey`, `listMcpKeys`, `createMcpKey`, `revokeMcpKey`, … |
| `src/services/billingCsvMapping.service.ts` | 248 | `CsvColumnMapping`, `CsvMappingError`, `csvCurrency`, `validateCsvMapping`, `decimalSeparatorOf`, `parseCsvAmount`, … |
| `src/services/cosmosOptimizer.service.ts` | 245 | `RU_MINIMO`, `TARIFAS_LISTA`, `TarifasCosmos`, `EntradaOptimizacion`, `ClaveDecision`, `Decision`, … |
| `src/services/tagInheritanceService.ts` | 243 | `MissingTagsRow`, `ApplyOp`, `ApplyResult`, `describeArmError`, `analyzeMissingTags`, `applyTagInheritance` |
| `src/services/sessionImpersonation.service.ts` | 241 | `IMPERSONATION_COOKIE_NAME`, `CookieOptions`, `getImpersonationCookieOptions`, `encodeSessionData`, `decodeSessionData`, `startImpersonation`, … |
| `src/services/tenantAccountStatus.service.ts` | 240 | `getSubscriptionRollup`, `getAccountStatus` |
| `src/services/tenantAddons.service.ts` | 236 | `ActiveTenantAddon`, `TenantAddonsService` |
| `src/services/remediationService.ts` | 234 | `logAction`, `deleteResource`, `deallocateVirtualMachine`, `startVirtualMachine`, `restartVirtualMachine`, `downgradeVirtualMachine` |
| `src/services/storageRetentionCleaner.service.ts` | 234 | `BLOB_CONTAINER_REPORTS`, `TIER_RETENTION_DAYS`, `getRetentionDaysForTier`, `executeStorageRetentionCleanup` |
| `src/services/azureLighthouse.service.ts` | 230 | `LIGHTHOUSE_DELEGATIONS_KQL`, `toDelegationStatus`, `toDelegationStatusFromDb`, `roleNamesFromAuthorizations`, `RawArgDelegationRow`, `mapArgDelegation`, … |
| `src/services/azureStorageAccounts.service.ts` | 226 | `TIER_RATES`, `BENCHMARK_LRS_RATE`, `detectRedundancyType`, `detectEnvironment`, `generateLifecyclePolicyJson`, `buildStorageRemediations` |
| `src/services/invoicingAggregationService.ts` | 215 | `MarkupOverride`, `buildInvoicingPayload` |
| `src/services/clientOnboarding.service.ts` | 213 | `RawTenantRow`, `parseSubscriptionIds`, `deriveOnboardingStatus`, `mapClientEnvironment`, `buildOnboardingSummary`, `RawSubReport`, … |
| `src/services/reportRenderers.service.ts` | 209 | `AlcanceDelReporte`, `ReporteGenerado`, `Periodo`, `periodosDelReporte`, `Contexto`, `Generador`, … |
| `src/services/tenantConfiguration.service.ts` | 208 | `POWERBI_FEED_PATH`, `getPowerBiExportUrl`, `getTenantConfiguration`, `isMaturityScorePolicy`, `saveMaturityScorePolicy`, `saveThemePreference`, … |
| `src/services/user2fa.service.ts` | 198 | `toMethod`, `deviceLabelFromUserAgent`, `RawAuthAuditRow`, `mapAuditEvent`, `RawWebAuthnRow`, `mapSecurityKey`, … |
| `src/services/pricingService.ts` | 197 | `precioMensualDesdeUnidad`, `elegirMedidor`, `getMonthlyCostEstimate`, `getRetailPricing` |
| `src/services/pricingUnitsNormalizer.service.ts` | 194 | `SEED_CATALOG_ITEMS`, `getPricingUnitsCatalog`, `testNormalization`, `reseedPricingUnitsCatalog` |
| `src/services/leaderboard.service.ts` | 191 | `UMBRAL_MATERIALIDAD_PCT`, `Clasificacion`, `EntradaDeGrupo`, `MotivoSinRanking`, `FilaDelRanking`, `Leaderboard`, … |
| `src/services/governanceReportingService.ts` | 185 | `PolicyComplianceDetail`, `GovernanceReport`, `getGovernanceReport` |
| `src/services/tenantLifecycle.service.ts` | 181 | `LifecycleEventType`, `CancellationReason`, `LifecycleTransitionOptions`, `recordTenantLifecycleTransition`, `TenantLifecycleEvent`, `getTenantLifecycleHistory` |
| `src/services/costGroupDetailMetricsService.ts` | 175 | `getCurrentFY`, `getMonthlyCostTrend`, `getAnomalyCount`, `getPeriodComparison`, `getTopBreakdown` |
| `src/services/tenantPartnerMarkup.service.ts` | 173 | `SIMULATION_BASE_COST`, `getMarkupSettings`, `saveMarkupSettings`, `listOverrideRules`, `getActiveOverrides`, `createOverrideRule`, … |
| `src/services/networkEgress.service.ts` | 172 | `CategoriaEgress`, `FlujoEgress`, `MapaEgress`, `CLASIFICACION`, `SE_COBRA_POR_GB`, `getMapaEgress` |
| `src/services/lighthouseVerification.service.ts` | 169 | `verificarDelegacion` |
| `src/services/globalSearch.service.ts` | 167 | `SearchResultKind`, `SearchResult`, `GlobalSearchResponse`, `searchTenantContent` |
| `src/services/snapshotService.ts` | 167 | `SNAPSHOT_RETENTION_DAYS`, `SNAPSHOT_DOMAINS`, `SnapshotDomain`, `SnapshotPoint`, `recordDailySnapshot`, `recordDailySnapshotAsync`, … |
| `src/services/credentialExpiryService.ts` | 159 | `CredItem`, `severityFor`, `getGraphTokenForTenant`, `fetchAllApplications`, `extractExpiringCreds`, `getExpiringCredentials`, … |
| `src/services/tenantSso.service.ts` | 158 | `isValidDomain`, `normalizeDomain`, `isValidWorkosOrgId`, `isValidWorkosConnectionId`, `toIdpProvider`, `toJitRole`, … |
| `src/services/pdfCompiler.service.ts` | 154 | `compileExecutiveReportPdfBuffer`, `compileHtmlToPdfBuffer` |
| `src/services/commitmentRisk.service.ts` | 149 | `ReservaConCosto`, `VencimientoDelMes`, `ConcentracionVencimientos`, `concentracionDeVencimientos` |
| `src/services/rateService.ts` | 146 | `RateRecommendation`, `calculateReservationSavings` |
| `src/services/anomalyOwnerResolver.ts` | 144 | `AssignmentVia`, `OwnerResolution`, `ContributorLike`, `resolveAnomalyOwner` |
| `src/services/ttlService.ts` | 137 | `TTL_RESOURCE_TYPES`, `TtlResourceType`, `findExpiredResources`, `getUnlabeledResources` |
| `src/services/advisorRemediationNarration.ts` | 129 | `narrateAdvisorRecommendations` |
| `src/services/auditService.ts` | 126 | `runGraphAudits`, `runMonitorAudits`, `runM365Audits` |
| `src/services/reportSubscriptions.service.ts` | 124 | `Frecuencia`, `Suscripcion`, `FechaLocal`, `enZona`, `diasDelMes`, `diaEfectivoDelMes`, … |
| `src/services/savingsRate.service.ts` | 113 | `TasaEfectivaAhorro`, `AgregadoAhorro`, `tasaEfectivaDeAhorro`, `tasaDeAhorroDelTenant` |
| `src/services/carbonService.ts` | 111 | `regionIntensity`, `calculateEmissions`, `calculateDiskEmissions`, `calculateStorageEmissions`, `emissionsEquivalencies`, `MigrationRecommendation`, … |
| `src/services/reservationExpiryAlerts.service.ts` | 108 | `ESCALONES`, `Escalon`, `AvisoDeVencimiento`, `diasHastaVencer`, `escalonPara`, `avisosDeVencimiento`, … |
| `src/services/workbookService.ts` | 107 | `deployFinOpsWorkbook` |
| `src/services/userScope.service.ts` | 105 | `AlcanceAsignado`, `ROLES_SIN_ALCANCE`, `alcanceDelUsuario`, `listarAlcances`, `rolDelUsuario`, `asignarAlcance`, … |
| `src/services/anomalyRootCause.service.ts` | 98 | `MAX_CONTRIBUTORS`, `MeterRow`, `buildRootCauseFacts` |
| `src/services/azureCommitmentSimulator.service.ts` | 96 | `ExchangeQuotaResult`, `AzureCommitmentSimulatorService` |
| `src/services/reportDispatch.service.ts` | 96 | `SuscripcionAEnviar`, `ResultadoEnvio`, `enviarSuscripcion` |
| `src/services/providerLifecycleService.ts` | 90 | `TenantProviderState`, `getTenantProviderState`, `TierChangeResult`, `applyTierChange`, `ProviderDisabledError`, `assertProviderIngestable` |
| `src/services/tenantHealthService.ts` | 83 | `verifyTenantCredentials` |
| `src/services/rightsizingAggregator.service.ts` | 81 | `RightsizingItem`, `AggregatedRightsizingResult`, `getRealRightsizingRecommendations` |
| `src/services/tagComplianceService.ts` | 81 | `TagComplianceResult`, `getRealTagCompliance` |
| `src/services/commitmentCoverageService.ts` | 70 | `CommitmentsCoverageResult`, `getRealCommitmentsCoverage` |
| `src/services/tenantTeardownService.ts` | 70 | `teardownTenant` |
| `src/services/networkCostService.ts` | 62 | `getNetworkEgressCosts` |
| `src/services/platformUptime.service.ts` | 57 | `Uptime30d`, `getUptime30d` |
| `src/services/costTagSync.service.ts` | 51 | `ALWAYS_TRACKED_TAG_KEY`, `MAX_TAG_KEYS_PER_RUN`, `getTagKeysToFetch`, `hasRecentExportTagData` |
| `src/services/allocationService.ts` | 42 | `CostEntry`, `AllocationRule`, `calculateChargeback` |
| `src/services/commitmentSimulatorService.ts` | 11 | — |

## src/modules/

Integración con SDKs de Azure (`collectors/`), motores agnósticos (`core/`) y persistencia (`storage/`).

36 archivos.

| Archivo | Líneas | Exports principales |
|---|---|---|
| `src/modules/collectors/azure/avdService.ts` | 701 | `AvdSessionHost`, `AvdApplicationGroup`, `AvdWorkspace`, `AvdHostPool`, `AvdStorageResource`, `AvdInventory`, … |
| `src/modules/core/aiProvider.ts` | 659 | `invalidateAIConfigCache`, `redactForDataSharing`, `getDataSharingPrefs`, `redactForTenant`, `redactSerializedForTenant`, `aiQueue`, … |
| `src/modules/collectors/azure/foundryCollector.ts` | 578 | `getFoundryResourceCost`, `FoundryMeterUsage`, `FoundryModelAgg`, `parseFoundryMeter`, `normalizeFoundryModelName`, `aggregateFoundryMeters`, … |
| `src/modules/collectors/azure/containerAppsCostService.ts` | 479 | `ContainerAppCostRow`, `ContainerRegistryCostRow`, `ContainerEnvironmentCostRow`, `ContainerAppsCostResult`, `getContainerAppsCost` |
| `src/modules/collectors/azure/aiServiceCollectors.ts` | 439 | `getAiServiceRealCost`, `getSpeechLanguageResources`, `syncSpeechLanguageSnapshots`, `getVisionVideoResources`, `syncVisionVideoSnapshots`, `getContentSafetyResources`, … |
| `src/modules/collectors/azure/billing/yesterdayBillingService.ts` | 413 | `getYesterdaysCost`, `getYesterdaysDetailedCosts`, `getYesterdaysTagCosts` |
| `src/modules/collectors/azure/azureSearchCollector.ts` | 401 | `getAzureSearchResources`, `getAzureSearchRealCost`, `getAzureSearchMetrics`, `syncAzureSearchSnapshots` |
| `src/modules/collectors/azure/billing/historicalBillingService.ts` | 400 | `getHistoricalDailyCosts`, `getHistoricalDetailedCosts` |
| `src/modules/collectors/azure/resourceInventoryService.ts` | 398 | `InventoryResourceRow`, `SearchResourcesFilters`, `searchResources`, `getResourceCostsById`, `getInventoryDistribution`, `getCreatedByAggregation`, … |
| `src/modules/collectors/azure/aksCostService.ts` | 391 | `vmSizeToCores`, `vmSizeToMemoryGB`, `VmArchitecture`, `detectVmArchitecture`, `extractVmGeneration`, `getAksChargebackCost` |
| `src/modules/collectors/azure/billing/mtdBillingService.ts` | 372 | `getCurrentMonthAmortizedCostsWithDiagnostics`, `getCurrentMonthAmortizedCosts` |
| `src/modules/storage/db.ts` | 353 | `DB_POOL_LIMIT`, `DB_QUEUE_LIMIT`, `initializeDatabase`, `insertCostSnapshot`, `insertCostSnapshotRow`, `insertAICostSnapshotRow`, … |
| `src/modules/collectors/azure/m365UsersService.ts` | 288 | `graphToken`, `graphGetAll`, `getUsersDetail`, `summarizeLicenses`, `getMfaAndAuthMethods`, `getGroups`, … |
| `src/modules/collectors/azure/billing/billingHelpers.ts` | 268 | `throwIfAborted`, `sleep`, `extractRetryAfterMs`, `is429`, `CacheEntry`, `COST_CACHE`, … |
| `src/modules/collectors/azure/aiUsageCollector.ts` | 252 | `PRICE_PER_1K`, `estimateCost`, `AIUsageRow`, `getHistoricalAIUsage`, `getYesterdaysAIUsage` |
| `src/modules/collectors/azure/avdUsageService.ts` | 234 | `MotivoSinUso`, `AvdUsoHostPool`, `getWorkspaceDeHostPool`, `getCustomerIdDeWorkspace`, `filasDeRespuestaLA`, `resumirUso`, … |
| `src/modules/collectors/azure/billing/forecastBillingService.ts` | 223 | `getCostForecast` |
| `src/modules/collectors/azure/cosmosDbCostService.ts` | 223 | `CosmosDbAccountRow`, `CosmosDbCostResult`, `getCosmosDbCost` |
| `src/modules/collectors/azure/docIntelCollector.ts` | 223 | `DocIntelResource`, `getDocIntelResources`, `getDocIntelRealCost`, `getDocIntelMetrics`, `syncDocIntelSnapshots` |
| `src/modules/collectors/azure/aroClusterService.ts` | 221 | `AroClusterDetail`, `calculateAroCostBreakdown`, `evaluateAroRemediations` |
| `src/modules/collectors/azure/vmssRightsizingService.ts` | 185 | `VmssRightsizingRow`, `VmssRightsizingResult`, `getVmssRightsizingRecommendations` |
| `src/modules/collectors/azure/advisorCollector.ts` | 171 | `collectAdvisorData` |
| `src/modules/collectors/azure/sqlDbRightsizingService.ts` | 171 | `SqlDbRightsizingRow`, `SqlDbRightsizingResult`, `getSqlDbRightsizingRecommendations` |
| `src/modules/storage/migrations.ts` | 166 | `MigrationResult`, `runMigrations`, `getMigrationsStatus` |
| `src/modules/collectors/azure/storageTieringService.ts` | 162 | `StorageTieringRow`, `StorageTieringResult`, `getStorageTieringRecommendations` |
| `src/modules/storage/recommendationExemptions.ts` | 152 | `RecommendationExemption`, `getExemptionsForTenant`, `upsertExemption`, `deleteExemption` |
| `src/modules/collectors/azure/defenderCostService.ts` | 143 | `DefenderPlanRow`, `DefenderCostResult`, `getDefenderCost`, `setDefenderPlanTier` |
| `src/modules/core/rightsizingEngine.ts` | 127 | `RightsizingAction`, `analyzeVmEfficiency` |
| `src/modules/collectors/azure/miscServicesCostService.ts` | 118 | `MISC_SERVICE_TYPES`, `MiscServiceCostRow`, `MiscServicesCostResult`, `getMiscServicesCost` |
| `src/modules/core/kqlCatalog.ts` | 106 | `kqlCatalog` |
| `src/modules/core/focusMapper.ts` | 83 | `FocusCostEntry`, `mapAzureToFocus`, `mapCsvToFocus` |
| `src/modules/collectors/azure/metricsService.ts` | 68 | `getVmUtilization` |
| `src/modules/storage/regionPool.ts` | 60 | `getTenantPool`, `resolveTenantPool` |
| `src/modules/collectors/azure/billing/billingTypes.ts` | 46 | `CostQueryDiagnostics`, `DetailedCostRow`, `HistoricalDetailedCostRow`, `AZURE_COST_HISTORY_MAX_MONTHS`, `TagCostRow` |
| `src/modules/collectors/azure/billing/index.ts` | 7 | — |
| `src/modules/collectors/azure/billingService.ts` | 7 | — |
