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
