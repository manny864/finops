# SOP: Detección y Optimización de Licencias Azure Hybrid Benefit (AHUB)

## Objetivo
Implementar la política empresarial de Flexera "Azure Hybrid Benefit (AHUB) Optimization" en la plataforma FinOps. Esta regla identifica recursos de Azure (Máquinas Virtuales Windows y Bases de Datos SQL) que se ejecutan sin licencias de beneficio híbrido (pagando el precio completo de licencia por hora) y calcula el ahorro estimado (quick-win) equivalente al 40% del costo estándar.

## Lógica y Pasos

### 1. Catálogo KQL (`src/modules/core/kqlCatalog.ts`)
- Registrar las siguientes consultas KQL exactas:
  - `missingAhubWindowsVMs`: VMs del proveedor `microsoft.compute/virtualmachines` con sistema operativo Windows (`osType =~ 'Windows'`) donde el atributo `properties.licenseType` es nulo o no es igual a `Windows_Server`.
  - `missingAhubSql`: Databases SQL de tipo `microsoft.sql/servers/databases` (excluyendo la de sistema `master`) donde `properties.licenseType` es nulo o no es igual a `BasePrice`.

### 2. API de Licencias (`src/app/api/intelligence/licenses/route.ts`)
- Recuperar el `tenantId` desde las cabeceras.
- Realizar consultas concurrentes a Azure Resource Graph para obtener las listas de VMs y Bases de Datos SQL afectadas.
- Para cada recurso detectado:
  - Obtener el costo mensual estimado (vía `getMonthlyCostEstimate` o fallbacks realistas).
  - Calcular el ahorro potencial de licencia (`potentialLicenseSavings`) como el 40% del costo estándar del recurso.
  - Mapear a la estructura `{ resourceId, name, type, potentialLicenseSavings }` manteniendo otros metadatos (Grupo, Suscripción, Ubicación).
- Incorporar control defensivo en las consultas de Graph (M365) para que, en caso de fallar por falta de permisos o admin consent (403), el endpoint retorne las licencias M365 vacías pero siga respondiendo con éxito la lista de recursos Azure faltos de AHUB (`missingAhub`).

### 3. UI de Licencias (`src/app/[locale]/intelligence/licenses/page.tsx`)
- Modificar el frontend para que consulte el nuevo endpoint.
- Integrar una nueva sección/tarjeta con una tabla de "Recursos sin Azure Hybrid Benefit (AHUB)".
- Listar el nombre del recurso, tipo de recurso (VM / SQL DB), suscripción, y el potencial de ahorro formateado en dólares ($).
- Mostrar un badge destacado que avise al usuario del potencial ahorro mensual acumulado de AHUB.

## Restricciones y Trampas Conocidas
- **Manejo de Permisos Graph 403:** El token de Microsoft Entra puede no tener permisos para Graph API, devolviendo un error 403. La API debe atrapar este error de manera segura y retornar los datos de AHUB para no dejar la página en blanco con un cartel de error.
- **Ignorar Base de Datos master:** Las bases de datos `master` en Azure SQL son lógicas y gratuitas. Deben excluirse de las alertas KQL para no sobrecargar de falsos positivos la tabla.
