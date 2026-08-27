# Directiva: Gestión y Cambio de Prioridad de Tickets de Soporte por Agentes

## 1. Objetivo
Permitir que el personal de soporte y SuperAdmins de CSCloudSolutions que atienden o toman un ticket puedan modificar de forma inmediata y determinista la prioridad del ticket (`URGENT`, `HIGH`, `MEDIUM`, `LOW`) tanto desde la cola global de soporte como desde el panel de conversación (Drawer).

## 2. Entradas Requeridas
- `ticketId`: Identificador numérico del ticket en `SupportTickets`.
- `tenantId`: Identificador del tenant propietario del ticket (para validación anti-IDOR).
- `priority`: Nueva prioridad (`URGENT`, `HIGH`, `MEDIUM`, `LOW` / `urgent`, `high`, `medium`, `low`).
- Encabezado `Authorization: Bearer <token>` de un SuperAdmin con rol verificado en base de datos.

## 3. Salidas Esperadas
- Actualización en base de datos (`UPDATE SupportTickets SET priority = ? WHERE id = ?`).
- Respuesta JSON estándar `{ success: true, ticketId, priority }`.
- Actualización reactiva y optimista en la interfaz del agente (Drawer y tabla de la cola global).

## 4. Procedimiento Operativo Estándar (SOP)
1. **Validación de Permisos (RBAC):**
   - Exigir `requireSuperAdmin` o `isSupportAgent` (dominio corporativo + rol `SUPERADMIN`). Los usuarios finales del tenant no pueden modificar prioridades arbitrariamente.
2. **Normalización y Validación de Prioridad:**
   - Validar que la prioridad pertenezca estrictamente a `['low', 'medium', 'high', 'urgent']`.
3. **Persistencia en Base de Datos:**
   - Permitir la actualización mediante:
     - `PATCH /api/admin/support/tickets` (cola global) aceptando `{ ticketId, priority }` y/o `{ ticketId, assignedAdminEmail }`.
     - `PATCH /api/support/tickets/[id]` (hilo del ticket) aceptando `{ tenantId, priority }`.
4. **Sincronización en UI (Drawer y Tabla):**
   - En `TicketConversationDrawer.tsx` con `mode="agent"`, disponer de un selector `<select>` interactivo de prioridad junto al selector de estado y asignación.
   - Reflejar inmediatamente la nueva prioridad con su correspondiente `PriorityPill` y reordenamiento según SLA.

## 5. Restricciones y Casos Borde (Memoria Viva)
- *Nota:* Los clientes comunes del tenant NO pueden alterar la prioridad una vez creado el ticket; la facultad de re-priorizar es exclusiva del agente asignado / SuperAdmin.
- *Nota:* Siempre mapear bidireccionalmente entre el formato de base de datos (`low`, `medium`, `high`, `urgent`) y el enum TypeScript (`LOW`, `MEDIUM`, `HIGH`, `URGENT`).
- *Nota:* Al cambiar la prioridad, preservar el estado y asignación existentes a menos que se indique explícitamente una reasignación.
