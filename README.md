# FinOps Azure App - CSCloudSolutions

Esta aplicación es un MVP (Minimum Viable Product) multi-tenant diseñado para el análisis, la detección de oportunidades de ahorro y la remediación automatizada de costos en Microsoft Azure.

## Arquitectura de Fase 1 (Base Operativa)
- **Framework Core:** Next.js 16.x (App Router) con soporte híbrido de Server/Client Components.
- **Motor Backend Azure:** Endpoints REST robustos utilizando `@azure/identity`, `@azure/arm-compute`, y `@azure/arm-network` para detectar recursos zombies en la nube (Discos desasociados e IPs no asignadas).
- **Frontend Interactivo:** Estilizado mediante Tailwind CSS v4, inyectando la identidad corporativa de CSCloudSolutions. Cuenta con un layout dinámico SPA, mockups de autenticación listos para MSAL (Entra ID) y vistas reservadas para iFrames de Power BI.
- **Contenerización:** Configuración `standalone` y `Dockerfile` multi-stage preparados para un despliegue optimizado.

## Instalación y Ejecución
1. Instalar dependencias: `npm install`
2. Ejecutar entorno local: `npm run dev`

*Arquitectura estructurada de forma autónoma siguiendo directivas deterministas.*

## Entra ID App Registration (Manual Setup)
To authenticate users across different organizations, you need to configure the identity provider to generate the clientId for the MSAL configuration. 

- **Create Registration:** Navigate to Microsoft Entra ID > App registrations > New registration.
- **Account Type:** Select *Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)*. This is mandatory for the multi-tenant architecture.
- **Redirect URI:** Select *Single-page application (SPA)* from the platform dropdown and set the URL to `http://localhost:3000`.
- **API Permissions:** Add the required delegated permissions. For the core FinOps analysis, you need access to the Azure Service Management API (`user_impersonation`) and Microsoft Graph (`User.Read`).
- **Admin Consent:** Crucially, execute the admin consent flow to grant these permissions globally across your testing tenant.

## Arquitectura de Fase 3 (Base de Datos & MSAL Onboarding)
- **MySQL & Docker**: Implementación de base de datos local `finops_app` orquestada mediante Docker Compose y el pool de conexiones `mysql2`. Contiene las tablas de persistencia `Tenants` y `Users` entrelazadas por restricciones de clave foránea.
- **Zero-Trust JWT Isolation**: Endpoints backend altamente securizados que decodifican el Identity Token Bearer mediante `jsonwebtoken`. Verifican matemáticamente que el `tid` (Tenant ID) solicitado en la URL concuerde estrictamente con la firma criptográfica proveniente de Microsoft Entra ID.
- **Azure Key Vault**: Extracción dinámica de los secretos del cliente para instanciar el Service Principal multi-tenant de forma segura utilizando `@azure/keyvault-secrets`.
- **MSAL Autenticación y Registro**: Autenticación nativa integrada en Next.js App Router con `@azure/msal-react` (`loginRedirect`). Al retornar, intercepta el payload para enviar el `idToken` al endpoint local, el cual inserta a los nuevos Tenants atómicamente (`INSERT ON DUPLICATE KEY UPDATE`) en la base de datos MySQL.

## Arquitectura de Fases 12-13 (Auditoría Omni-Scan KQL y Motor de Remediación)
- **Motor Omni-Scan (KQL):** Integración de `@azure/arm-resourcegraph` para ejecutar consultas KQL masivas en paralelo (batching dinámico) a través del tenant, detectando hasta 25 tipos de fugas financieras (desde Snapshots Antiguos hasta VNet Gateways sin uso).
- **Remediación Automatizada:** SDKs de Azure (`@azure/arm-compute`, `@azure/arm-network`, etc.) cableados para permitir el borrado o la actualización de recursos en un solo clic.
- **Gestión de Roles Estricta:** El sistema valida dinámicamente si el usuario actual posee rol de `Contributor` o `Owner` sobre la suscripción antes de habilitar el botón de remediación.
- **Fallback Multi-Tenant:** Si las suscripciones cruzadas fallan (por deshabilitación de CSP), el sistema hace un fallback local silencioso usando las credenciales en caché.

## Arquitectura de Fases 14-16 (Gobernanza de Etiquetas, Dashboard SPA y UI Corporativa)
- **Layout SPA & Navegación Optimizada:** Refactor completo del `ClientShell` para comportarse como una Single Page Application (SPA), inyectando componentes de Dashboard, Auditoría, y Etiquetas instantáneamente usando el Contexto de React.
- **Gestión de Etiquetas (Tagging Governance):** Nuevo módulo impulsado por MySQL (`TaggingPolicies`). El backend compara en tiempo real el catálogo entero de Azure Graph contra las reglas obligatorias de negocio (ej. *CostCenter*, *Environment*) y devuelve un *Compliance Score* y las infracciones exactas.
- **Dashboard Analítico:** Gráfico de Pastel Interactivo (`Recharts`) que dibuja el ecosistema financiero. Al interactuar con el gráfico, inyecta un filtro estricto cruzado a la tabla inferior de recursos.
- **Corporate Landing Page:** Un escudo de acceso de seguridad antes del Login que utiliza la paleta oficial (Azul #0054A6, Celeste #00AEEF) y tipografías (Montserrat, Open Sans) de CSCloudSolutions para brindar una identidad corporativa pulida.
