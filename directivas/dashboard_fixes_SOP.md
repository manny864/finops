# Directiva: Correcciones de Dashboard, Auditoría y Gobernanza

## Objetivo
Implementar mejoras estructurales en tres componentes principales de la interfaz de administración: el Selector de Tenant, el Widget de Gobernanza y el Motor Principal de Auditoría (Resource Graph).

## Lógica y Pasos
1. **Tenant Selector (`/api/tenants`)**
   - Modificar la consulta MySQL para extraer `company_name` y `primary_domain`.
   - Modificar el mapeo JSON para utilizar `company_name` como primera opción, `primary_domain` como fallback, u "Organización Desconocida" en caso de que ambos sean nulos.

2. **Dashboard Widget (`app/page.tsx`)**
   - En el contenedor de "Estado de Gobernanza", interceptar la condición de `complianceScore === -1`.
   - Inyectar el botón `Configurar Políticas` en la interfaz utilizando la función `setActiveTab('tags')` provista por el contexto visual.

3. **Motor de Auditoría (`auditService.ts`)**
   - Evitar el falso positivo "100% OK".
   - Si no hay `subscriptionId` explícito, ejecutar una query de pre-auditoría: `ResourceContainers | where type == 'microsoft.resources/subscriptions' | project subscriptionId`.
   - Extraer todos los IDs mapeados e inyectarlos en la función constructora `client.resources({ subscriptions: [subs], query: ... })`.
   - Lanzar un `Error` si la lista queda vacía para abortar la tabla frontend e informar correctamente al usuario.

## Trampas Conocidas / Restricciones
- La API de Azure Resource Graph asume scopes predeterminados para usuarios, pero **exige** declaraciones explícitas en el parámetro `subscriptions` para el `ClientSecretCredential`. Si pasas un array vacío `[]` te devuelve un resultado vacío en lugar de un error.
- En la base de datos, **no** intentes consultar la columna `primary_domain` ya que no existe en el esquema de producción. El `company_name` ya almacena el fallback del dominio extraído del email en el cliente. Por lo tanto, debes continuar consultando `company_name as name`.
