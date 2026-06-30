# Directiva: Integración de MySQL, Aislamiento JWT y Key Vault

## Objetivo
Agregar soporte local para MySQL vía Docker, y robustecer la arquitectura Multi-Tenant extrayendo el Tenant ID (`tid`) desde el token JWT y descargando secretos por tenant de forma dinámica con Azure Key Vault.

## Entradas
- Cabecera `Authorization: Bearer <token>`
- Variables de entorno: `NEXT_PUBLIC_CLIENT_ID`, `KEYVAULT_NAME`, `DATABASE_URL`

## Lógica y Pasos
1. Configuración de Base de Datos: Generar `docker-compose.yml` para MySQL 8.0 y su módulo de conexión en `src/lib/db.ts` vía `mysql2`.
2. Flujo Admin Consent: Inyectar componente de Next.js `AdminConsentButton.tsx` en el layout para hacer redirect al endpoint de Entra ID.
3. Azure Key Vault: Crear `src/lib/keyvault.ts` que se conecte mediante `DefaultAzureCredential` local para recuperar secretos de la bóveda bajo el formato `client-secret-{tenantId}`.
4. Aislamiento JWT (Zero-Trust): Refactorizar endpoints `route.ts`. Validar si el Bearer token existe. Decodificar usando `jsonwebtoken` y validar estrictamente que `decoded.tid === tenantId`. Devolver 403 en caso contrario.

## Trampas Conocidas / Restricciones
- Al requerir asincronía en Key Vault, `getAzureCredential`, `getComputeClient` y `getNetworkClient` ahora son métodos asíncronos (`async/await`). Los endpoints `route.ts` fallarán si no usan `await` al instanciarlos.
- La decodificación del JWT confía en `jsonwebtoken.decode()` únicamente para extraer el `tid`. Para la validación completa en el futuro (JWKS), se requerirá autenticación extendida, pero esta validación blinda la lectura cruzada temporalmente.
