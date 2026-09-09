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
-- ER_CANT_AGGREGATE_2COLLATIONS: allá las tablas creadas por migraciones
-- sueltas quedaron en `utf8mb4_0900_ai_ci` --el default de MySQL 8-- mientras
-- que `Tenants` está en `utf8mb4_unicode_ci`. Comparar las dos columnas falla, y
-- la FK ni siquiera se puede crear: InnoDB exige la misma colación en los dos
-- lados. En la base local no se veía porque el default del servidor es
-- `utf8mb4_unicode_ci` y ahí coincide todo.
--
-- Por eso el MODIFY va primero: normaliza, y si algo sale mal no se borró nada
-- todavía. Se conserva el largo y la nulabilidad de cada columna; lo único que
-- cambia es la colación. Sobre una columna que ya tiene FK el MODIFY es
-- inocuo cuando la colación ya coincide (probado).
--
-- El objetivo es `utf8mb4_unicode_ci` porque es lo que usa `Tenants` en
-- producción y en local. Una base nueva creada en un servidor cuyo default sea
-- `utf8mb4_0900_ai_ci` tendría `Tenants` en esa colación y esta migración
-- fallaría al crear la FK: no se puede normalizar la tabla padre sin soltar sus
-- 57 FK actuales (ER_FK_INCOMPATIBLE_COLUMNS). Falla ruidosa y en seco, que es
-- lo correcto; arreglarlo es otro trabajo.


ALTER TABLE ApiQuotaSamples MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE BusinessMetrics MODIFY tenant_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE BusinessMetricsConfig MODIFY tenant_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE CostSnapshots MODIFY tenant_id VARCHAR(100) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE CostTagSnapshots MODIFY tenant_id VARCHAR(100) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE CredentialAlertRules MODIFY tenant_id VARCHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE DailySnapshots MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE DataPipelineEvents MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE HaExemptions MODIFY tenant_id VARCHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE LocalResourceTagsCache MODIFY tenant_id VARCHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE M365IndexLogs MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE MCPApiKeys MODIFY tenant_id VARCHAR(128) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE MarkupOverrideRules MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE MfaChallenges MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE NotificationChannels MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE NotificationLog MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE PowerSchedules MODIFY tenant_id VARCHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE SSOSessions MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE SupportTicketAttachments MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE TenantExcludedSubscriptions MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE TenantSSO MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE TenantUnitEconomicsConfig MODIFY tenant_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE TenantUnitMetrics MODIFY tenant_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE UserCurrencyPreference MODIFY tenant_id VARCHAR(128) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE UserDashboardPins MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE ZombieExemptions MODIFY tenant_id VARCHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE cost_snapshots MODIFY tenant_id VARCHAR(255) NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE recommendation_exemptions MODIFY tenant_id VARCHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE tenant_health MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE SavingsHistory MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;
ALTER TABLE AICostSnapshots MODIFY tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci;

DELETE FROM ApiQuotaSamples WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM BusinessMetrics WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM BusinessMetricsConfig WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM CostSnapshots WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM CostTagSnapshots WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM CredentialAlertRules WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM DailySnapshots WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM DataPipelineEvents WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM HaExemptions WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM LocalResourceTagsCache WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM M365IndexLogs WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM MCPApiKeys WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM MarkupOverrideRules WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM MfaChallenges WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM NotificationChannels WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM NotificationLog WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM PowerSchedules WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM SSOSessions WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM SupportTicketAttachments WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM TenantExcludedSubscriptions WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM TenantSSO WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM TenantUnitEconomicsConfig WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM TenantUnitMetrics WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM UserCurrencyPreference WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM UserDashboardPins WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM ZombieExemptions WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM cost_snapshots WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM recommendation_exemptions WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM tenant_health WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM SavingsHistory WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);
DELETE FROM AICostSnapshots WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT tenant_id FROM Tenants);

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
