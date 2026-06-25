# Governance & Policies (Policies As Code) SOP

## Objetivo
Desplegar políticas de Azure nativas (Built-In) desde el panel de SaaS FinOps directamente a los Management Groups o Suscripciones del Tenant.

## Arquitectura de Fetching
- **Identificar Built-In Policies a nivel Tenant**: Debido a que los Management Groups y Subscriptions pueden no existir o no tener permisos asignados por defecto, se debe consultar el "Provider" global utilizando el filtro oficial:
  `GET https://management.azure.com/providers/Microsoft.Authorization/policyDefinitions?api-version=2020-09-01&$filter=policyType eq 'BuiltIn'`
- **Error 404 (Scope Management Group)**: Consultar políticas Built-In en la raíz de un Management Group puede arrojar Error 404 si el inquilino no tiene activados los Management Groups o si no se utiliza el `$filter=policyType eq 'BuiltIn'`.

## Restricciones y Requisitos de Rol (CRÍTICO)

### Error de Autorización al Asignar Políticas (Azure 403)
**Síntoma:** Al enviar el POST para inyectar la política en un Management Group, Azure responde con:
`AuthorizationFailed ... does not have authorization to perform action 'Microsoft.Authorization/policyAssignments/write' over scope ...`

**Causa:** El Service Principal (App Registration) o Managed Identity utilizado por la plataforma SaaS solo tiene el rol de `Reader`. Para **ASIGNAR** políticas (modificar recursos o desplegarlos), se requiere un permiso superior.

**Solución (Rol Necesario):**
El usuario / administrador del Tenant debe asignar el rol de **"Resource Policy Contributor"** (Contribuidor de directiva de recurso) al App Registration en el nivel de "Tenant Root Group" (Management Group raíz) o en el Management Group / Suscripción objetivo.

- Si solo tienen `Reader`, la API REST lanzará `403 AuthorizationFailed`.
- El permiso exacto faltante es: `Microsoft.Authorization/policyAssignments/write`.
- **Por qué "Resource Policy Contributor"?** Porque sigue el principio de menor privilegio (Least Privilege). Es más seguro que asignar el rol global de `Contributor` o `Owner`, limitando al Agente de FinOps exclusivamente a la lectura y escritura de directivas (Azure Policy).

## Manejo de Interfaz (UI)
- Debido a la latencia de la API de Azure, utilizar `onMouseDown` con `e.preventDefault()` en los cuadros de búsqueda desplegables. Si se utiliza `onClick`, el evento `onBlur` del input oculta la lista antes de que se registre la selección, bloqueando la selección de la política.
- **Transparencia de Errores**: Nunca ocultar los mensajes de error devueltos por `fetchRes.text()` en la API REST de Azure. El frontend SIEMPRE debe lanzar y mostrar `json.details` para que el administrador sepa qué parámetro o rol específico falta en el Payload (ej. Error 400 por un Parameter requerido, o Error 403 por falta de rol).
