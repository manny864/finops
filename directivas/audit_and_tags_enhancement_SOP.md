# Directiva: Refactorización de Auditoría y Gestión de Etiquetas (SDK)

## Objetivo
Mejorar la visualización de la "Auditoría Completa" introduciendo filtros dinámicos en la interfaz (Tipo, Grupo, Severidad), y dotar a la "Gestión de Etiquetas" de la capacidad para aplicar (Patch) etiquetas directamente en Azure mediante el SDK `@azure/arm-resources`.

## Lógica y Pasos
1. **Instalación de SDK:** Requiere instalar `@azure/arm-resources` para manipular etiquetas en recursos de Azure.
2. **Backend (API):** Crear `/api/tags/apply/route.ts`. Este endpoint:
   - Debe validar el token MSAL y asegurar que el `tenantId` coincide (Zero-Trust).
   - Extraer el `subscriptionId` desde el `resourceId` proporcionado en el body para inicializar `ResourceManagementClient`.
   - Utilizar el método `tags.beginUpdateAtScope(resourceId, { operation: 'Merge', properties: { tags: <tags> } })` para anexar/modificar etiquetas.
   - Retornar el estado correspondiente manejando errores de RBAC y Client Secret.
3. **Frontend (Auditoría - ZombieResourcesTable):** 
   - Extraer dinámicamente los valores únicos de `resourceGroup` y `type` de los datos mapeados.
   - Insertar selects para `Suscripción`, `Tipo`, `Grupo`, y `Severidad` y aplicar un `.filter()` reactivo antes de renderizar.
4. **Frontend (Gestión de Etiquetas - TagManager):**
   - Incorporar columna de "Acciones" y modal de edición.
   - Construir el payload con los valores ingresados por el usuario para las etiquetas faltantes.
   - Llamar al endpoint `/api/tags/apply` y reflejar el loading state.

## Trampas Conocidas / Restricciones (Aprendidas)
- **Token Validación:** La modificación de estado en Azure DEBE ir protegida. No confíes en los IDs enviados desde el cliente sin contrastar el `tenantId` del token JWT.
- **RBAC para Tags:** El motor requiere que el Service Principal tenga, como mínimo, el rol de "Tag Contributor" o "Contributor" sobre el ámbito (suscripción o grupo de recursos). De lo contrario, `tags.beginUpdateAtScope` fallará con un error 403 (AuthorizationFailed).
- **Extracción de Subscription:** La API de `ResourceManagementClient` requiere un `subscriptionId` en su constructor, pero `tags.beginUpdateAtScope` trabaja con el `scope` (que es el `resourceId` completo). Se extrae el `subscriptionId` usando regex o asumiendo un ID global si la URL del recurso es genérica, para poder instanciar el cliente sin quejarse.
\n- **KQL Catalog**: Las consultas KQL deben incluir `isnull(prop) or array_length(prop) == 0` para manejar los nulos y arrays vacíos correctamente en recursos huérfanos (Availability Sets, Route Tables, Load Balancers, NAT Gateways).\n- **CostPieChart Tooltip**: Se corrigió el mapeo de variables para que el tooltip muestre correctamente la cantidad de recursos (`count`) además del costo.\n