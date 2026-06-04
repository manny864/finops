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
