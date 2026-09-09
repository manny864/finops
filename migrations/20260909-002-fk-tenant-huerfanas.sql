-- Cierra el agujero por el que quedaban filas de tenants ya borrados.
--
-- `teardownTenant` no enumera tabla por tabla: borra `Tenants` y confía en que
-- la cascada limpie el resto. Es lo correcto, y funciona para las 57 tablas que
-- SÍ tienen la FK. Las otras 37 nunca la tuvieron, así que sus filas
-- sobrevivían al tenant. Medido en la base local: 3.527 filas de 7 tenants que
-- ya no existen, sobre todo 3.131 en `CostSnapshots`.
--
-- Va a la FK y no al servicio porque hay DOS caminos de borrado
-- (`teardownTenant` y el DELETE de `/api/tenants`), y sólo la restricción cubre
-- a los dos. Arreglar uno dejaba el otro dejando basura.
--
-- NO llevan FK, a propósito, las tablas cuyas filas tienen que sobrevivir al
-- tenant:
--   ActionLogs            la baja del entorno es justo lo que hay que poder
--                         auditar después (ya documentado en tenantTeardownService)
--   AuditTrailLogs        bitácora de acciones con usuario e IP
--   AuthAuditLogs         trazabilidad de accesos
--   TenantLifecycleEvents registra el CANCELED del propio tenant
--   LegalAcceptances      evidencia legal de aceptación de DPA/términos
--   DataResidencyChanges  registro de cumplimiento
--   MarketplaceEvents     webhooks crudos, llegan antes de que el tenant exista
--   PlatformAiUsage       gasto de IA que absorbe la plataforma, no el tenant
--
-- Las columnas hijas son varchar(36/64/100/128) contra el varchar(255) del
-- padre: MySQL no exige que coincida el largo, sólo el juego de caracteres y la
-- colación. La colación sí hay que igualarla a mano, ver más abajo.
--
-- `SavingsHistory` y `AICostSnapshots` ya tenían una FK a `Tenants` en la base
-- local, con nombre autogenerado (`*_ibfk_1`) y sin que ninguna migración la
-- declare. Se las incluye igual para que el esquema quede declarado en el
-- repositorio y no dependa de por dónde pasó cada base.

-- ORDEN: primero la colación, después el borrado, al final la FK.
--
-- El primer intento en producción murió en el primer DELETE con
-- ER_CANT_AGGREGATE_2COLLATIONS. Allá algunas tablas quedaron en
-- `utf8mb4_0900_ai_ci` --el default de MySQL 8-- mientras que `Tenants` está en
-- `utf8mb4_unicode_ci`. Comparar las dos columnas falla, y la FK tampoco se
-- podría crear: InnoDB exige la misma colación de los dos lados. En la base
-- local no se veía porque ahí el default del servidor ya es
-- `utf8mb4_unicode_ci`.
--
-- El segundo intento murió en ER_FK_COLUMN_CANNOT_CHANGE sobre `CostSnapshots`:
-- yo había sacado los largos de la base local y en producción esa columna es
-- varchar(255), no varchar(100). El MODIFY la habría encogido y truncado datos;
-- que MySQL lo rechazara por la FK existente fue suerte, no diseño.
--
-- Moraleja, y por qué esto ya no adivina: las definiciones de abajo están
-- MEDIDAS contra producción, no deducidas de la base local. Sólo llevan MODIFY
-- las tablas que de verdad están fuera de `utf8mb4_unicode_ci` (o que lo
-- estaban antes de que el intento fallido las convirtiera, para que la
-- migración siga sirviendo si se restaura un backup anterior). Las que ya
-- tienen una FK a `Tenants` no llevan MODIFY: si la FK existe, la colación ya
-- coincide, y encima MySQL rechaza el ALTER.
--
-- Los DELETE fuerzan la colación en la comparación, así que no dependen de que
-- el MODIFY haya corrido ni del estado de cada entorno.
--
-- En un entorno nuevo cuyo servidor tenga otro default, el ADD CONSTRAINT falla
-- en seco con ER_FK_INCOMPATIBLE_COLUMNS. Es lo correcto: no se puede normalizar
-- `Tenants` sin soltar sus 57 FK actuales, y eso es otro trabajo.

ALTER TABLE ApiQuotaSamples MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE BusinessMetrics MODIFY tenant_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE BusinessMetricsConfig MODIFY tenant_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE M365IndexLogs MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE MCPApiKeys MODIFY tenant_id VARCHAR(128) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE MarkupOverrideRules MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE UserCurrencyPreference MODIFY tenant_id VARCHAR(128) NOT NULL COLLATE utf8mb4_unicode_ci;

DELETE FROM ApiQuotaSamples WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM BusinessMetrics WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM BusinessMetricsConfig WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM CostSnapshots WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM CostTagSnapshots WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM CredentialAlertRules WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM DailySnapshots WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM DataPipelineEvents WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM HaExemptions WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM LocalResourceTagsCache WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM M365IndexLogs WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM MCPApiKeys WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM MarkupOverrideRules WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM MfaChallenges WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM NotificationChannels WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM NotificationLog WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM PowerSchedules WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM SSOSessions WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM SupportTicketAttachments WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM TenantExcludedSubscriptions WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM TenantSSO WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM TenantUnitEconomicsConfig WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM TenantUnitMetrics WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM UserCurrencyPreference WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM UserDashboardPins WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM ZombieExemptions WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM cost_snapshots WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM recommendation_exemptions WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM tenant_health WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM SavingsHistory WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM AICostSnapshots WHERE tenant_id IS NOT NULL AND tenant_id COLLATE utf8mb4_unicode_ci NOT IN (SELECT tenant_id FROM Tenants);

ALTER TABLE ApiQuotaSamples ADD CONSTRAINT fk_tenant_ApiQuotaSamples FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE BusinessMetrics ADD CONSTRAINT fk_tenant_BusinessMetrics FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE BusinessMetricsConfig ADD CONSTRAINT fk_tenant_BusinessMetricsConfig FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE CostSnapshots ADD CONSTRAINT fk_tenant_CostSnapshots FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE CostTagSnapshots ADD CONSTRAINT fk_tenant_CostTagSnapshots FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE CredentialAlertRules ADD CONSTRAINT fk_tenant_CredentialAlertRules FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE DailySnapshots ADD CONSTRAINT fk_tenant_DailySnapshots FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE DataPipelineEvents ADD CONSTRAINT fk_tenant_DataPipelineEvents FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE HaExemptions ADD CONSTRAINT fk_tenant_HaExemptions FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE LocalResourceTagsCache ADD CONSTRAINT fk_tenant_LocalResourceTagsCache FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE M365IndexLogs ADD CONSTRAINT fk_tenant_M365IndexLogs FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE MCPApiKeys ADD CONSTRAINT fk_tenant_MCPApiKeys FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE MarkupOverrideRules ADD CONSTRAINT fk_tenant_MarkupOverrideRules FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE MfaChallenges ADD CONSTRAINT fk_tenant_MfaChallenges FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE NotificationChannels ADD CONSTRAINT fk_tenant_NotificationChannels FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE NotificationLog ADD CONSTRAINT fk_tenant_NotificationLog FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE PowerSchedules ADD CONSTRAINT fk_tenant_PowerSchedules FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE SSOSessions ADD CONSTRAINT fk_tenant_SSOSessions FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE SupportTicketAttachments ADD CONSTRAINT fk_tenant_SupportTicketAttachments FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE TenantExcludedSubscriptions ADD CONSTRAINT fk_tenant_TenantExcludedSubscriptions FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE TenantSSO ADD CONSTRAINT fk_tenant_TenantSSO FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE TenantUnitEconomicsConfig ADD CONSTRAINT fk_tenant_TenantUnitEconomicsConfig FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE TenantUnitMetrics ADD CONSTRAINT fk_tenant_TenantUnitMetrics FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE UserCurrencyPreference ADD CONSTRAINT fk_tenant_UserCurrencyPreference FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE UserDashboardPins ADD CONSTRAINT fk_tenant_UserDashboardPins FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE ZombieExemptions ADD CONSTRAINT fk_tenant_ZombieExemptions FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE cost_snapshots ADD CONSTRAINT fk_tenant_cost_snapshots FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE recommendation_exemptions ADD CONSTRAINT fk_tenant_recommendation_exemptions FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE tenant_health ADD CONSTRAINT fk_tenant_tenant_health FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE SavingsHistory ADD CONSTRAINT fk_tenant_SavingsHistory FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
ALTER TABLE AICostSnapshots ADD CONSTRAINT fk_tenant_AICostSnapshots FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE;
